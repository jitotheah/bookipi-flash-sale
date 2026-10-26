# Booki Flash Sale

A single-product flash sale: **10 units of an iPhone 17 Pro, one per customer,
inside a fixed time window.**

The interesting part of this problem is not the storefront — it is that
thousands of people press *Buy Now* in the same second, and exactly ten of them
may win. This repo is structured so that the concurrency decision is a single,
reviewable seam rather than something smeared across the codebase.

> **Status: skeleton.** The in-memory path is complete, tested and passing a
> load test. The two production drivers (Postgres, Redis) and the surrounding
> concerns (durable persistence, caching, rate limiting) are stubbed with the
> contracts they must satisfy. See [`GUIDE.md`](./GUIDE.md) for the build order.

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
                      ║  pluggable — see below:      ║
                      ║   · Postgres transaction     ║
                      ║   · Redis Lua script         ║
                      ╚══════════════┬═══════════════╝
                                     │
            ┌────────────────────────┴────────────────────────┐
            │                                                 │
    ╌╌ Postgres driver ╌╌                            ╌╌ Redis driver ╌╌
    The transaction IS the                     The reservation is acknowledged
    durable business record.                   by Redis; the durable record is
    Nothing downstream.                        written off the hot path:
                                                               │
                                                               ▼
                                               ┌──────────────────────────┐
                                               │ Queue (Redis Stream/SQS) │
                                               └────────────┬─────────────┘
                                                            ▼
                                               ┌──────────────────────────┐
                                               │ Worker ──► PostgreSQL    │
                                               │ + reconciliation job     │
                                               └──────────────────────────┘
```

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

## 2. Choosing the serialisation point

`src/store/inventoryStore.ts` defines one contract — *the dedupe check, the
stock check and the decrement are one indivisible step* — and three drivers
satisfy it. Picking between them is the central engineering judgement in this
project, so both candidates are stated fairly rather than one being set up to
lose.

### Postgres: one system, durable, correct

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

### Redis: highest throughput, durability bolted back on

A Lua script runs to completion with nothing interleaved, giving the same
guarantee at ~100k ops/s with one network round trip, and removing the row-lock
queue entirely. The price: Redis is not durable by default, so the business
record moves to an async worker and you now owe a reconciliation job, an AOF
policy, and a cold-start rule that rebuilds stock from Postgres rather than
re-seeding (otherwise a restart refills the shelf and you oversell).

### The honest verdict

For **10 units and a one-hour window, Postgres alone is the right answer** —
one system, one source of truth, no eventual consistency to explain, and the
unique index is an independent guarantee of one-per-user that no application
bug can defeat. Redis earns its place when sustained write throughput on the
contended row becomes the limit, not before. Reaching for it at this scale is
the kind of unjustified complexity the brief calls out.

Both are kept behind the same interface so the choice is a config change and
the same contract tests run against either — which turns the trade-off from an
assertion into a measurement.

### Trade-offs taken deliberately

| Decision | Bought | Paid |
|---|---|---|
| One pluggable serialisation point | Concurrency lives in one reviewable file; drivers are swappable | A layer of indirection over "just call the DB" |
| Postgres as the default driver | Durable, one system, no reconciliation | Throughput capped by row-lock + pool; needs load shedding |
| Redis as the scale-out driver | O(1) reservation, ~100k ops/s | Needs AOF, replica, worker and reconciliation to be durable |
| Async persistence (Redis path only) | Purchase latency independent of the DB | Eventual consistency; a drain-lag window |
| Time window checked in the API | Pre-sale flood rejected without an inventory round-trip | N nodes means N clocks; the Postgres driver fixes this with `clock_timestamp()` |
| `remainingStock` exposed in the sale response | Honest, motivating UI | Cache-busting if served uncached; it is advisory only |
| User identifier typed by the shopper | Matches the brief, demoable | Trivially bypassed — production must key on an authenticated account |

## 3. What is built, what is not

| Area | State |
|---|---|
| React storefront (login → product → processing → confirmed / sold out / already bought) | **Done** |
| `GET /api/sale`, `POST /api/purchase`, `GET /api/purchase/:userId`, `/health` | **Done** |
| Sale window, one-per-user, limited stock, outcome → HTTP mapping | **Done** |
| In-memory inventory driver + unit and integration tests (11 passing) | **Done** |
| Load generator asserting *no oversell* and *one per user* | **Done** |
| Postgres driver (transaction + unique index) | **Stub** — GUIDE.md step 3a |
| Redis driver (the Lua script) | **Stub** — GUIDE.md step 3b |
| Durable persistence + queue worker (Redis path only) | **Stub** — GUIDE.md step 4 |
| Response caching, rate limiting | **Not started** — GUIDE.md step 5 |
| Failure handling & reconciliation | **Not started** — GUIDE.md step 6 |

---

## 4. Running it

```bash
npm install

# API on :3000, web on :5173 (Vite proxies /api to the API)
npm run dev:server
npm run dev:web            # in a second terminal
```

Open http://localhost:5173, sign in with any identifier, press **Buy Now**.
Open a second browser profile to watch stock drop for everyone.

Configuration (see `.env.example`): `TOTAL_STOCK` (default 10), `SALE_START_AT`
/ `SALE_END_AT` (default: starts at boot, runs one hour), `INVENTORY_DRIVER`,
`PORT`, `LOG_LEVEL`.

```bash
# a sale that has not opened yet
SALE_START_AT=2027-01-01T00:00:00Z npm run dev:server

# a sale with one unit, to see "sold out" immediately
TOTAL_STOCK=1 npm run dev:server
```

### Tests

```bash
npm test          # vitest: 11 unit + integration tests
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
ceiling needs the generator on separate hardware — see GUIDE.md step 7.

---

## 5. API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/sale` | status (`upcoming` / `active` / `sold_out` / `ended`), product, window, stock, server clock |
| `POST` | `/api/purchase` | `201 purchased` · `200 already_purchased` · `409 sold_out` / `sale_not_started` / `sale_ended` · `400 invalid_user` |
| `GET` | `/api/purchase/:userId` | whether that user holds a unit, and their order |
| `GET` | `/health` | liveness |

`200` for a repeat purchase is deliberate: the user *does* hold a unit, so a
retry is a successful idempotent replay, not an error. `serverTime` lets the
browser run its countdown off the server's clock rather than the laptop's.

---

## 6. Layout

```
packages/shared   API contract shared by both sides — one breaking change
                  fails typecheck on the server AND the browser
packages/server   Fastify API
  src/config.ts        all env parsing, in one place
  src/domain/          business rules, no HTTP
  src/store/           ◄── the concurrency boundary
                       (memory | postgres | redis)
  src/routes/          outcome → status code
  src/persistence/     durable-write hook
  test/                unit + integration
packages/web      React storefront
stress/run.mjs    load generator with correctness assertions
```

The whole design rests on one interface, `src/store/inventoryStore.ts`: *the
dedupe check, the stock check and the decrement are one indivisible step.* The
memory driver gets that from Node's single thread, the Postgres driver from a
transaction plus a unique index, the Redis driver from a Lua script. All three
are held to the same contract, so swapping them is a config change — and the
same tests prove all three.
