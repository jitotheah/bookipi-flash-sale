import type { Order } from '@flash/shared';
import type { InventoryStore, ReservationResult } from './inventoryStore.ts';

/**
 * ============================================================================
 *  GUIDE.md step 3a -- the durable-by-default driver. Write it yourself.
 * ============================================================================
 *
 * One system instead of three: the reservation and the business record are the
 * same committed transaction, so there is no queue, no worker, and no window
 * where a user holds a unit that nothing durable knows about. For a ten-unit
 * sale that is very likely the right engineering answer, and saying so is
 * worth more than reaching for Redis reflexively.
 *
 * Schema -- the unique index is not an optimisation, it is the second,
 * independent guarantee of one-per-user, enforced by storage rather than by
 * application logic:
 *
 *   CREATE TABLE sales (
 *     id              int PRIMARY KEY,
 *     remaining_stock int         NOT NULL CHECK (remaining_stock >= 0),
 *     starts_at       timestamptz NOT NULL,
 *     ends_at         timestamptz NOT NULL
 *   );
 *
 *   CREATE TABLE purchases (
 *     order_id   uuid PRIMARY KEY,
 *     sale_id    int         NOT NULL REFERENCES sales(id),
 *     user_id    text        NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 *     UNIQUE (sale_id, user_id)
 *   );
 *
 * The transaction, in this order. Inserting BEFORE the contended UPDATE is
 * deliberate: it shortens the time this transaction holds the exclusive lock
 * on the single `sales` row, which is the one thing every buyer queues behind.
 *
 *   BEGIN;
 *
 *   -- ON CONFLICT rather than catching 23505: a unique violation aborts the
 *   -- whole transaction, so you could not then look up the original order to
 *   -- return it. Zero rows here means "already bought", with the transaction
 *   -- still alive.
 *   INSERT INTO purchases (order_id, sale_id, user_id)
 *   VALUES ($1, $2, $3)
 *   ON CONFLICT (sale_id, user_id) DO NOTHING
 *   RETURNING order_id, created_at;
 *
 *   -- clock_timestamp(), not now(): now() is transaction-START time, and this
 *   -- statement may have spent time blocked on the row lock. It also means the
 *   -- window is judged by ONE clock, however many API nodes there are.
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
 * explain: under READ COMMITTED a blocked UPDATE re-evaluates its WHERE clause
 * against the row version written by the transaction it waited for
 * (EvalPlanQual). So `remaining_stock > 0` is tested AFTER the wait, not
 * before. Under REPEATABLE READ or SERIALIZABLE the same statement raises a
 * 40001 serialization failure instead, and you need a bounded retry loop --
 * know which isolation level your driver opens transactions with.
 *
 * Things the reviewer will look for, in rough order of importance:
 *   1. A zero-row UPDATE cannot tell you WHY it failed. Sold out, not started
 *      and already ended are three different screens in the UI, so classify
 *      with a follow-up SELECT on the sales row before you roll back. Mapping
 *      all three onto one "unavailable" is the most common hole in this design.
 *   2. The bottleneck is the connection pool, not the row lock. Thousands of
 *      concurrent buyers against a pool of tens means requests queue inside
 *      the API: latency climbs, timeouts cascade, and the API falls over while
 *      Postgres sits there healthy. Keep transactions short, set lock_timeout
 *      and statement_timeout so waiters fail fast, and put PgBouncer
 *      (transaction mode) in front.
 *   3. Short-circuit the losers. Once stock is zero, a cached flag lets the
 *      other 99% of requests be answered without opening a transaction at all.
 *      This is the cheapest large win available to this driver.
 *   4. `init` must not refill the shelf on a deploy mid-sale: seed with
 *      INSERT ... ON CONFLICT (id) DO NOTHING.
 */
export class PostgresInventoryStore implements InventoryStore {
  constructor(
    private readonly databaseUrl: string,
    private readonly saleId = 1,
  ) {}

  async init(_totalStock: number): Promise<void> {
    throw new Error('PostgresInventoryStore is not implemented yet -- see GUIDE.md step 3a');
  }

  async reserve(_userId: string, _orderId: string, _at: Date): Promise<ReservationResult> {
    throw new Error('PostgresInventoryStore is not implemented yet -- see GUIDE.md step 3a');
  }

  async findOrder(_userId: string): Promise<Order | null> {
    throw new Error('PostgresInventoryStore is not implemented yet -- see GUIDE.md step 3a');
  }

  async remaining(): Promise<number> {
    throw new Error('PostgresInventoryStore is not implemented yet -- see GUIDE.md step 3a');
  }

  async close(): Promise<void> {
    /* end the pg Pool here once you add it */
  }
}
