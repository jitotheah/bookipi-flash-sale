import type { Order } from '@flash/shared';

export type ReservationResult =
  | { status: 'reserved'; order: Order; remaining: number }
  | { status: 'duplicate'; order: Order }
  | { status: 'sold_out' }
  | { status: 'sale_not_started' }
  | { status: 'sale_ended' };

/**
 * The concurrency boundary of the whole system.
 *
 * `reserve` MUST be atomic: the "has this user bought?" check, the "is there
 * stock?" check and the decrement are one indivisible step. Any implementation
 * that performs them as separate round trips will oversell under load -- two
 * requests both read `remaining = 1` and both decrement.
 *
 * The caller supplies `orderId` so the operation is deterministic: a retry of
 * the same logical request produces the same record rather than a second one.
 */
export interface InventoryStore {
  /** Seed stock. Must be safe to call on every boot (idempotent). */
  init(totalStock: number): Promise<void>;
  reserve(userId: string, orderId: string, at: Date): Promise<ReservationResult>;
  findOrder(userId: string): Promise<Order | null>;
  /** Advisory count for the UI -- never used to decide whether a sale succeeds. */
  remaining(): Promise<number>;
  close(): Promise<void>;
}
