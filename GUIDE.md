# Build order

The skeleton gives you a system that is already correct and already load-tested
— on one process. Everything below turns that into something you can defend as
a distributed design. Each step is independently demoable, so if you run out of
time you stop at a working state rather than a half-finished one.

**Suggested budget: ~8 hours.** Steps 1, 2, 3a and 7 are the ones that get
marked. Step 5 is cheap and shows systems thinking. Step 3b is the stretch
goal: do it if you want to *measure* the Postgres-vs-Redis trade-off rather
than assert it. Steps 4 and 6 can be partly written up instead of built, as
long as you say so.

---

## Step 0 — Make it yours (30 min)

Read these four files in order. They are the whole mental model:

1. `packages/server/src/store/inventoryStore.ts` — the contract everything rests on
2. `packages/server/src/store/memoryStore.ts` — the simplest thing that satisfies it
3. `packages/server/src/domain/flashSale.ts` — the business rules
4. `packages/server/test/flashSale.test.ts` — what "correct" means, executably

Then run `npm test` and `npm run stress` so you have seen green before you
change anything.

Change the product, the copy, the stock — make it a repo you wrote. Reviewers
notice when a candidate cannot explain a line of their own submission, and
*that* is the real risk of starting from a skeleton.

---

## Step 1 — Prove the race exists (30 min) ⭐ do not skip

Before writing concurrency control, demonstrate the bug it prevents. In
`memoryStore.ts`, split the critical section:

```ts
const current = this.#remaining;
await new Promise((r) => setImmediate(r));   // yields the event loop
if (current <= 0) return { status: 'sold_out' };
this.#remaining = current - 1;
```

Run `npm test`. The oversell test fails — you will sell far more than 10. Put
it back.

This is the single most valuable thing in the whole submission. It turns "I
used Redis because it is atomic" into "here is the failure mode, here is the
test that catches it, here is why the fix works." Keep the broken version on a
branch or in a comment so you can show it in the interview.

---

## Step 2 — A failing contract test for the real driver (30 min)

Pull the two invariant tests out of `flashSale.test.ts` into a function that
takes a store factory:

```ts
export function itBehavesLikeAnInventoryStore(makeStore: () => InventoryStore) {
  it('never oversells', async () => { /* the 500-caller test */ });
  it('allows one unit per user', async () => { /* the duplicate test */ });
}
```

Call it for `MemoryInventoryStore`, then `PostgresInventoryStore`, then
`RedisInventoryStore`. The latter two fail (the stubs throw) — that is your
to-do list for step 3, and it means every driver is held to one standard
rather than one standard each.

---

## Step 3a — The Postgres driver (2–3 hours) ⭐ the core

`docker compose up -d postgres`, `npm i pg -w @flash/server`, then fill in
`postgresStore.ts`. The file carries the schema, the full transaction, the
reason it cannot oversell, and the four things a reviewer looks for.

**This is the driver I would submit as the default.** One system, one source of
truth, and the `UNIQUE (sale_id, user_id)` index is an independent guarantee of
one-per-user that no application bug can defeat. For ten units it is very
likely the correct engineering answer, and being able to say *why Redis would
be premature here* is worth more than using Redis.

The three details that separate a working version from a good one are in the
file: `ON CONFLICT` instead of catching `23505`, `clock_timestamp()` instead of
`now()`, and `INSERT` before the contended `UPDATE`.

Done when:
- `INVENTORY_DRIVER=postgres npm test` is green — same tests, different driver
- two API instances on different ports share one database and the stress test
  still sells exactly 10. *This is the experiment the memory driver cannot
  pass.*

```bash
PORT=3001 INVENTORY_DRIVER=postgres npm run dev:server
PORT=3002 INVENTORY_DRIVER=postgres npm run dev:server
```

Then push it until it hurts, because the failure mode is the interesting part:
raise `--users` until latency degrades, and watch **the connection pool**, not
the row lock, be what breaks. Record the number. "It held 10/10 correct at
5,000 concurrent, and the limit was pool saturation at N, which PgBouncer
would move" is a far better answer than a throughput figure with no ceiling
identified.

Decide and write down what happens when the database is unreachable: **fail
closed**, 503, no sale, client retries. Never fall back to the memory driver —
that is how you oversell during an incident.

---

## Step 3b — The Redis driver (2 hours, stretch)

Only worth doing once 3a is green and measured. `docker compose up -d redis`,
`npm i ioredis -w @flash/server`, then fill in `redisStore.ts` — it carries the
suggested keys, a sketch of the Lua, and its own four review points.

The one rule: **dedupe check + stock check + decrement must be a single
command.** Three round trips with application logic between them is the bug
from step 1, now distributed and much harder to see.

