import { randomUUID } from 'node:crypto';
import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
  SaleStatus,
} from '@flash/shared';
import type { SaleConfig } from '../config.ts';
import type { InventoryStore } from '../store/inventoryStore.ts';
import { noopOrderSink, type OrderSink } from '../persistence/orderSink.ts';

const USER_ID_PATTERN = /^[a-z0-9._@+-]{3,64}$/;

export interface FlashSaleDeps {
  store: InventoryStore;
  config: SaleConfig;
  sink?: OrderSink;
  /** Injectable so tests can stand at any point on the sale timeline. */
  now?: () => Date;
}

/**
 * All business rules live here, with no knowledge of HTTP. The route layer
 * only translates outcomes into status codes, which is why the rules can be
 * unit-tested without a server.
 */
export class FlashSaleService {
  readonly #store: InventoryStore;
  readonly #config: SaleConfig;
  readonly #sink: OrderSink;
  readonly #now: () => Date;

  constructor({ store, config, sink = noopOrderSink, now = () => new Date() }: FlashSaleDeps) {
    this.#store = store;
    this.#config = config;
    this.#sink = sink;
    this.#now = now;
  }

  /**
   * Normalises a user identifier into the dedupe key.
   *
   * NOTE for the write-up: in production this would be the authenticated
   * account id from a signed session, never a string the client chose --
   * otherwise "one per user" is bypassed by typing a different name. The task
   * asks for a user-entered identifier, so the demo takes one and treats it as
   * if it had been authenticated.
   */
  static normaliseUserId(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const normalised = raw.trim().toLowerCase();
    return USER_ID_PATTERN.test(normalised) ? normalised : null;
  }

  async getState(): Promise<SaleStateResponse> {
    const now = this.#now();
    const remaining = await this.#store.remaining();
    return {
      status: this.#statusAt(now, remaining),
      product: this.#config.product,
      startsAt: this.#config.startsAt.toISOString(),
      endsAt: this.#config.endsAt.toISOString(),
      totalStock: this.#config.totalStock,
      remainingStock: remaining,
      serverTime: now.toISOString(),
    };
  }

  async purchase(rawUserId: unknown): Promise<PurchaseResponse> {
    const userId = FlashSaleService.normaliseUserId(rawUserId);
    if (!userId) {
      return {
        outcome: 'invalid_user',
        order: null,
        message: 'Enter 3-64 characters: letters, numbers, or . _ - + @',
      };
    }

    // The window is checked before touching the store, so traffic that arrives
    // outside the sale is rejected without consuming an inventory round trip.
    // That matters: the minutes before a drop are the heaviest, and none of
    // those requests can possibly succeed.
    const now = this.#now();
    if (now < this.#config.startsAt) {
      return { outcome: 'sale_not_started', order: null, message: 'The sale has not started yet.' };
    }
    if (now > this.#config.endsAt) {
      return { outcome: 'sale_ended', order: null, message: 'This sale has ended.' };
    }

    const result = await this.#store.reserve(userId, randomUUID(), now);

    switch (result.status) {
      case 'reserved':
        this.#sink.record(result.order);
        return { outcome: 'purchased', order: result.order, message: 'Order confirmed.' };
      case 'duplicate':
        return {
          outcome: 'already_purchased',
          order: result.order,
          message: 'You already secured one. Limit is one per customer.',
        };
      case 'sold_out':
        return { outcome: 'sold_out', order: null, message: 'This item is no longer available.' };
    }
  }

  async lookup(rawUserId: unknown): Promise<PurchaseLookupResponse | null> {
    const userId = FlashSaleService.normaliseUserId(rawUserId);
    if (!userId) return null;
    const order = await this.#store.findOrder(userId);
    return { userId, hasPurchased: order !== null, order };
  }

  #statusAt(now: Date, remaining: number): SaleStatus {
    if (now < this.#config.startsAt) return 'upcoming';
    if (now > this.#config.endsAt) return 'ended';
    return remaining > 0 ? 'active' : 'sold_out';
  }
}
