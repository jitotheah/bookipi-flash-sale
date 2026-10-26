# Booki Flash Sale

A single-product flash sale: **10 units of an iPhone 17 Pro, one per customer,
inside a fixed time window.**

The interesting part of this problem is not the storefront — it is that
thousands of people press *Buy Now* in the same second, and exactly ten of them
may win. This repo is structured so that the concurrency decision is a single,
reviewable seam rather than something smeared across the codebase.

> **Status: UI + scaffolding complete. Backend transaction not implemented.**
>
> The React storefront, the typed API contract, the route skeletons, the store
> interface and the proposed schema are done. `PostgresInventoryStore` is a
> documented stub — writing it is the exercise. Unimplemented operations
> report themselves as `501 not_implemented` rather than failing silently.
>
> [`GUIDE.md`](./GUIDE.md) teaches it one step at a time.

---

## 1. System diagram

```
                      ┌──────────────────────────────┐
                      │   React SPA (Vite)           │
                      │   sale status · countdown    │
                      │   Buy Now · result states    │
                      └──────────────┬───────────────┘
                                     │  HTTPS / JSON
                                     ▼
                      ┌──────────────────────────────┐
                      │   CDN + Load balancer        │
                      │   static assets, TLS,        │
                      │   GET /api/sale cached ~1s   │ ◄── absorbs the read flood
                      └──────────────┬───────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
        │ Fastify API #1 │  │ Fastify API #2 │  │ Fastify API #n │   stateless,
        │ validate       │  │                │  │                │   scale out
        │ check window   │  │                │  │                │   freely
        └────────┬───────┘  └────────┬───────┘  └────────┬───────┘
                 │                   │                   │
                 └───────────────────┼───────────────────┘
                                     │  ONE atomic command
                                     ▼
                      ╔══════════════════════════════╗
                      ║  THE SERIALISATION POINT     ║
                      ║  one atomic step, O(1):      ║
                      ║   1. has this user bought?   ║
                      ║   2. is stock > 0?           ║
                      ║   3. decrement + record      ║
                      ║                              ║
                      ║  InventoryStore interface    ║
                      ║  [built] memory (reference)  ║
                      ║  [PLANNED] Postgres  ◄── you ║
                      ╚══════════════┬═══════════════╝
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │  PostgreSQL     [PLANNED]    │
                      │  sales(remaining_stock, …)   │
                      │  purchases UNIQUE(sale,user) │
                      │                              │
                      │  The transaction IS the      │
                      │  durable business record —   │
                      │  nothing downstream of it.   │
                      └──────────────────────────────┘


        ╌╌ optional extension, only if measurement justifies it ╌╌

        Redis Lua script in place of the transaction, with the durable
        record written off the hot path:
            Redis ──► queue (Stream/SQS) ──► worker ──► PostgreSQL
                                                     + reconciliation job
        Buys ~100k ops/s and no pool to exhaust. Costs durability,
        a worker, and a reconciliation job the Postgres path never needs.
```

**Legend.** `[built]` ships in this repo. `[PLANNED]` is scaffolded with its
contract written down and reports `501` until you implement it.

### Why this shape

**One serialisation point, as small as possible.** Overselling is only
preventable if something, somewhere, orders the requests. The design makes that
point explicit and makes the work it does O(1). Everything else — TLS, JSON
parsing, validation, the time-window check — happens on stateless API nodes
that scale horizontally.

**`GET /api/sale` is the real traffic.** 50k browsers polling every 2s is 25k
req/s of pure reads against a single number. One cached response serving all of
them is the difference between flat read load and a melted inventory store.
This is true for every driver below.

---

## 2. Why PostgreSQL

`src/store/inventoryStore.ts` defines one contract — *the dedupe check, the
stock check and the decrement are one indivisible step*. PostgreSQL is the
recommended implementation of it; Redis is an optional extension, documented
here so the trade-off is argued rather than assumed.

### The recommended path: one Postgres transaction

```sql
BEGIN;
  INSERT INTO purchases (order_id, sale_id, user_id) VALUES ($1, $2, $3)
  ON CONFLICT (sale_id, user_id) DO NOTHING          -- zero rows = already bought
  RETURNING order_id, created_at;

  UPDATE sales SET remaining_stock = remaining_stock - 1
   WHERE id = $2 AND remaining_stock > 0
     AND clock_timestamp() >= starts_at AND clock_timestamp() < ends_at
  RETURNING remaining_stock;                          -- zero rows = refuse
COMMIT;
```

