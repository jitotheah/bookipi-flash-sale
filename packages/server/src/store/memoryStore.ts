import type { Order } from '@flash/shared';
import type {
  InventoryStore,
  ReservationResult,
  SaleWindow,
} from './inventoryStore.ts';
/**
 * Single-process inventory. The default driver: zero dependencies, so `npm
 * test` and the demo run with nothing installed.
 *
 * Why this is race-free: `reserve` contains no `await`. Node runs JavaScript on
 * one thread and only yields at an await point, so the check-and-decrement
 * below executes as one uninterruptible unit no matter how many requests are in
 * flight. Add an `await` between the check and the decrement and you have
 * reintroduced the classic oversell bug -- there is a test pinning this.
 *
 * What it cannot do: survive a restart, or stay correct across more than one
 * API process. The PostgreSQL store supplies persistence and coordination
 * across processes; the Redis store remains an optional stub.
 */
export class MemoryInventoryStore implements InventoryStore {
  #remaining = 0;
  readonly #ordersByUser = new Map<string, Order>();

  async init(totalStock: number): Promise<void> {
    this.#remaining = totalStock;
    this.#ordersByUser.clear();
  }

  async reserve(
    userId: string,
    orderId: string,
    at: Date,
    configuredWindow: SaleWindow,
  ): Promise<ReservationResult> {
    // Keep all checks and writes synchronous.
    const existing = this.#ordersByUser.get(userId);

    if (existing) {
      return { status: 'duplicate', order: existing };
    }

    if (at < configuredWindow.startsAt) {
      return { status: 'sale_not_started' };
    }

    if (at >= configuredWindow.endsAt) {
      return { status: 'sale_ended' };
    }

    if (this.#remaining <= 0) {
      return { status: 'sold_out' };
    }

    this.#remaining -= 1;

    const order: Order = {
      orderId,
      userId,
      createdAt: at.toISOString(),
    };

    this.#ordersByUser.set(userId, order);

    return {
      status: 'reserved',
      order,
      remaining: this.#remaining,
    };
  }

  async findOrder(userId: string): Promise<Order | null> {
    return this.#ordersByUser.get(userId) ?? null;
  }

  async remaining(): Promise<number> {
    return this.#remaining;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
