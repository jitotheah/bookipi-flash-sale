import * as httpApi from './httpApi.ts';
import * as mockApi from './mockApi.ts';
import { readScenario } from './mockApi.ts';

export { ApiNotImplementedError } from './apiError.ts';
export type { MockScenario } from './mockApi.ts';

export type ApiMode = 'mock' | 'live';

/**
 * Uses the live API by default.
 * Override with ?api=mock for simulated UI previews,
 * or ?api=live to explicitly select the backend.
 */
function resolveMode(): ApiMode {
  const override = new URLSearchParams(window.location.search).get('api');
  if (override === 'live' || override === 'mock') return override;
  return import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'live';
}

export const API_MODE: ApiMode = resolveMode();
export const MOCK_SCENARIO = readScenario();

const adapter = API_MODE === 'mock' ? mockApi : httpApi;

export const fetchSaleState = adapter.fetchSaleState;
export const attemptPurchase = adapter.attemptPurchase;
export const fetchExistingOrder = adapter.fetchExistingOrder;

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
