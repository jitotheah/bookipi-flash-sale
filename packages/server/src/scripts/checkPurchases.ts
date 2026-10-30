import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../config.ts';
import { PostgresInventoryStore } from '../store/postgresStore.ts';

const { Pool } = pg;
const config = loadConfig();

const saleId = randomInt(1_000_000, 2_000_000_000);

const db = new Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
});

const storeA = new PostgresInventoryStore(config.databaseUrl, saleId);
const storeB = new PostgresInventoryStore(config.databaseUrl, saleId);

let fixtureCreated = false;

const buy = (store: PostgresInventoryStore, userId: string) =>
  store.reserve(userId, randomUUID(), new Date());

try {
  // Create a separate sale used only by this check.
  await db.query(
    `
      INSERT INTO sales (
        id, product_id, remaining_stock, total_stock, starts_at, ends_at
      )
      VALUES (
        $1,
        'integration-test-product',
        10,
        10,
        clock_timestamp() - interval '1 hour',
        clock_timestamp() + interval '1 hour'
      )
    `,
    [saleId],
  );

  fixtureCreated = true;

  await Promise.all([storeA.init(10), storeB.init(10)]);

  const first = await buy(storeA, 'ada');
  assert(first.status === 'reserved');
  assert.equal(await storeA.remaining(), 9);

  const duplicate = await buy(storeB, 'ada');
  assert(duplicate.status === 'duplicate');
  assert.equal(duplicate.order.orderId, first.order.orderId);
  assert.equal(await storeB.remaining(), 9);

  console.log('PASS: first purchase and duplicate handling');

  // Two independent stores compete for the remaining nine units.
  const settled = await Promise.allSettled(
    Array.from({ length: 100 }, (_, index) =>
      buy(index % 2 === 0 ? storeA : storeB, `buyer-${index}`),
    ),
  );

  const results = settled.map((result) => {
    if (result.status === 'rejected') {
      throw result.reason;
    }

    return result.value;
  });

  assert.equal(
    results.filter((result) => result.status === 'reserved').length,
    9,
  );

  assert.equal(
    results.filter((result) => result.status === 'sold_out').length,
    91,
  );

  assert.equal(await storeA.remaining(), 0);

  console.log('PASS: 100 concurrent attempts produced 9 additional winners');

  const soldOut = await buy(storeA, 'late-buyer');
  assert.equal(soldOut.status, 'sold_out');
  assert.equal(await storeA.findOrder('late-buyer'), null);

  // Check an upcoming sale.
  await db.query(
    `
      UPDATE sales
      SET starts_at = clock_timestamp() + interval '1 hour',
          ends_at = clock_timestamp() + interval '2 hours'
      WHERE id = $1
    `,
    [saleId],
  );

  assert.equal(
    (await buy(storeA, 'early-buyer')).status,
    'sale_not_started',
  );
  assert.equal(await storeA.findOrder('early-buyer'), null);

  // Check an ended sale.
  await db.query(
    `
      UPDATE sales
      SET starts_at = clock_timestamp() - interval '2 hours',
          ends_at = clock_timestamp() - interval '1 hour'
      WHERE id = $1
    `,
    [saleId],
  );

  assert.equal(
    (await buy(storeA, 'expired-buyer')).status,
    'sale_ended',
  );
  assert.equal(await storeA.findOrder('expired-buyer'), null);

  console.log('PASS: refused purchases left no order behind');

  const counts = await db.query(
    `
      SELECT
        count(*)::int AS purchases,
        count(DISTINCT user_id)::int AS unique_users
      FROM purchases
      WHERE sale_id = $1
    `,
    [saleId],
  );

  assert.deepEqual(counts.rows[0], {
    purchases: 10,
    unique_users: 10,
  });

  console.log('PASS: database contains 10 purchases by 10 distinct users');
} catch (error) {
  console.error('Purchase check failed:', error);
  process.exitCode = 1;
} finally {
  try {
    if (fixtureCreated) {
      await db.query(
        'DELETE FROM purchases WHERE sale_id = $1',
        [saleId],
      );

      await db.query(
        'DELETE FROM sales WHERE id = $1',
        [saleId],
      );
    }
  } finally {
    await Promise.all([
      storeA.close(),
      storeB.close(),
      db.end(),
    ]);
  }
}