This is safe, and the reason is worth stating precisely: under `READ COMMITTED`
a blocked `UPDATE` **re-evaluates its `WHERE` clause against the row version
written by the transaction it waited for** (EvalPlanQual), so `remaining_stock
> 0` is tested *after* the wait. Under `REPEATABLE READ` the same statement
raises a `40001` serialization failure instead and needs a bounded retry loop.

Three details that make or break it:

- `ON CONFLICT`, not catching `23505` — a unique violation aborts the whole
  transaction, so you could not then look up the original order to return.
- `clock_timestamp()`, not `now()` — `now()` is transaction-*start* time, and
  this statement may have blocked on the row lock. It also judges the window by
  **one** clock however many API nodes exist, which is strictly better than
  checking the window per-node as this skeleton currently does.
- `INSERT` before `UPDATE` — shortens the time the contended `sales` row lock
  is held.

**Its real bottleneck is the connection pool, not the row lock.** Thousands of
concurrent buyers against a pool of tens means requests queue *inside the API*:
latency climbs, timeouts cascade, and the API falls over while Postgres sits
there healthy. Mitigate with PgBouncer in transaction mode, short transactions,
`lock_timeout` / `statement_timeout` so waiters fail fast, and a cached
sold-out flag so the ~99% of losers never open a transaction at all.

### The optional extension: Redis

Not required, and not a second backend to implement — `redisStore.ts` is a
sketch kept for the comparison. A Lua script runs to completion with nothing
interleaved, giving the same guarantee at ~100k ops/s with one network round
trip and no connection pool to exhaust. The price: Redis is not durable by
default, so the business record moves to an async worker and you now owe a
reconciliation job, an AOF policy, and a cold-start rule that rebuilds stock
from Postgres rather than re-seeding (otherwise a restart refills the shelf and
you oversell). Worth building only to *measure* the difference.

### The honest verdict

For **10 units and a one-hour window, Postgres alone is the right answer** —
one system, one source of truth, no eventual consistency to explain, and the
unique index is an independent guarantee of one-per-user that no application
bug can defeat. Redis earns its place when sustained write throughput on the
contended row becomes the limit, not before; reaching for it at this scale is
the kind of unjustified complexity the brief calls out.

Both sit behind the same interface, so if you do build the extension the choice
is a config change and the same contract tests run against either — which turns
the trade-off from an assertion into a measurement.

### Trade-offs taken deliberately

| Decision | Bought | Paid |
|---|---|---|
| One pluggable serialisation point | Concurrency lives in one reviewable file; drivers are swappable | A layer of indirection over "just call the DB" |
| Postgres as the recommended driver | Durable, one system, no reconciliation | Throughput capped by pool then row-lock; needs load shedding |
| Redis left as an optional extension | No unjustified complexity for 10 units | Row-lock ceiling stays until someone measures it |
| Memory driver kept as a reference | Executable definition of correct; tests run with nothing installed | One more driver to explain; must never be a production fallback |
| Mock adapter in the frontend | UI reviewable with no backend at all | Must be labelled on screen or it becomes a lie |
| Time window checked in the API | Pre-sale flood rejected without an inventory round-trip | N nodes means N clocks; the Postgres driver fixes this with `clock_timestamp()` |
| `remainingStock` exposed in the sale response | Honest, motivating UI | Cache-busting if served uncached; it is advisory only |
| User identifier typed by the shopper | Matches the brief, demoable | Trivially bypassed — production must key on an authenticated account |

## 3. Implemented vs planned

Everything marked **planned** is scaffolded with its contract written down and
nothing faked: a stub reports `501 not_implemented`, it does not return a
plausible-looking answer.

### Implemented

| | |
|---|---|
| React storefront, all 8 UI states | sign-in, upcoming, active, purchasing, purchased, sold out, ended, uncertainty/error |
| Mock adapter (labelled on screen) | lets the UI run and be reviewed with no backend at all |
| Typed API contract | `packages/shared` — one breaking change fails typecheck on both sides |
| Route skeletons | `GET /api/sale`, `POST /api/purchase`, `GET /api/purchase/:userId`, `/health` |
| Domain rules | sale window, one-per-user, limited stock, outcome → HTTP mapping |
| Store interface | `InventoryStore` — the single concurrency boundary |
| Memory driver (**reference only**) | defines correct behaviour for the tests; not a deliverable |
| 12 unit + integration tests | including a 500-caller oversell test and a 501 test |
| Load generator | asserts no-oversell and one-per-user; a starting point, not a finished suite |
| Proposed schema | `packages/server/db/schema.sql` — written, not yet applied by code |

### Planned

