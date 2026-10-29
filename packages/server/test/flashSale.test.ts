import { describe, expect, it } from 'vitest';
import { FlashSaleService } from '../src/domain/flashSale.ts';
import { MemoryInventoryStore } from '../src/store/memoryStore.ts';
import { testConfig } from './helpers.ts';

async function serviceWith(stock: number, now?: () => Date) {
  const store = new MemoryInventoryStore();
  await store.init(stock);
  const config = testConfig({ totalStock: stock });
  const service = new FlashSaleService({ store, config, now });
  return { store, config, service };
}

describe('MemoryInventoryStore', () => {
  it('never hands out more units than it holds, however many callers race', async () => {
    const store = new MemoryInventoryStore();
    await store.init(10);

    // 500 distinct users, all firing at once. This is the oversell test: the
    // whole design exists to make this assertion hold.
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        store.reserve(`user-${i}`, `order-${i}`, new Date()),
      ),
    );

    const reserved = results.filter((r) => r.status === 'reserved');
    expect(reserved).toHaveLength(10);
    expect(results.filter((r) => r.status === 'sold_out')).toHaveLength(490);
    expect(await store.remaining()).toBe(0);
  });

  it('returns the original order when the same user races against themselves', async () => {
    const store = new MemoryInventoryStore();
    await store.init(10);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.reserve('ada', `order-${i}`, new Date())),
    );

    expect(results.filter((r) => r.status === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(49);
    // One user, one unit: 49 duplicate attempts must not touch stock.
    expect(await store.remaining()).toBe(9);
  });
});

describe('FlashSaleService', () => {
  it('confirms the first purchase and reports the second as already purchased', async () => {
    const { service } = await serviceWith(10);

    const first = await service.purchase('Ada@example.com');
    expect(first.outcome).toBe('purchased');
    expect(first.order?.userId).toBe('ada@example.com'); // normalised

    const second = await service.purchase('ADA@EXAMPLE.COM');
    expect(second.outcome).toBe('already_purchased');
    expect(second.order?.orderId).toBe(first.order?.orderId);
  });

  it('rejects purchases before the sale opens and after it closes', async () => {
    const start = new Date('2026-11-01T10:00:00Z');
    const end = new Date('2026-11-01T11:00:00Z');
    let clock = new Date('2026-11-01T09:59:59Z');

    const store = new MemoryInventoryStore();
    const service = new FlashSaleService({
      store,
      config: testConfig({ startsAt: start, endsAt: end, totalStock: 10 }),
      now: () => clock,
    });
    await store.init(10);

    expect((await service.purchase('ada')).outcome).toBe('sale_not_started');

    clock = new Date('2026-11-01T10:30:00Z');
    expect((await service.purchase('ada')).outcome).toBe('purchased');

    clock = new Date('2026-11-01T11:00:01Z');
    expect((await service.purchase('grace')).outcome).toBe('sale_ended');
    expect(await store.remaining()).toBe(9); // the late attempt took nothing
  });

  it('reports sold_out once stock is gone but the window is still open', async () => {
    const { service } = await serviceWith(1);
    await service.purchase('ada');

    expect((await service.purchase('grace')).outcome).toBe('sold_out');
    expect((await service.getState()).status).toBe('sold_out');
  });

  it('rejects a purchase exactly when the sale ends', async () => {
    const startsAt = new Date('2026-11-01T10:00:00Z');
    const endsAt = new Date('2026-11-01T11:00:00Z');

    const store = new MemoryInventoryStore();
    await store.init(10);

    const service = new FlashSaleService({
      store,
      config: testConfig({
        startsAt,
        endsAt,
        totalStock: 10,
      }),
      now: () => endsAt,
    });

    const result = await service.purchase('ada');

    expect(result.outcome).toBe('sale_ended');
    expect((await service.getState()).status).toBe('ended');
    expect(await store.remaining()).toBe(10);
    expect(await store.findOrder('ada')).toBeNull();
  });

  it('rejects identifiers that cannot be a stable dedupe key', async () => {
    const { service } = await serviceWith(10);
    for (const bad of ['', '  ', 'ab', 'has space', 'x'.repeat(65), null, 42]) {
      expect((await service.purchase(bad)).outcome).toBe('invalid_user');
    }
  });
});

/**
 * TODO (GUIDE.md step 7) -- tests worth adding next:
 *   - RedisInventoryStore against a real Redis, asserting the same two
 *     invariants as MemoryInventoryStore (reuse the cases above via a shared
 *     contract-test function so both drivers are held to one standard).
 *   - A reserve() that throws mid-sale: the user must see 503 and retry
 *     successfully, with stock decremented exactly once.
 *   - Clock skew: a request that arrives one millisecond after endsAt.
 */
