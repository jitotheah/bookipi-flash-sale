import type { Order } from '@flash/shared';

/**
 * Where a confirmed reservation goes to become a durable business record
 * (receipt, fulfilment, analytics).
 *
 * It is deliberately fire-and-forget: the user's HTTP response is already
 * decided by the time this runs, so a slow database must never add latency to
 * the purchase path, and a database outage must never turn a reservation the
 * user already owns into an error.
 *
 * This hook exists for the Redis driver, where the reservation lives somewhere
 * that is not yet the durable business record. The Postgres driver has no use
 * for it: there the reservation and the record are the same committed
 * transaction, so the no-op stays a no-op.
 *
 * GUIDE.md step 4: for the Redis path, replace the no-op with a push onto a
 * Redis Stream / SQS queue, and write a worker that drains it into Postgres.
 */
export interface OrderSink {
  record(order: Order): void;
}

export const noopOrderSink: OrderSink = {
  record() {
    /* step 4: enqueue for durable persistence */
  },
};
