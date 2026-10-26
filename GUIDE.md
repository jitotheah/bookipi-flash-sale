# Build guide

One step at a time. Each has a **purpose**, the **files** it touches,
**acceptance criteria** you can check, and a **verify** command.

The skeleton gives you a complete UI, a typed API contract, route skeletons, a
store interface and a reference implementation that is already correct — on
one process, in memory. Your job is the real backend: a Postgres transaction
that holds the same invariants under concurrent load.

**PostgreSQL is the recommended path.** Redis is an optional extension at the
end, not a second backend you have to write.

Suggested budget ≈ 8 hours:

| Step | | Time |
|---|---|---|
| 0 | Orient | 30 min |
| 1 | Prove the race exists | 30 min |
| 2 | Write the failing contract tests | 30 min |
| 3 | Apply the schema | 20 min |
| 4 | **Implement the transaction** ⭐ | 2–3 h |
| 5 | Classify outcomes, switch the UI to live | 45 min |
| 6 | Shed the read load | 45 min |
| 7 | Failure modes (writing) | 1 h |
| 8 | Stress testing | 1–2 h |
| 9 | Final write-up | 1 h |
| — | Optional: Redis extension | 2 h |

---

## Step 0 — Orient

**Purpose.** Understand the one abstraction the design rests on before
changing anything. You cannot defend code you have not read, and starting from
a skeleton only pays off if you own it by the end.

**Files to read, in this order.**

1. `packages/shared/src/index.ts` — the API contract both sides share
2. `packages/server/src/store/inventoryStore.ts` — the concurrency boundary
3. `packages/server/src/store/memoryStore.ts` — the reference implementation
4. `packages/server/src/domain/flashSale.ts` — the business rules
5. `packages/server/test/flashSale.test.ts` — what "correct" means, executably

**Acceptance criteria.**
- You can say in one sentence why `reserve()` must be a single atomic step.
- You can point at the line in `memoryStore.ts` that would break if an `await`
  were added, and say what would go wrong.

**Verify.**
```bash
npm install && npm test        # 12 passing
npm run dev:web                # UI on :5173, mock adapter, no backend needed
```

---

## Step 1 — Prove the race exists

**Purpose.** Demonstrate the bug your transaction prevents. This is the single
highest-value half hour in the project: it turns "I used a transaction because
it's atomic" into "here is the failure, here is the test that catches it, here
is why the fix works."

**Files to edit.** `packages/server/src/store/memoryStore.ts` (temporarily).

Split the critical section so the event loop can interleave:

```ts
const current = this.#remaining;
await new Promise((r) => setImmediate(r));   // yields
if (current <= 0) return { status: 'sold_out' };
this.#remaining = current - 1;
```

**Acceptance criteria.**
- The oversell test fails, selling far more than 10 units.
- You restore the original code and it passes again.
- You keep a note of the failure output for the write-up.

**Verify.**
```bash
npm test -- flashSale          # fails loudly, then passes once reverted
```

---

## Step 2 — Write the failing contract tests

**Purpose.** Hold every driver to one standard instead of one standard each.
The tests exist before the implementation, so "done" is defined before you
start.

**Files to edit.** `packages/server/test/` — extract the two invariant tests
into a reusable function.

```ts
export function itBehavesLikeAnInventoryStore(makeStore: () => InventoryStore) {
  it('never oversells', async () => { /* the 500-caller test */ });
  it('allows one unit per user', async () => { /* the duplicate test */ });
}
```

Call it for `MemoryInventoryStore` (passes) and `PostgresInventoryStore`
(fails — the stub throws `NotImplementedError`).

**Acceptance criteria.**
- Memory suite green, Postgres suite red for the right reason.
- The Postgres suite skips cleanly when no database is reachable, so `npm test`
  works on a laptop with nothing running.

**Verify.**
```bash
npm test                       # memory green, postgres red/skipped
```

---

## Step 3 — Apply the schema

**Purpose.** Get the constraints in place first. Three of the four transaction
requirements are enforced by the schema, not by your code — which is the point.

**Files to edit.** `packages/server/db/schema.sql` (review, adjust if you
disagree with it).

**Acceptance criteria.**
- `CHECK (remaining_stock >= 0)` exists.
- `UNIQUE (sale_id, user_id)` exists on `purchases`.
- Re-running the file is safe: the seed is `ON CONFLICT DO NOTHING`, so a
  restart mid-sale does not refill the shelf.
- You can state what each constraint protects against.

**Verify.**
```bash
docker compose up -d postgres
psql postgres://flash:flash@localhost:5432/flashsale -f packages/server/db/schema.sql
psql postgres://flash:flash@localhost:5432/flashsale -c "\d purchases"
# run it twice — stock must still read 10
```

