import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
} from '@flash/shared';
import { ApiNotImplementedError } from './apiError.ts';

/**
 * The live adapter: talks to the Fastify API.
 *
 * 409 and 400 are *expected* answers, not failures — "sold out" and "already
 * purchased" are outcomes the UI renders, so they are parsed rather than
 * thrown. 501 means the backend driver is still a stub. Everything else
 * (5xx, transport failure) throws, and the caller treats the outcome as
 * UNKNOWN rather than assuming nothing happened.
 */
async function parse<T>(response: Response, allowed: number[]): Promise<T> {
  if (response.status === 501) {
    const body = await response.json().catch(() => ({ message: 'Not implemented' }));
    throw new ApiNotImplementedError(body.message);
  }
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
