import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { MemoryInventoryStore } from '../src/store/memoryStore.ts';
import { testConfig } from './helpers.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function databaseError(code: string) {
  return Object.assign(
    new Error('Simulated database failure'),
    { code },
  );
}

async function start(store: MemoryInventoryStore) {
  app = await buildApp({
    config: testConfig(),
    store,
  });

  return app;
}

function buy(api: FastifyInstance) {
  return api.inject({
    method: 'POST',
    url: '/api/purchase',
    payload: { userId: 'ada' },
  });
}

const failures = [
  {
    name: 'connection refusal',
    error: databaseError('ECONNREFUSED'),
  },
  {
    name: 'lock timeout',
    error: databaseError('55P03'),
  },
  {
    name: 'statement timeout',
    error: databaseError('57014'),
  },
  {
    name: 'pool timeout',
    error: new Error('timeout exceeded when trying to connect'),
  },
];

it.each(failures)(
  'returns 503 and recovers after $name',
  async ({ error }) => {
    const store = new MemoryInventoryStore();
    const originalReserve = store.reserve.bind(store);

    store.reserve = async () => {
      throw error;
    };

    const api = await start(store);
    const failed = await buy(api);

    expect(failed.statusCode).toBe(503);
    expect(failed.headers['retry-after']).toBe('1');
    expect(failed.json().outcome).toBe('error');
    expect(await store.remaining()).toBe(10);
    expect(await store.findOrder('ada')).toBeNull();

    // Restore the store, then retry the purchase.
    store.reserve = originalReserve;

    const retry = await buy(api);

    expect(retry.statusCode).toBe(201);
    expect(retry.json().outcome).toBe('purchased');
    expect(await store.remaining()).toBe(9);
  },
);

it('recovers the original order when confirmation is lost after a write', async () => {
  const store = new MemoryInventoryStore();
  const originalReserve = store.reserve.bind(store);
  let loseResponse = true;

  store.reserve = async (userId, orderId, at, window) => {
    const result = await originalReserve(
      userId,
      orderId,
      at,
      window,
    );

    if (loseResponse && result.status === 'reserved') {
      loseResponse = false;
      throw databaseError('ECONNRESET');
    }

    return result;
  };

  const api = await start(store);
  const failed = await buy(api);

  expect(failed.statusCode).toBe(503);
  expect(failed.json().message).toContain('same user ID');

  const lookup = await api.inject({
    method: 'GET',
    url: '/api/purchase/ada',
  });

  expect(lookup.statusCode).toBe(200);
  expect(lookup.json().hasPurchased).toBe(true);

  const retry = await buy(api);

  expect(retry.statusCode).toBe(200);
  expect(retry.json().outcome).toBe('already_purchased');
  expect(retry.json().order.orderId).toBe(
    lookup.json().order.orderId,
  );
  expect(await store.remaining()).toBe(9);
});

it('returns 503 when sale or order information cannot be read', async () => {
  const store = new MemoryInventoryStore();

  store.remaining = async () => {
    throw databaseError('ECONNREFUSED');
  };

  store.findOrder = async () => {
    throw databaseError('ECONNREFUSED');
  };

  const api = await start(store);

  for (const url of ['/api/sale', '/api/purchase/ada']) {
    const response = await api.inject({
      method: 'GET',
      url,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().outcome).toBe('error');
    expect(response.json().hasPurchased).toBeUndefined();
  }
});

it('keeps unexpected application errors as 500', async () => {
  const store = new MemoryInventoryStore();

  store.reserve = async () => {
    throw new Error('Simulated programming error');
  };

  const api = await start(store);
  const response = await buy(api);

  expect(response.statusCode).toBe(500);
  expect(response.json().outcome).toBe('error');
  expect(response.json().message).not.toContain(
    'Simulated programming error',
  );
});