---

## Step 4 — Implement the transaction ⭐

**Purpose.** The core of the exercise. Everything else is scaffolding around
this one function.

**Files to edit.** `packages/server/src/store/postgresStore.ts`. The file
contains the four requirements, the full transaction, the reason it cannot
oversell, and the five things a reviewer will probe. Install the driver with
`npm i pg -w @flash/server`.

**The four requirements** (restated — the file has the detail):

| | Requirement | Enforced by |
|---|---|---|
| R1 | The sale window is enforced on the server | `clock_timestamp()` in the `UPDATE` predicate |
| R2 | Stock can never go negative | `remaining_stock > 0` predicate **and** the column `CHECK` |
| R3 | One purchase per user | `UNIQUE (sale_id, user_id)` constraint |
| R4 | A failed or duplicate purchase never consumes stock | Stop before the decrement on duplicate; `ROLLBACK` so neither effect survives |

R4 is the one most often got wrong: if the `INSERT … ON CONFLICT` returns zero
rows, the user already owns a unit — you must **not** run the decrement.

**Acceptance criteria.**
- `INVENTORY_DRIVER=postgres npm test` is green — same tests as memory.
- **A duplicate purchase never decrements inventory.** Assert it directly:
  read `remaining_stock`, have an existing buyer purchase again, read it back
  — identical, and `purchases` gained no row. The duplicate branch must return
  *before* the `UPDATE` runs, not compensate for it afterwards.
- **If the INSERT succeeds but inventory allocation fails, the whole
  transaction rolls back.** When the decrement returns zero rows — sold out,
  outside the window, or any error between the two statements — the inserted
  `purchases` row must not survive. An orphan row would permanently bar that
  user from a unit they never received. Test it: set `remaining_stock` to 0,
  attempt a purchase as a user who has never bought, then confirm
  `SELECT count(*) FROM purchases WHERE user_id = …` is 0.
- Two API instances against one database still sell exactly 10. **This is the
  experiment the memory driver cannot pass — it is the one to show off.**
- The database being unreachable produces a 503, never a sale. Fail closed;
  never fall back to the memory driver.

**Verify.**
```bash
INVENTORY_DRIVER=postgres npm test

PORT=3001 INVENTORY_DRIVER=postgres npm run dev:server
PORT=3002 INVENTORY_DRIVER=postgres npm run dev:server
node stress/run.mjs --url http://localhost:3001 --users 2000
psql …flashsale -c "SELECT remaining_stock FROM sales WHERE id=1"   -- 0
psql …flashsale -c "SELECT count(*), count(DISTINCT user_id) FROM purchases"  -- 10, 10
```

---

## Step 5 — Classify outcomes, then switch the UI to live

**Purpose.** A zero-row `UPDATE` cannot say *why* it failed, but sold out, not
started and ended are three different screens. This step is what makes the UI
you already have tell the truth.

**Files to edit.** `packages/server/src/store/postgresStore.ts` (add the
classifying `SELECT`), then `packages/web/.env` or the URL to leave mock mode.

**Acceptance criteria.**
- Each of `sold_out`, `sale_not_started`, `sale_ended` is returned distinctly.
- `?api=live` renders the same screens the mock scenarios do.
- The mock adapter still works untouched — it is a preview tool, not a
  fallback, and must never silently substitute for a broken backend.
