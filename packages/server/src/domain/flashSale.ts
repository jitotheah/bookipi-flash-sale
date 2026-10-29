import { randomUUID } from 'node:crypto';
import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
  SaleStatus,
} from '@flash/shared';
import type { SaleConfig } from '../config.ts';
import type {
  InventoryStore,
  SaleSnapshot,
} from '../store/inventoryStore.ts';

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
    const sale: SaleSnapshot = this.#store.getSale
      ? await this.#store.getSale()
      : {
        productId: this.#config.product.id,
        startsAt: this.#config.startsAt,
        endsAt: this.#config.endsAt,
        totalStock: this.#config.totalStock,
        remainingStock: await this.#store.remaining(),
        serverTime: this.#now(),
      };

    if (sale.productId !== this.#config.product.id) {
      throw new Error(
        'Stored sale product does not match the configured product.',
      );
    }

    return {
      status: this.#statusAt(sale),
      product: this.#config.product,
      startsAt: sale.startsAt.toISOString(),
      endsAt: sale.endsAt.toISOString(),
      totalStock: sale.totalStock,
      remainingStock: sale.remainingStock,
      serverTime: sale.serverTime.toISOString(),
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

    const result = await this.#store.reserve(
      userId,
      randomUUID(),
      this.#now(),
      this.#config,
    );

    switch (result.status) {
      case 'reserved':
        this.#sink.record(result.order);

        return {
          outcome: 'purchased',
          order: result.order,
          message: 'Order confirmed.',
        };

      case 'duplicate':
        return {
          outcome: 'already_purchased',
          order: result.order,
          message: 'You already secured one. Limit is one per customer.',
        };

      case 'sold_out':
        return {
          outcome: 'sold_out',
          order: null,
          message: 'This item is no longer available.',
        };

      case 'sale_not_started':
        return {
          outcome: 'sale_not_started',
          order: null,
          message: 'The sale has not started yet.',
        };

      case 'sale_ended':
        return {
          outcome: 'sale_ended',
          order: null,
          message: 'This sale has ended.',
        };
    }
  }

  async lookup(rawUserId: unknown): Promise<PurchaseLookupResponse | null> {
    const userId = FlashSaleService.normaliseUserId(rawUserId);
    if (!userId) return null;
    const order = await this.#store.findOrder(userId);
    return { userId, hasPurchased: order !== null, order };
  }

  #statusAt(sale: SaleSnapshot): SaleStatus {
    if (sale.serverTime < sale.startsAt) return 'upcoming';
    if (sale.serverTime >= sale.endsAt) return 'ended';

    return sale.remainingStock > 0 ? 'active' : 'sold_out';
  }
}