| | Where | Guide |
|---|---|---|
| **The purchase transaction** | `store/postgresStore.ts` | step 4 ⭐ |
| Outcome classification (sold out vs. not started vs. ended) | same file | step 5 |
| Response caching + rate limiting | `routes/sale.ts`, `app.ts` | step 6 |
| Failure-mode write-up | `README.md` | step 7 |
| Full stress-test suite (k6, remote generator, failure runs) | `stress/` | step 8 |
| *Optional:* Redis driver, queue worker | `store/redisStore.ts`, `persistence/` | optional |

---

## 4. The four transaction requirements

These are the acceptance criteria for `postgresStore.ts`, and the test
checklist below mirrors them one for one.

| | Requirement | Enforced by |
|---|---|---|
| **R1** | The sale window is enforced **on the server** | `clock_timestamp() >= starts_at AND < ends_at` inside the `UPDATE` predicate — not `now()` (transaction-start time), and not the client |
| **R2** | Stock can **never** go negative | `remaining_stock > 0` in the predicate **and** `CHECK (remaining_stock >= 0)` on the column — mechanism plus proof |
| **R3** | One purchase per user | `UNIQUE (sale_id, user_id)` — a constraint, so it holds even if the reservation logic has a race |
| **R4** | A failed or duplicate purchase **never consumes stock** | On duplicate, stop before the decrement; on refusal, `ROLLBACK` so neither the insert nor the decrement survives |

R4 is the one most often got wrong. The `INSERT … ON CONFLICT DO NOTHING`
returning zero rows means the user already owns a unit — the decrement must not
run at all.

Why the conditional `UPDATE` cannot oversell: under `READ COMMITTED` a blocked
`UPDATE` re-evaluates its `WHERE` clause against the row version written by the
transaction it waited for (EvalPlanQual), so `remaining_stock > 0` is tested
*after* the wait. Under `REPEATABLE READ` it raises `40001` instead and needs a
bounded retry loop.

---

## 5. Test checklist

Implemented tests are ticked. The rest are what "done" looks like.

**Concurrency — the invariants (R2, R3, R4)**
- [x] 500 concurrent buyers against 10 units → exactly 10 winners
- [x] 50 concurrent attempts from one user → 1 winner, stock down by 1
- [ ] Same two tests against Postgres, via a shared contract-test function
- [ ] A duplicate purchase leaves `remaining_stock` unchanged (R4)
- [ ] A rolled-back transaction leaves no orphan `purchases` row (R4)
- [ ] Two API instances, one database → still exactly 10

**Sale window (R1)**
- [x] Purchase before `starts_at` → `sale_not_started`, stock untouched
- [x] Purchase after `ends_at` → `sale_ended`, stock untouched
- [ ] The window is judged by the database clock, not the API node's
- [ ] A request arriving one millisecond past `ends_at`

**API surface**
- [x] `201` first purchase, `200` repeat, `409` sold out, `400` bad identifier
- [x] Stub drivers answer `501 not_implemented` and still boot
- [x] `GET /api/purchase/:userId` reports held units
- [ ] `503` when the database is unreachable — fail closed, never a sale

**Load**
- [x] Invariants hold with every request in flight at once
- [ ] Generator on separate hardware from the API
- [ ] Degradation point identified and named (expect pool saturation)
- [ ] An instance killed mid-run; invariants still hold

---

## 6. Running it

### The UI alone — no backend required

```bash
npm install
npm run dev:web        # http://localhost:5173
```

The frontend defaults to a **mock adapter**: simulated data, in your browser
tab, nothing persisted. A labelled banner says so on every screen — simulated
data must never be mistakable for real data.

Every UI state is reachable with `?mock=<scenario>`:

| Scenario | Shows |
|---|---|
| `active` *(default)* | open sale, 10 units |
| `upcoming` | starts in two minutes, countdown running |
| `ended` | closed an hour ago |
| `sold_out` | open, zero stock |
| `last_one` | one unit left — race two tabs against it |
| `slow` | 2.5s purchases, to sit in the purchasing state |
| `uncertain` | transport failure, outcome unknown → "Check my order" |
| `unimplemented` | what a `501` stub driver looks like |

```
http://localhost:5173/?mock=sold_out
```

### Against the real API

```bash
npm run dev:server                              # :3000, memory driver
open 'http://localhost:5173/?api=live'          # or VITE_API_MODE=live
```

The memory driver is a **reference implementation for the tests**, not a
deliverable — it cannot survive a restart or more than one process. Point the
UI at `INVENTORY_DRIVER=postgres` once you have written step 4; until then it
answers `501` and the UI says which step is missing.