- **During uncertainty recovery, an empty lookup must not immediately imply
  failure.** When a purchase fails in transit, the original request may still
  be committing on the server. A `hasPurchased: false` read taken a moment
  later proves nothing — telling the user "nothing was reserved, try again" on
  the strength of it can hand one person two units, or make them retry into
  their own in-flight transaction. Treat the first empty read as *still
  unknown*: re-check a few times with backoff, and only conclude "not
  reserved" once the window in which the original request could still be
  in flight has passed (its timeout plus the server's `statement_timeout`).
  Until then the honest answer is "still checking".

  *Known gap:* `checkMyOrder` in `packages/web/src/App.tsx` currently takes the
  optimistic shortcut — one read, and an empty result is reported as "nothing
  was reserved". That is the naive version this criterion replaces.

**Verify.**
```bash
npm run dev:server & npm run dev:web
open 'http://localhost:5173/?api=live'
SALE_START_AT=2027-01-01T00:00:00Z npm run dev:server   # upcoming screen
TOTAL_STOCK=1 npm run dev:server                        # sold out after one
```

---

## Step 6 — Shed the read load

**Purpose.** `GET /api/sale` is the real traffic: 50k browsers polling every 2s
is 25k req/s against a single number. Cheapest systems-thinking marks in the
project.

**Files to edit.** `packages/server/src/routes/sale.ts`, `src/app.ts`.

**Acceptance criteria.**
- `GET /api/sale` is memoised for ~1s; the store sees roughly one read per
  second regardless of request rate. Note in the README that production puts a
  CDN with a 1s TTL here.
- `POST /api/purchase` is rate limited, keyed on user identifier **and** IP.
- A request timeout and connection cap exist, so overload sheds rather than
  topples.
- Once stock is zero, losers are answered without opening a transaction.

**Verify.**
```bash
npm i @fastify/rate-limit -w @flash/server
node stress/run.mjs --users 3000      # latency should drop against step 4
```

---

## Step 7 — Failure modes

**Purpose.** "Robustness" in the brief means having answers to these. They are
also the likeliest interview questions.

**Files to edit.** `README.md`.

**Acceptance criteria.** A paragraph each on:
- **An API instance dies mid-request.** Nothing is lost — the transaction
  either committed or did not. Retry is safe because `reserve` is keyed by user
  and returns `already_purchased`.
- **The database is unreachable.** Fail closed: 503, no sale, nothing
  oversold, no divergent in-memory truth to reconcile. (This is a genuine
  advantage of the Postgres path — say so.)
- **Connection pool exhaustion.** The real bottleneck. PgBouncer in transaction
  mode, short transactions, `lock_timeout` and `statement_timeout`.
- **A node's clock is wrong.** Why the window check belongs in SQL
  (`clock_timestamp()`, one clock) rather than per-node.

**Verify.** Have someone read it who has not seen the code.

---

## Step 8 — Stress testing

**Purpose.** The brief asks you to *explain* your results, so the write-up
counts as much as the run. `stress/run.mjs` is a starting point, not a finished
suite — it asserts the invariants but measures the client as much as the server.

**Files to edit.** `stress/run.mjs`, optionally a new `stress/purchase.k6.js`.

**Acceptance criteria.**
- The generator runs on different hardware (or a CPU-limited container) from
  the API, and you say so next to the numbers.
- A table: scenario, requests, winners, p99, verdict.
- You push `--users` until something degrades and **name what broke** — it
  should be pool saturation, not the row lock. "Held 10/10 correct at 5,000
  concurrent; limit was pool saturation at N, which PgBouncer would move" beats
  any throughput figure with no ceiling identified.
- A failure run: kill an instance mid-test, show the invariants still hold.

**Verify.**
```bash
npm run stress -- --users 5000 --concurrency 500
```

---

## Step 9 — Final write-up

**Purpose.** Pragmatism is explicitly on the mark scheme. Explaining a choice
counts as much as making it.

**Files to edit.** `README.md`.

**Acceptance criteria.**
- The implemented-vs-planned table matches reality.
- For each component, one line on what you would **remove** at 10x less
  traffic. Knowing when a queue is overkill reads better than adding one
  everywhere.
- What you did not build, and why. "I mocked persistence to spend the time on
  concurrency correctness, which is where the risk is" is a strong answer;
  silence looks like an oversight.
- The diagram marks planned components distinctly from built ones.

---

## Optional — the Redis extension

**Only after step 4 is green and measured.** This is an extension, not a
requirement, and it is the wrong default for a ten-unit sale.

**Purpose.** To *measure* the trade-off rather than assert it: same stress
test, same assertions, two drivers, different numbers and different failure
modes.

**Files to edit.** `packages/server/src/store/redisStore.ts` (stub with the Lua
sketch), `src/persistence/orderSink.ts` (the queue hook — only needed on this
path, because Redis is not the durable record).

**Acceptance criteria.**
- Dedupe check, stock check and decrement are a **single** Lua script. Three
  round trips with logic between them is step 1's bug, distributed.
- `init` uses `SET … NX` so a restart mid-sale does not refill the shelf.
- A cold start rebuilds stock from Postgres rather than re-seeding.
- You can state what reconciliation this path now owes that Postgres did not.

**Verify.**
```bash
docker compose up -d redis
INVENTORY_DRIVER=redis npm test
```

---

## Things that cost marks

- **Overselling under load.** Everything else is secondary.
- **"One per user" enforced in the frontend.** Disabling the button is UX. Only
  the constraint and the atomic step count.
- **A queue in the diagram that does nothing** — or Redis in front of a
  ten-unit sale with no measurement to justify it. Unexplained boxes read as
  cargo cult.
- **Tests that only cover the happy path.** The interesting cases must *fail*:
  second purchase, sold out, before the window, after it.
- **Unexplained numbers.** Say what ran where, and what the bottleneck was.
- **Mock data presented as real.** The mock adapter is labelled on screen for
  exactly this reason; keep it that way.
- **Not being able to explain your own code.** Rewrite anything you would not
  defend line by line.
