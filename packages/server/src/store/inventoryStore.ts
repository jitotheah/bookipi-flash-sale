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
 * The concurrency boundary of the system.
 *
 * reserve must atomically combine duplicate detection, the sale-window/stock
 * decision, creation of the order, and the stock decrement. Several SQL
 * statements are safe when protected by one transaction on the same connection;
 * an unprotected read followed by a separate write is not.
 *
 * orderId is a proposed ID for a new order. Retries may propose different UUIDs:
 * deduplication uses the selected sale and normalized user ID, and returns the
 * original order. Persisted stores enforce their saved window using their own
 * authoritative clock; the memory store uses the supplied time and window.
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
