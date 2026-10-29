import type { Order } from '@flash/shared';

export interface SaleSnapshot {
  productId: string;
  startsAt: Date;
  endsAt: Date;
  totalStock: number;
  remainingStock: number;
  serverTime: Date;
}

export interface SaleWindow {
  startsAt: Date;
  endsAt: Date;
}

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
  init(totalStock: number): Promise<void>;

  /** Available when the store owns persisted sale settings. */
  getSale?(): Promise<SaleSnapshot>;

  reserve(
    userId: string,
    orderId: string,
    at: Date,
    configuredWindow: SaleWindow,
  ): Promise<ReservationResult>;

  findOrder(userId: string): Promise<Order | null>;
  remaining(): Promise<number>;
  close(): Promise<void>;
}
