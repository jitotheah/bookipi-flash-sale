# Booki Flash Sale

A single-product flash sale: **10 units of an iPhone 17 Pro, one per customer,
inside a fixed time window.**

The interesting part of this problem is not the storefront — it is that
thousands of people press *Buy Now* in the same second, and exactly ten of them
may win. This repo is structured so that the concurrency decision is a single,
reviewable seam rather than something smeared across the codebase.

> **Status: skeleton.** The in-memory path is complete, tested and passing a
> load test. The distributed path (Redis, durable persistence, caching, rate
> limiting) is stubbed with the contract it must satisfy. See
> [`GUIDE.md`](./GUIDE.md) for the build order.

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
                      ║  Redis — the serialisation   ║
                      ║  point and ONLY source of    ║
                      ║  truth for "who won"         ║
                      ║                              ║
                      ║  Lua script, run to          ║
                      ║  completion, no interleaving:║
                      ║   1. has this user bought?   ║
                      ║   2. is stock > 0?           ║
                      ║   3. decrement + record      ║
                      ╚══════════════┬═══════════════╝
                                     │  async, off the hot path
                                     ▼
                      ┌──────────────────────────────┐
                      │  Queue (Redis Stream / SQS)  │
                      └──────────────┬───────────────┘
                                     ▼
                      ┌──────────────────────────────┐
                      │  Worker ──► PostgreSQL       │
                      │  durable orders, receipts,   │
                      │  fulfilment, reconciliation  │
                      └──────────────────────────────┘
```

### Why this shape

**One serialisation point, as small as possible.** Overselling is only
preventable if something, somewhere, orders the requests. The design makes that
point explicit and makes the work it does O(1): a single Lua script. Everything
else — TLS, JSON parsing, validation, the time-window check — happens on
stateless API nodes that scale horizontally.

**Why Redis and not `UPDATE … SET stock = stock - 1 WHERE stock > 0`.** The SQL
version is *correct*; it is not *fast*. Every concurrent buyer queues behind a
row lock on one row, so throughput is capped at roughly one transaction per
lock round-trip and connection-pool exhaustion takes the rest of the API down
with it. Redis is single-threaded and executes a Lua script atomically, giving
the same guarantee at ~100k ops/s. Trade-off: Redis is not durable by default,
which is why Postgres stays in the picture.

**Writes are acknowledged by Redis, persisted by a worker.** A buyer's answer
depends only on the atomic reservation, so a slow or down database cannot add
latency to the purchase path or turn a reservation the user already holds into
an error. Cost: the durable record is eventually consistent, and recovery needs
a reconciliation job (GUIDE.md step 6).

**`GET /api/sale` is the real traffic.** 50k browsers polling every 2s is 25k
req/s of pure reads against a single number. One cached response serving all of
them is the difference between flat read load and a melted inventory store.

### Trade-offs taken deliberately

| Decision | Bought | Paid |
|---|---|---|
| Redis as source of truth for the sale | O(1) atomic reservation, huge throughput | Needs AOF + replica + reconciliation to be durable |
| Async persistence to Postgres | Purchase latency independent of the DB | Eventual consistency; a drain lag window |
| Time window checked in the API, not in Lua | Pre-sale flood rejected without an inventory round-trip | A request within clock-skew of the boundary could slip |
| `remainingStock` exposed in the sale response | Honest, motivating UI | Cache-busting if served uncached; it is advisory only |
| User identifier typed by the shopper | Matches the brief, demoable | Trivially bypassed — production must key on an authenticated account |

---

## 2. What is built, what is not

| Area | State |
|---|---|
| React storefront (login → product → processing → confirmed / sold out / already bought) | **Done** |
| `GET /api/sale`, `POST /api/purchase`, `GET /api/purchase/:userId`, `/health` | **Done** |
| Sale window, one-per-user, limited stock, outcome → HTTP mapping | **Done** |
| In-memory inventory driver + unit and integration tests (11 passing) | **Done** |
| Load generator asserting *no oversell* and *one per user* | **Done** |
| Redis driver (the Lua script) | **Stub** — GUIDE.md step 3 |
| Durable persistence + queue worker | **Stub** — GUIDE.md step 4 |
| Response caching, rate limiting | **Not started** — GUIDE.md step 5 |
| Failure handling & reconciliation | **Not started** — GUIDE.md step 6 |

---

## 3. Running it

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

## 4. API

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

## 5. Layout

```
packages/shared   API contract shared by both sides — one breaking change
                  fails typecheck on the server AND the browser
packages/server   Fastify API
  src/config.ts        all env parsing, in one place
  src/domain/          business rules, no HTTP
  src/store/           ◄── the concurrency boundary (memory | redis)
  src/routes/          outcome → status code
  src/persistence/     durable-write hook
  test/                unit + integration
packages/web      React storefront
stress/run.mjs    load generator with correctness assertions
```

The whole design rests on one interface, `src/store/inventoryStore.ts`: *the
dedupe check, the stock check and the decrement are one indivisible step.* The
memory driver gets that from Node's single thread; the Redis driver gets it
from a Lua script. Both are held to the same contract, so swapping them is a
config change.
