# Bookipi Flash Sale

A TypeScript flash-sale application using Fastify, React/Vite and PostgreSQL.
One product has configurable stock and a sale window. Each normalized user
identifier can secure one item per sale.

The PostgreSQL implementation persists purchases and stock, enforces the sale
window with the database clock, and coordinates independent API processes.
The frontend provides order lookup and recovery when a purchase response is
lost. There is no payment processing or account authentication in this demo.

## Architecture

```mermaid
flowchart TD
    UI["React and Vite :5173"] -->|"Proxy /api"| Demo["Fastify :3000; demo sale 1"]
    Load["Node HTTP load generator"] --> A["Fastify :3001; test sale"]
    Load --> B["Fastify :3002; same test sale"]
    Demo --> DB["PostgreSQL 16"]
    A --> DB
    B --> DB
```

This shows the local demo and the two-process test arrangement. PostgreSQL runs
in Docker with a named data volume. The demo and load-test sale use separate
rows, so the stress test does not consume the demo's inventory.

Each API process uses a PostgreSQL pool with at most 10 connections. The API
keeps no authoritative inventory in process memory in PostgreSQL mode. All
instances serving a sale must share its `SALE_ID` and `DATABASE_URL`.

A production arrangement could place a load balancer in front of the APIs and
serve the built React assets through a CDN. Neither service is deployed here.
Redis, an asynchronous queue and a worker are optional extensions, not part of
the implemented purchase path.

## Purchase transaction and correctness

`packages/server/src/store/postgresStore.ts` contains the concurrency boundary.
Every statement in a purchase transaction uses the same borrowed connection:

1. Begin a `READ COMMITTED` transaction and set local lock/statement timeouts.
2. Lock the selected `sales` row using `SELECT ... FOR UPDATE`.
3. Insert the proposed purchase with `ON CONFLICT (sale_id, user_id) DO NOTHING`.
4. If that user already purchased, read their existing order, roll back the
   transaction and return that order without decrementing stock.
5. Otherwise, read a fresh `clock_timestamp()` after acquiring the sale lock.
   Allow allocation only when `starts_at <= checked_at < ends_at` and stock
   is positive.
6. For an allowed allocation, decrement stock and commit the purchase and stock
   change together. For a refusal, roll back the inserted purchase.
7. Release the connection in `finally`; discard a connection detected as broken.

Only one transaction can hold this sale's row lock at a time. Each later buyer
checks the stock left by earlier committed transactions. PostgreSQL also enforces
`CHECK (remaining_stock >= 0)` and `UNIQUE (sale_id, user_id)` as independent
database constraints. The transaction connects the inventory change to the
purchase record, avoiding orphan orders or consumed stock on a refused attempt.

Admission time is the database decision time after the lock is obtained, rather
than the time the browser clicked or the transaction began. A request queued
until after the sale ends is refused. A successful allocation can finish
committing after the end time if its allocation decision was within the window.

Duplicate lookup precedes the window and stock decision. An existing buyer can
recover their original order even when the sale is now ended or sold out.

The setup script inserts a sale only when its ID does not exist. In PostgreSQL
mode its saved window and inventory are authoritative. Restarting an API or
rerunning setup preserves them; changing environment variables does not edit
an existing sale.

## Failure handling

- Known transient database/connection errors return HTTP `503` with
  `Retry-After: 1`. Unexpected server errors return a sanitized `500` response.
  PostgreSQL failures never trigger an automatic switch to the memory driver.
- A database error or browser timeout can occur after the transaction commits.
  An error response therefore does not prove that no order exists. The UI asks
  the buyer to check their order or retry with the same identifier.
- A lookup showing no order may precede completion of an earlier in-flight
  request. The uncertainty screen keeps lookup and retry available.
- The live frontend bounds requests with an eight-second browser timeout.
  That timeout cancels the browser's wait; it does not undo a database commit.
- Transactions use a three-second lock timeout and a five-second statement
  timeout. Pool acquisition uses a five-second connection timeout. These do
  not constitute a deadline for the entire HTTP request.
- Shutdown handlers call `app.close()` to drain requests and close the pool.
  `/health` is a process liveness endpoint, not a database readiness check.
