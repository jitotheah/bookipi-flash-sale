import type {
  PurchaseLookupResponse,
  PurchaseResponse,
  SaleStateResponse,
} from '@flash/shared';
import { ApiNotImplementedError } from './apiError.ts';

/**
 * ============================================================================
 *  MOCK ADAPTER — simulated data, entirely in this browser tab.
 * ============================================================================
 *
 * It exists so the UI can be built and demoed while the backend purchase
 * transaction is still a stub. It is NOT a second implementation of the
 * business rules and must never become one: it fakes outcomes so the screens
 * can be seen, it does not prove anything about concurrency. The real
 * invariants are proved by the server's tests.
 *
 * Nothing here is shared between tabs, survives a refresh, or is authoritative.
 * Whenever it is active the UI shows a labelled banner saying so.
 *
 * Scenarios — append `?mock=<name>` to the URL:
 *   active     (default)  an open sale with 10 units
 *   upcoming             starts in two minutes
 *   ended                closed an hour ago
 *   sold_out             open, zero stock
 *   last_one             open, one unit left — race two tabs against it
 *   slow                 2.5s purchases, to sit in the "purchasing" state
 *   uncertain            purchases fail at the transport layer, outcome unknown
 *   unimplemented        every call answers like a 501 stub driver
 */

export type MockScenario =
  | 'active'
  | 'upcoming'
  | 'ended'
  | 'sold_out'
  | 'last_one'
  | 'slow'
  | 'uncertain'
  | 'unimplemented';

const SCENARIOS: MockScenario[] = [
  'active',
  'upcoming',
  'ended',
  'sold_out',
  'last_one',
  'slow',
  'uncertain',
  'unimplemented',
];

export function readScenario(search = window.location.search): MockScenario {
  const requested = new URLSearchParams(search).get('mock');
  return SCENARIOS.includes(requested as MockScenario) ? (requested as MockScenario) : 'active';
}

const MINUTE = 60_000;
const scenario = readScenario();

const windowFor = (s: MockScenario) => {
  const now = Date.now();
  if (s === 'upcoming') return { startsAt: now + 2 * MINUTE, endsAt: now + 62 * MINUTE };
  if (s === 'ended') return { startsAt: now - 120 * MINUTE, endsAt: now - 60 * MINUTE };
  return { startsAt: now - MINUTE, endsAt: now + 59 * MINUTE };
};

const state = {
  ...windowFor(scenario),
  totalStock: 10,
  remainingStock: scenario === 'sold_out' ? 0 : scenario === 'last_one' ? 1 : 10,
  orders: new Map<string, { orderId: string; createdAt: string }>(),
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const latency = () => wait(scenario === 'slow' ? 2_500 : 120 + Math.random() * 180);

function unimplemented(operation: string): never {
  // Same error type the live adapter raises on a 501, so the UI takes the same
  // path whether the stub is mocked or real.
  throw new ApiNotImplementedError(`${operation} is not implemented yet — see GUIDE.md step 4`);
}

function status(): SaleStateResponse['status'] {
  const now = Date.now();
  if (now < state.startsAt) return 'upcoming';
  if (now > state.endsAt) return 'ended';
  return state.remainingStock > 0 ? 'active' : 'sold_out';
}

export async function fetchSaleState(_signal?: AbortSignal): Promise<SaleStateResponse> {
  if (scenario === 'unimplemented') unimplemented('PostgresInventoryStore.remaining()');
  await wait(60);
  return {
    status: status(),
    product: {
      id: 'iphone-17-pro',
      name: 'iPhone 17 Pro',
      tagline: 'Titanium. Unreasonably fast. Yours for one hour only.',
      priceCents: 149_900,
      currency: 'USD',
      colour: '#2f3542',
    },
    startsAt: new Date(state.startsAt).toISOString(),
    endsAt: new Date(state.endsAt).toISOString(),
    totalStock: state.totalStock,
    remainingStock: state.remainingStock,
    serverTime: new Date().toISOString(),
  };
}

export async function attemptPurchase(userId: string): Promise<PurchaseResponse> {
  if (scenario === 'unimplemented') unimplemented('PostgresInventoryStore.reserve()');
  await latency();

  if (scenario === 'uncertain') {
    // The outcome genuinely is unknown to the client here -- the request may
    // have committed before the connection dropped. The UI must not guess.
    throw new Error('Simulated transport failure after the request was sent');
  }

  const existing = state.orders.get(userId);
  if (existing) {
    return {
      outcome: 'already_purchased',
      order: { ...existing, userId },
      message: 'You already secured one. Limit is one per customer.',
    };
  }

  const now = Date.now();
  if (now < state.startsAt) {
    return { outcome: 'sale_not_started', order: null, message: 'The sale has not started yet.' };
  }
  if (now > state.endsAt) {
    return { outcome: 'sale_ended', order: null, message: 'This sale has ended.' };
  }
  if (state.remainingStock <= 0) {
    return { outcome: 'sold_out', order: null, message: 'This item is no longer available.' };
  }

  state.remainingStock -= 1;
  const order = { orderId: crypto.randomUUID(), createdAt: new Date().toISOString() };
  state.orders.set(userId, order);
  return { outcome: 'purchased', order: { ...order, userId }, message: 'Order confirmed.' };
}

export async function fetchExistingOrder(userId: string): Promise<PurchaseLookupResponse> {
  if (scenario === 'unimplemented') unimplemented('PostgresInventoryStore.findOrder()');
  await wait(60);
  const order = state.orders.get(userId);
  return {
    userId,
    hasPurchased: order !== undefined,
    order: order ? { ...order, userId } : null,
  };
}
