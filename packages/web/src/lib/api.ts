import * as httpApi from './httpApi.ts';
import * as mockApi from './mockApi.ts';
import { readScenario } from './mockApi.ts';

export { ApiNotImplementedError } from './apiError.ts';
export type { MockScenario } from './mockApi.ts';

export type ApiMode = 'mock' | 'live';

/**
 * Which adapter the app talks to.
 *
 * Default is **mock**, because the backend's purchase transaction is still a
 * stub (GUIDE.md step 4) — the UI must be demoable and reviewable before that
 * exists. Switch with `?api=live` in the URL, or VITE_API_MODE=live at build
 * time, once you have a driver that works.
 *
 * Whenever the mock is active the UI shows a labelled banner. Simulated data
 * must never be mistakable for real data.
 */
function resolveMode(): ApiMode {
  const override = new URLSearchParams(window.location.search).get('api');
  if (override === 'live' || override === 'mock') return override;
  return import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';
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