The payoff is not "Redis is faster" — it is a table in your README with both
drivers, same stress test, same assertions, different numbers and different
failure modes. That is the difference between claiming a trade-off and
demonstrating one.

If Redis is unreachable: fail closed, exactly as above.

## Step 4 — Durability (1–2 hours)

**Skip this entirely if you shipped the Postgres driver** — there the
reservation and the business record are the same committed transaction, so
there is nothing to drain and nothing to reconcile. Say that in the README; it
is a point in the design's favour, not an omission.

It applies to the Redis path. `packages/server/src/persistence/orderSink.ts` is
the hook: replace the no-op with an `XADD` onto a Redis Stream, and write a
worker that reads the stream and inserts into Postgres using the schema in
`postgresStore.ts`.

Keep it strictly off the hot path: the HTTP response is decided before the sink
is called. If you are short on time, implement the enqueue and describe the
worker in the README rather than building both badly.

---

## Step 5 — Shed the read load (45 min, high value per minute)

1. **Cache `GET /api/sale`.** A 1-second per-process memo is ~10 lines and cuts
   read load on the store by orders of magnitude. Note in the README that the
   production version is a CDN with a 1s TTL.
2. **Rate limit `POST /api/purchase`.** `@fastify/rate-limit`, keyed on user
   identifier *and* IP. Flash sales attract scripts; this is where you say so.
3. **Set a connection cap and a request timeout.** A server that sheds load
   under overload stays up; one that accepts everything falls over.

---

## Step 6 — Failure modes (1 hour, mostly writing)

Answer these in the README. They are what "robustness" means in the brief, and
they are the likeliest interview questions:

- **An API instance dies mid-request.** Nothing is lost: the reservation either
  committed atomically or did not happen. The client retries safely because
  `reserve` is keyed by user — a retry returns `already_purchased`.
- **The database dies** (Postgres path). Nothing is oversold — no transaction
  commits, so every request fails closed with a 503 and retries safely. Restore
  is a normal restore; there is no divergent in-memory truth to reconcile.
- **Redis dies** (Redis path). AOF `everysec` (already in `docker-compose.yml`)
  bounds the loss to ~1s of reservations. Add a replica for failover. On cold start,
  rebuild stock from Postgres rather than re-seeding blindly — otherwise a
  restart refills the shelf and you oversell. This is why `init` must use
  `SET … NX`.
- **The worker falls behind** (Redis path only). Users hold valid reservations that are not yet in
  Postgres. Acceptable: the queue drains. Add a reconciliation job that compares
  Redis order count against `SELECT count(*)` and alerts on drift.
- **A node's clock is wrong.** The sale boundary is read from one server's
  clock. Mention NTP, and that moving the window check into the Lua script
  removes the skew entirely at the cost of one branch in the hot path.

---

## Step 7 — Make the testing section earn its marks (1–2 hours)

The brief asks you to *explain* your stress results, so the write-up matters as
much as the run.

- Port `stress/run.mjs` to k6 for a ramping profile and threshold-based
  pass/fail (`k6 run --vus 2000 --duration 30s`). Keep the Node script — "no
  dependencies, runs anywhere" is a feature.
- Run the generator from a different machine (or a container with a CPU limit)
  so the numbers measure the server, not the client. State the setup next to
  the numbers.
- Add the soak variant: hammer `GET /api/sale` throughout the purchase burst and
  show reads do not starve writes.
- Add the failure test: kill an API instance mid-run and show the invariants
  still hold.

Put a short table in the README: scenario, requests, winners, p99, verdict.

---

## Step 8 — The write-up (1 hour)

The README has the skeleton of this already; make the reasoning yours.

- The diagram is in the README as ASCII. If you prefer a picture, redraw it in
  Excalidraw or Mermaid and commit the export — do not leave both.
- For every component, one sentence on what you would *remove* if traffic were
  10x smaller. Knowing when a queue is overkill reads as better judgement than
  adding one everywhere.
- Be explicit about what you did not build and why. "I mocked persistence to
  spend the time on concurrency correctness, which is where the risk is" is a
  strong answer. Silence looks like an oversight.

---

## Things that cost people marks

- **Overselling under load.** Everything else is secondary; the stress test must
  prove it.
- **"One per user" enforced in the frontend.** Disabling the button is UX. The
  only enforcement that counts is inside the atomic step.
- **A queue in the diagram that does nothing.** Either wire it up or explain why
  it is out of scope. An unexplained box reads as cargo cult — and so does
  Redis in front of a ten-unit sale with no measurement to justify it.
- **Tests that only cover the happy path.** The interesting cases are the ones
  that must *fail*: second purchase, sold out, before the window, after it.
- **Unexplained numbers.** "1844 req/s" alone means nothing. Say what was
  running where, and what the bottleneck was.
- **Not being able to explain your own code.** Rewrite anything you would not
  defend line by line.