Configuration (see `.env.example`): `TOTAL_STOCK` (default 10), `SALE_START_AT`
/ `SALE_END_AT` (default: starts at boot, runs one hour), `INVENTORY_DRIVER`
(`memory` | `postgres` | `redis`), `DATABASE_URL`, `PORT`, `LOG_LEVEL`.

```bash
SALE_START_AT=2027-01-01T00:00:00Z npm run dev:server   # a sale not yet open
TOTAL_STOCK=1 npm run dev:server                        # sold out after one
INVENTORY_DRIVER=postgres npm run dev:server            # boots, answers 501
```

### Tests

```bash
npm test          # vitest: 12 unit + integration tests
npm run typecheck # tsc across all three packages
```

### Stress test

```bash
# terminal 1 — fresh stock, quiet logs
LOG_LEVEL=warn TOTAL_STOCK=10 npm run dev:server

# terminal 2
npm run stress -- --users 3000 --duplicates 50 --concurrency 300
```

Expected output — the assertions are the point, not the throughput number:

```
  outcomes
    sold_out             3040
    purchased            10

  throughput    1844 req/s over 1.65s
  latency       p50 148.4ms  p95 306.2ms  p99 381.8ms  max 457.0ms

  assertions
    PASS  exactly 10 units sold (no oversell, no undersell)  (sold 10)
    PASS  every winner is a distinct user  (10 unique of 10)
    PASS  no request failed at the transport layer  (0 failures)
    PASS  stock reads zero afterwards  (checked via GET /api/sale)
```

3050 requests, 10 winners, all distinct — including the cohort where one user
fires 50 concurrent attempts. The script exits non-zero if any assertion fails,
so it works as a CI gate.

Reading the numbers honestly: the latency above is dominated by the load
generator and the API sharing one machine, and 1.8k req/s is the *client's*
ceiling here, not the server's. The number that matters is that the invariants
held while every request was in flight at once. Measuring the server's real
ceiling needs the generator on separate hardware — GUIDE.md step 8, which also
covers the ramping profile, the failure run and the results table this section
still owes.

Note what this run does *not* prove: it exercises the memory driver, which is
one process. The interesting version is the same script against two API
instances sharing one Postgres — that is step 4's acceptance criterion.

---

## 7. API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/sale` | status (`upcoming` / `active` / `sold_out` / `ended`), product, window, stock, server clock |
| `POST` | `/api/purchase` | `201 purchased` · `200 already_purchased` · `409 sold_out` / `sale_not_started` / `sale_ended` · `400 invalid_user` |
| `GET` | `/api/purchase/:userId` | whether that user holds a unit, and their order |
| `GET` | `/health` | liveness |

`200` for a repeat purchase is deliberate: the user *does* hold a unit, so a
retry is a successful idempotent replay, not an error. `serverTime` lets the
browser run its countdown off the server's clock rather than the laptop's.

Two failure codes are distinct on purpose: **`501 not_implemented`** means the
driver behind that endpoint is still a stub, **`500`** means something broke.
The UI renders them differently — "not written yet" and "crashed" are different
facts. A stub never invents a plausible answer.

A purchase that errors is a purchase the server did not commit, so a retry is
safe. But the *client* cannot tell a dropped connection from a lost response,
so the UI never claims it was not charged: it moves to an uncertainty state and
resolves it with `GET /api/purchase/:userId`, which is authoritative and free
to call.

---

## 8. Layout

```
packages/shared   API contract shared by both sides — one breaking change
                  fails typecheck on the server AND the browser
packages/server   Fastify API
  src/config.ts        all env parsing, in one place
  src/errors.ts        NotImplementedError → 501
  src/domain/          business rules, no HTTP
  src/store/           ◄── the concurrency boundary
    inventoryStore.ts    the contract
    memoryStore.ts       reference implementation (tests only)
    postgresStore.ts     ◄── PLANNED: you write this
    redisStore.ts        optional extension, sketch only
  src/routes/          outcome → status code
  src/persistence/     durable-write hook (Redis path only)
  db/schema.sql        proposed schema — not yet applied by code
  test/                unit + integration
packages/web      React storefront
  src/lib/api.ts       adapter switch (mock | live)
  src/lib/mockApi.ts   labelled simulation, for building the UI
  src/lib/httpApi.ts   the real client
  src/components/      one component per UI state
stress/run.mjs    load generator with correctness assertions
```

The whole design rests on one interface, `src/store/inventoryStore.ts`: *the
dedupe check, the stock check and the decrement are one indivisible step.* The
memory driver gets that from Node's single thread, the Postgres driver from a
transaction plus a unique index, the Redis driver from a Lua script. All three
are held to the same contract, so swapping them is a config change — and the
same tests prove all three.
