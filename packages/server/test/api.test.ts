import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { MemoryInventoryStore } from '../src/store/memoryStore.ts';
import { PostgresInventoryStore } from '../src/store/postgresStore.ts';
import { testConfig } from './helpers.ts';

let app: FastifyInstance;

async function startApp(stock = 10) {
  app = await buildApp({
    config: testConfig({ totalStock: stock }),
    store: new MemoryInventoryStore(),
  });
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe('API', () => {
  it('GET /api/sale describes an open sale', async () => {
    const app = await startApp();
    const response = await app.inject({ method: 'GET', url: '/api/sale' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'active',
      totalStock: 10,
      remainingStock: 10,
      product: { id: 'iphone-17-pro' },
    });
  });

  it('POST /api/purchase returns 201 then 200 for the same user', async () => {
    const app = await startApp();
    const body = { userId: 'ada' };

    const first = await app.inject({ method: 'POST', url: '/api/purchase', payload: body });
    expect(first.statusCode).toBe(201);
    expect(first.json().outcome).toBe('purchased');

    const second = await app.inject({ method: 'POST', url: '/api/purchase', payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json().outcome).toBe('already_purchased');
    expect(second.json().order.orderId).toBe(first.json().order.orderId);
  });

  it('POST /api/purchase returns 409 once stock is exhausted', async () => {
    const app = await startApp(1);
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'ada' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'grace' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().outcome).toBe('sold_out');
  });

  it('GET /api/purchase/:userId reports whether a user holds a unit', async () => {
    const app = await startApp();

    const before = await app.inject({ method: 'GET', url: '/api/purchase/ada' });
    expect(before.json()).toMatchObject({ hasPurchased: false, order: null });

    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'ada' } });

    const after = await app.inject({ method: 'GET', url: '/api/purchase/ada' });
    expect(after.json().hasPurchased).toBe(true);
  });

  it('serves exactly `stock` winners when the whole crowd arrives at once', async () => {
    const app = await startApp(10);

    const responses = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: `user-${i}` } }),
      ),
    );

    const outcomes = responses.map((r) => r.json().outcome);
    expect(outcomes.filter((o) => o === 'purchased')).toHaveLength(10);
    expect(outcomes.filter((o) => o === 'sold_out')).toHaveLength(290);
  });
});

describe('unimplemented drivers', () => {
  it('boots and answers 501 rather than crashing or faking a result', async () => {
    app = await buildApp({
      config: testConfig({ inventoryDriver: 'postgres' }),
      store: new PostgresInventoryStore('postgres://unused'),
    });

    const sale = await app.inject({ method: 'GET', url: '/api/sale' });
    expect(sale.statusCode).toBe(501);
    expect(sale.json()).toMatchObject({ outcome: 'not_implemented' });
    expect(sale.json().message).toContain('GUIDE.md step 4');

    const purchase = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'ada' },
    });
    expect(purchase.statusCode).toBe(501);
    expect(purchase.json().outcome).toBe('not_implemented');
  });
});