- The Docker volume preserves PostgreSQL data across ordinary container
  recreation. High availability, backups and recovery from host/disk loss are
  outside this local implementation.

## Requirements and installation

- Node.js **22.x, version 22.12.0 or later**, and npm. Node.js 24.x is also
  accepted by the locked Vite/Vitest dependencies.
- Docker Desktop with its Linux engine running, and Docker Compose.

Run commands from the repository root. The examples use PowerShell on Windows.
Use separate terminals for the backend and frontend.

```powershell
npm ci
docker compose up -d postgres
docker compose exec postgres pg_isready -U flash -d flashsale
```

Configuration is read from the process environment. The following commands set
it explicitly; copying an environment example file alone does not load it.

### Backend: terminal 1

```powershell
$env:INVENTORY_DRIVER = "postgres"
$env:DATABASE_URL = "postgres://flash:flash@localhost:5432/flashsale"
$env:SALE_ID = "1"
$env:TOTAL_STOCK = "10"
$env:PORT = "3000"
$env:SALE_START_AT = [DateTime]::UtcNow.AddMinutes(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$env:SALE_END_AT = [DateTime]::UtcNow.AddHours(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

npm run db:setup --workspace=@flash/server
npm run dev:server
```

On a fresh database, this creates sale 1 with 10 items and an active window.
If sale 1 already exists, setup reports its saved settings. To create another
demo sale, stop the backend, choose an unused `SALE_ID`, then run setup and
restart in the same terminal. An existing ended/sold-out sale stays that way.

`npm run start --workspace=@flash/server` runs the backend without watch mode.
The server executes TypeScript with `tsx`; there is no separate backend emit
step. Verify its types with `npm run typecheck`.

### Frontend: terminal 2

```powershell
npm run dev:web
```

