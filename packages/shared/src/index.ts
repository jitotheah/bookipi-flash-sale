/**
 * The API contract, shared by the server and the React app.
 *
 * Keeping it in one workspace package means a breaking change to a response
 * shape fails `npm run typecheck` on both sides instead of at runtime in the
 * browser.
 */

export type SaleStatus = 'upcoming' | 'active' | 'ended' | 'sold_out';

export interface Product {
  id: string;
  name: string;
  tagline: string;
  priceCents: number;
  currency: string;
  colour: string;
}

/** GET /api/sale */
export interface SaleStateResponse {
  status: SaleStatus;
  product: Product;
  startsAt: string;
  endsAt: string;
  totalStock: number;
  /**
   * Advisory only. It is read outside the purchase transaction, so by the time
   * the browser renders it the real number may already be lower. Never make a
   * purchase decision from this value -- only POST /api/purchase is truth.
   */
  remainingStock: number;
  serverTime: string;
}

/** The one place a purchase attempt's outcome is named. */
export type PurchaseOutcome =
  | 'purchased'
  | 'already_purchased'
  | 'sold_out'
  | 'sale_not_started'
  | 'sale_ended'
  | 'invalid_user';

export interface Order {
  orderId: string;
  userId: string;
  createdAt: string;
}

/** POST /api/purchase */
export interface PurchaseResponse {
  outcome: PurchaseOutcome;
  order: Order | null;
  message: string;
}

/** GET /api/purchase/:userId */
export interface PurchaseLookupResponse {
  userId: string;
  hasPurchased: boolean;
  order: Order | null;
}

/** Every non-2xx response the API produces uses this envelope. */
export interface ApiError {
  outcome: PurchaseOutcome | 'error';
  message: string;
}
