import { expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type {
  InventoryStore,
  SaleSnapshot,
} from '../src/store/inventoryStore.ts';
import { testConfig } from './helpers.ts';

it('uses stored sale settings and delegates purchase timing to the store', async () => {
  const config = testConfig({
    inventoryDriver: 'postgres',
    totalStock: 999,
    startsAt: new Date('2030-01-01T10:00:00Z'),
    endsAt: new Date('2030-01-01T11:00:00Z'),
  });

  const saved: SaleSnapshot = {
    productId: config.product.id,
    startsAt: new Date('2026-10-29T06:29:00Z'),
    endsAt: new Date('2026-10-29T07:29:00Z'),
    totalStock: 10,
    remainingStock: 10,
    serverTime: new Date('2026-10-29T07:43:00Z'),
  };

  let reservationCalls = 0;

  const store: InventoryStore = {
    async init() {},
    async getSale() {
      return saved;
    },
    async reserve() {
      reservationCalls += 1;
      return { status: 'sale_ended' };
    },
    async findOrder() {
      return null;
    },
    async remaining() {
      return saved.remainingStock;
    },
    async close() {},
  };

  const app = await buildApp({
    config,
    store,
    now: () => new Date('2020-01-01T00:00:00Z'),
  });

  try {
    const sale = await app.inject({
      method: 'GET',
      url: '/api/sale',
    });

    expect(sale.statusCode).toBe(200);
    expect(sale.json()).toMatchObject({
      status: 'ended',
      startsAt: saved.startsAt.toISOString(),
      endsAt: saved.endsAt.toISOString(),
      totalStock: 10,
      remainingStock: 10,
      serverTime: saved.serverTime.toISOString(),
    });

    const purchase = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'ada' },
    });

    expect(purchase.statusCode).toBe(409);
    expect(purchase.json().outcome).toBe('sale_ended');
    expect(reservationCalls).toBe(1);
  } finally {
    await app.close();
  }
});