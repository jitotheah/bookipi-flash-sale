import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
} from '@flash/shared';
import { ApiNotImplementedError } from './apiError.ts';

const REQUEST_TIMEOUT_MS = 8_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  return signal
    ? AbortSignal.any([signal, timeout])
    : timeout;
}

async function parse<T>(
  response: Response,
  allowed: number[],
): Promise<T> {
  if (response.status === 501) {
    const body = await response.json().catch(() => ({
      message: 'Not implemented',
    }));

    throw new ApiNotImplementedError(body.message);
  }

  if (!allowed.includes(response.status)) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchSaleState(
  signal?: AbortSignal,
): Promise<SaleStateResponse> {
  const response = await fetch('/api/sale', {
    signal: requestSignal(signal),
  });

  return parse<SaleStateResponse>(response, [200]);
}

export async function attemptPurchase(
  userId: string,
): Promise<PurchaseResponse> {
  const response = await fetch('/api/purchase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
    signal: requestSignal(),
  });

  return parse<PurchaseResponse>(response, [200, 201, 400, 409]);
}

export async function fetchExistingOrder(
  userId: string,
): Promise<PurchaseLookupResponse> {
  const response = await fetch(
    `/api/purchase/${encodeURIComponent(userId)}`,
    {
      cache: 'no-store',
      signal: requestSignal(),
    },
  );

  return parse<PurchaseLookupResponse>(response, [200]);
}