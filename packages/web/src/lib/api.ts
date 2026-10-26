import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
} from '@flash/shared';

/**
 * Thin typed wrapper over fetch.
 *
 * Note that 409 and 400 are *expected* answers here, not failures: "sold out"
 * and "already purchased" are outcomes the UI renders, so they are parsed
 * rather than thrown. Only transport failures and 5xx become exceptions.
 */
async function parse<T>(response: Response, allowed: number[]): Promise<T> {
  if (!allowed.includes(response.status)) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchSaleState(signal?: AbortSignal): Promise<SaleStateResponse> {
  return parse<SaleStateResponse>(await fetch('/api/sale', { signal }), [200]);
}

export async function attemptPurchase(userId: string): Promise<PurchaseResponse> {
  const response = await fetch('/api/purchase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return parse<PurchaseResponse>(response, [200, 201, 400, 409]);
}

export async function fetchExistingOrder(userId: string): Promise<PurchaseLookupResponse> {
  const response = await fetch(`/api/purchase/${encodeURIComponent(userId)}`);
  return parse<PurchaseLookupResponse>(response, [200, 400]);
}

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatOrderId(orderId: string): string {
  return `#${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
