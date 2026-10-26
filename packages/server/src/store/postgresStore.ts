import type { Order } from '@flash/shared';
import { NotImplementedError } from '../errors.ts';
import type { InventoryStore, ReservationResult } from './inventoryStore.ts';

/**
 * ============================================================================
 *  GUIDE.md step 4 -- the recommended implementation path. Write it yourself.
 * ============================================================================
 *
 * Schema lives in `packages/server/db/schema.sql` (proposed, not yet applied).
 *
 * ---------------------------------------------------------------------------
 *  THE FOUR TRANSACTION REQUIREMENTS
 *  Every one of these must hold under concurrent load. They are the acceptance
 *  criteria for this file, and the test checklist in the README mirrors them.
 * ---------------------------------------------------------------------------
 *
 *  R1. THE SALE WINDOW IS ENFORCED ON THE SERVER.
 *      A purchase outside [starts_at, ends_at) must be refused regardless of
 *      what the client believes. Put the check in the SQL predicate, using
 *      clock_timestamp() rather than now(): now() is transaction-START time,
 *      and this statement may have spent time blocked on the row lock.
 *      Checking it in SQL also judges the window by ONE clock however many API
 *      nodes exist -- strictly better than the per-node check the skeleton
 *      currently does in flashSale.ts.
 *
 *  R2. STOCK CAN NEVER GO NEGATIVE.
 *      Two defences, both required. The predicate `remaining_stock > 0` in the
 *      UPDATE, and `CHECK (remaining_stock >= 0)` on the column. The predicate
 *      is the mechanism; the CHECK is the proof that a future bug cannot
 *      quietly oversell.
 *
 *  R3. ONE PURCHASE PER USER, ENFORCED BY THE DATABASE.
 *      UNIQUE (sale_id, user_id) on `purchases`. Not a uniqueness check in
 *      application code -- a constraint, so it holds even if the reservation
 *      logic has a race.
 *
 *  R4. A FAILED OR DUPLICATE PURCHASE MUST NEVER CONSUME STOCK.
 *      This is the one most often got wrong. If the INSERT reports a duplicate,
 *      you must NOT run the decrement: return early and ROLLBACK. If the
 *      decrement reports zero rows, the INSERT must not survive. Either both
 *      effects happen or neither does -- that is what the transaction is for.
 *
 * ---------------------------------------------------------------------------
 *  THE TRANSACTION
 * ---------------------------------------------------------------------------
 *
 *   BEGIN;
 *
 *   -- ON CONFLICT rather than catching 23505: a unique violation aborts the
 *   -- WHOLE transaction, so you could not then look up the original order to
 *   -- return it. Zero rows here means "already bought", transaction still
 *   -- alive -- and per R4 you must stop here, before the decrement.
 *   INSERT INTO purchases (order_id, sale_id, user_id)
 *   VALUES ($1, $2, $3)
 *   ON CONFLICT (sale_id, user_id) DO NOTHING
 *   RETURNING order_id, created_at;
 *
 *   -- Only if the INSERT returned a row. Inserting BEFORE this contended
 *   -- UPDATE is deliberate: it shortens the time this transaction holds the
 *   -- exclusive lock on the single `sales` row, which every buyer queues on.
 *   UPDATE sales
 *      SET remaining_stock = remaining_stock - 1
 *    WHERE id = $2
 *      AND remaining_stock > 0
 *      AND clock_timestamp() >= starts_at
 *      AND clock_timestamp() <  ends_at
 *   RETURNING remaining_stock;
 *
 *   COMMIT;   -- or ROLLBACK if either step came back empty
 *
 * Why that UPDATE cannot oversell, which is the part worth being able to
 * explain out loud: under READ COMMITTED a blocked UPDATE re-evaluates its
 * WHERE clause against the row version written by the transaction it waited
 * for (EvalPlanQual). So `remaining_stock > 0` is tested AFTER the wait, not
 * before. Under REPEATABLE READ or SERIALIZABLE the same statement raises a
 * 40001 serialization failure instead and you need a bounded retry loop --
 * know which isolation level your driver opens transactions with.
 *
 * ---------------------------------------------------------------------------
 *  THEN THE PARTS A REVIEWER WILL PROBE
 * ---------------------------------------------------------------------------
 *
 *   1. A zero-row UPDATE cannot tell you WHY it failed. Sold out, not started
 *      and already ended are three different screens in the UI, so classify
 *      with a SELECT on the sales row before you roll back. Collapsing all
 *      three into one "unavailable" is the most common hole in this design,
 *      and `ReservationResult` is typed to stop you doing it.
 *   2. The bottleneck is the connection pool, not the row lock. Thousands of
 *      concurrent buyers against a pool of tens means requests queue inside
 *      the API: latency climbs, timeouts cascade, and the API falls over while
 *      Postgres sits there healthy. Keep transactions short, set lock_timeout
 *      and statement_timeout so waiters fail fast, and put PgBouncer
 *      (transaction mode) in front.
 *   3. Short-circuit the losers. Once stock is zero, a cached flag lets the
 *      other 99% of requests be answered without opening a transaction at all.
 *      The cheapest large win available to this driver.
 *   4. `init` must not refill the shelf on a deploy mid-sale: seed with
 *      INSERT ... ON CONFLICT (id) DO NOTHING, as schema.sql does.
 *   5. If the database is unreachable: FAIL CLOSED. 503, no sale, client
 *      retries. Never fall back to the memory driver -- that is how you
 *      oversell during an incident.
 */
export class PostgresInventoryStore implements InventoryStore {
  constructor(
    private readonly databaseUrl: string,
    private readonly saleId = 1,
  ) {}

  async init(_totalStock: number): Promise<void> {
    throw new NotImplementedError('PostgresInventoryStore.init()', 'step 4');
  }

  async reserve(_userId: string, _orderId: string, _at: Date): Promise<ReservationResult> {
    throw new NotImplementedError('PostgresInventoryStore.reserve()', 'step 4');
  }

  async findOrder(_userId: string): Promise<Order | null> {
    throw new NotImplementedError('PostgresInventoryStore.findOrder()', 'step 4');
  }

  async remaining(): Promise<number> {
    throw new NotImplementedError('PostgresInventoryStore.remaining()', 'step 4');
  }

  async close(): Promise<void> {
    /* end the pg Pool here once you add it */
  }
}