Open the [live storefront](http://localhost:5173/?api=live). Vite forwards `/api`
requests to port 3000.
Enter an identifier and purchase, then use the same identifier to recover the
existing order. Identifiers are trimmed, lowercased, and restricted to 3–64
letters, digits or `. _ - + @` characters.

An isolated UI preview is available at:

- [Active sale](http://localhost:5173/?api=mock&mock=active)
- [Upcoming sale](http://localhost:5173/?api=mock&mock=upcoming)
- [Sold out](http://localhost:5173/?api=mock&mock=sold_out)
- [Ended sale](http://localhost:5173/?api=mock&mock=ended)
- [Uncertain purchase](http://localhost:5173/?api=mock&mock=uncertain)

Mock mode is labeled, stores simulated data in the browser tab, and consumes no
PostgreSQL stock. It is not a concurrency or persistence test.

Build the static frontend with:

```powershell
npm run build --workspace=@flash/web
```

The output is `packages/web/dist`. Production hosting must route `/api` to the
backend; the Vite development proxy is not a deployed load balancer.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `INVENTORY_DRIVER` | `memory` | Set `postgres` for the durable implementation. `redis` is a stub. |
| `DATABASE_URL` | `postgres://flash:flash@localhost:5432/flashsale` | Shared PostgreSQL database. |
| `SALE_ID` | `1` | Sale row selected by setup, API and inventory inspection. |
| `TOTAL_STOCK` | `10` | Initial inventory when creating a new sale. |
| `SALE_START_AT` | Configuration load time | Initial window start for a new sale. |
| `SALE_END_AT` | Start plus one hour | Initial exclusive end for a new sale. |
| `PORT` | `3000` | API listening port. |
| `HOST` | `0.0.0.0` | API listening interface. |
| `LOG_LEVEL` | `info` | Set `warn` to reduce per-request console logging during load tests. |

In PostgreSQL mode, saved sale settings take precedence over initial stock and
window variables. Product metadata is defined in `packages/server/src/config.ts`.

## Tests

```powershell
npm test
npm run typecheck
npm run db:check --workspace=@flash/server
npm run test:db --workspace=@flash/server
```

- `npm test`: 21 tests in four files, covering memory/service behavior,
  Fastify routes, persisted-sale metadata through a test double, and simulated
  database/response failures. Fastify injection exercises routing without
  listening on a socket. These tests do not require PostgreSQL.
- `db:check`: reads the configured PostgreSQL sale and an example user's order.
- `test:db`: exercises actual PostgreSQL using two independent store/pool
  instances and an isolated sale fixture. It verifies duplicate recovery,
  concurrent allocation, window/sold-out refusal without leftover orders, and
  purchase/distinct-user counts. It removes its own fixture afterward.
- The HTTP stress test below exercises two actual listening API processes.

Start PostgreSQL and run database setup before the database checks. The fixture
script does not truncate tables or reset the demo sale.

## Repeatable two-process HTTP stress test

Choose a sale ID not used by an earlier run. This example uses **7001**.
All purchase traffic during the test must come from the generator. Keep the
port-3000 demo on its own sale.

### Test API 1: separate terminal

```powershell
$env:INVENTORY_DRIVER = "postgres"
$env:DATABASE_URL = "postgres://flash:flash@localhost:5432/flashsale"
$env:SALE_ID = "7001"
$env:TOTAL_STOCK = "10"
$env:PORT = "3001"
$env:LOG_LEVEL = "warn"
$env:SALE_START_AT = [DateTime]::UtcNow.AddMinutes(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$env:SALE_END_AT = [DateTime]::UtcNow.AddHours(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

npm run db:setup --workspace=@flash/server
```

Confirm that setup created sale 7001 with 10 remaining items, then run:

```powershell
npm run start --workspace=@flash/server
```

### Test API 2: another terminal

```powershell
$env:INVENTORY_DRIVER = "postgres"
$env:DATABASE_URL = "postgres://flash:flash@localhost:5432/flashsale"
$env:SALE_ID = "7001"
$env:PORT = "3002"
$env:LOG_LEVEL = "warn"

npm run start --workspace=@flash/server
```

### Generator: another terminal

```powershell
npm run stress -- --url http://localhost:3001,http://localhost:3002 --users 2000 --duplicates 20 --concurrency 100
```

The dependency-free Node generator first sends 20 attempts from the same user,
then 2,000 distinct-user attempts, using unique identifiers for each run.
It distributes requests across the supplied API origins. It bounds requests
with ten-second timeouts and verifies HTTP status/outcome combinations.

Expect 2,020 purchase responses: **10 purchased, 19 already_purchased, and
1,991 sold_out**. All six assertions should pass:

1. The repeated user gets one purchase and the same order on every retry.
2. Exactly 10 purchases succeed across both APIs.
3. Winners have distinct users and order IDs.
4. All purchase requests have the expected HTTP status and outcome.
5. Both APIs report zero remaining stock.
6. Every winning order is retrievable with the same ID from both APIs.

The generator exits nonzero on failure. It requires fresh stock and refuses to
treat a reused, exhausted sale as a fresh test. For another run, stop both test
APIs, select another unused sale ID in both terminals, create it, and restart.
The script supports a single API too: supply one origin to `--url`.

Check the database independently, using this run's sale ID:

```powershell
docker compose exec postgres psql -U flash -d flashsale -c "SELECT s.id, s.total_stock, s.remaining_stock, count(p.order_id) AS purchases, count(DISTINCT p.user_id) AS unique_buyers FROM sales s LEFT JOIN purchases p ON p.sale_id = s.id WHERE s.id = 7001 GROUP BY s.id;"
```

Expected: total stock 10, remaining stock 0, purchases 10, unique buyers 10.

### Observed local results

The developer ran these checks on 29 October 2026 on a local Windows desktop,
with PostgreSQL in Docker and the APIs and generator on the same computer:

| Run | APIs | Purchase requests | Max in flight | Duration | Requests/s | p50 | p95 | p99 | Max latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Small baseline | 1 | 120 | 20 | 0.62 s | 194 | 78.7 ms | 168.3 ms | 182.6 ms | 185.8 ms |
| Shared-sale run | 2 | 2,020 | 100 | 9.41 s | 215 | 433.5 ms | 608.6 ms | 640.1 ms | 678.1 ms |

All six assertions passed in the shared-sale run. A separate SQL query for sale
2026102902 confirmed 10 total stock, 0 remaining stock, 10 purchases and 10
distinct buyers. The 21 automated tests also passed.

These are correctness checks under a bounded workload, not a server capacity
claim. The large run has 2,000 distinct-user attempts and at most 100 requests
in flight, rather than 2,000 simultaneous requests. Only 10 purchases allocate
stock; most responses are refusals. Reported throughput and latency cover the
purchase phases, excluding the final status and order-lookup checks. The two
runs use different concurrency and request counts, so they do not establish a
scaling speedup. Runtime/hardware details and logging settings were not recorded
with the results. A capacity study would record these, use a separate generator,
mix reads with writes, and measure sustained successful allocation and overload.

## API

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/sale` | Sale status, product, saved window, stock and database time in PostgreSQL mode. |
| `POST` | `/api/purchase` | JSON body `{ "userId": "ada@example.com" }`. |
| `GET` | `/api/purchase/:userId` | `hasPurchased` and the saved order, if present. |
| `GET` | `/health` | Process liveness. |

Purchase outcomes: `201 purchased`, `200 already_purchased`,
`409 sold_out` / `sale_not_started` / `sale_ended`, and `400 invalid_user`.
Transient service failures return `503`; unexpected failures return `500`.
The unimplemented Redis driver returns `501 not_implemented`.

Inventory in a status response is advisory: another request may buy the last
item before the browser renders it. Only the purchase transaction allocates
stock. Order lookup and retry use the normalized user ID and selected sale;
clients must keep that identifier when recovering an uncertain request.

## Trade-offs and limits

- **One database as authority.** PostgreSQL atomically saves both the order and
  inventory change. This avoids a Redis/database dual-write problem and a queue
  recovery protocol for this scope.
- **One hot sale row.** Serializing on it makes correctness easy to inspect,
  but caps write throughput. Every purchase attempt, including a sold-out
  refusal, currently acquires that lock. More API processes do not remove this
  database serialization point.
- **Finite pool, limited overload controls.** Each API pool has 10 connections;
  waiting requests still consume resources. Timeout controls are implemented,
  but a bounded admission queue, rate limiting and per-user abuse protection
  are future work. Pool size alone does not bound the HTTP request backlog.
- **Uncached reads.** The storefront polls status; no shared status cache or CDN
  cache is implemented. A short-lived advisory status cache could reduce read
  pressure. Purchase and order-recovery decisions must stay authoritative.
- **Demo identifiers.** One-per-user means one per normalized supplied ID. A
  person can enter another ID. Production must derive this key from an
  authenticated account and protect order lookup appropriately.
- **Optional drivers.** Memory is useful for tests and single-process demos;
  it loses state on restart and does not coordinate processes. Redis remains a
  documented stub; a durable Redis reservation pipeline would require a
  persistence, failover and reconciliation design before claiming equivalent
  guarantees.
- **Scope.** Payments, cancellations, refunds, reservations with expiry, and
  automated production deployment are not implemented.

## Repository layout

| Path | Responsibility |
|---|---|
| `packages/shared/src/index.ts` | Shared API types. |
| `packages/server/src/config.ts` | Environment parsing and product configuration. |
| `packages/server/src/app.ts` | Fastify assembly, routes and error handling. |
| `packages/server/src/domain/flashSale.ts` | Identifier normalization and outcome mapping. |
| `packages/server/src/store/inventoryStore.ts` | Reservation and inventory contract. |
| `packages/server/src/store/postgresStore.ts` | Persisted reads and atomic purchase transaction. |
| `packages/server/src/store/memoryStore.ts` | Single-process reference store. |
| `packages/server/src/scripts/` | Schema setup and PostgreSQL checks. |
| `packages/server/db/schema.sql` | Tables and database constraints. |
| `packages/server/test/` | Vitest service/API/failure tests. |
| `packages/web/src/` | React UI, live API client and labeled mock preview. |
| `stress/run.mjs` | HTTP load generator and correctness assertions. |

Stop local infrastructure with `docker compose down`. The named PostgreSQL
volume remains; `docker compose down -v` deletes it and its saved orders.
