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
 * GUIDE.md step 4: replace the no-op with a push onto a Redis Stream / SQS
 * queue, and write a worker that drains it into Postgres.
 */
export interface OrderSink {
  record(order: Order): void;
}

export const noopOrderSink: OrderSink = {
  record() {
    /* step 4: enqueue for durable persistence */
  },
};
