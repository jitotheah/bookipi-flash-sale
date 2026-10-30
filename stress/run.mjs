#!/usr/bin/env node
/**
 * Correctness test over real HTTP. Use a fresh, active PostgreSQL test sale.
 * All target APIs must serve the SAME sale. Run no other buyers during the test.
 *
 * npm run stress -- --url http://localhost:3001,http://localhost:3002 --users 2000 --duplicates 20 --concurrency 100
 *
 * First race one user against themselves, then race distinct users for the rest.
 * The printed rate describes this short workload, mostly sold-out responses.
 */
import { randomUUID } from 'node:crypto';

function options() {
  const result = {};
  const tokens = process.argv.slice(2);
  const allowed = new Set(['url', 'users', 'duplicates', 'concurrency']);
  for (let i = 0; i < tokens.length; i += 2) {
    const key = tokens[i]?.slice(2);
    const value = tokens[i + 1];
    if (!tokens[i]?.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) {
      throw new Error(`Expected --url, --users, --duplicates or --concurrency followed by a value; received ${tokens[i]}.`);
    }
    result[key] = value;
  }
  return result;
}

function integer(value, fallback, minimum, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

async function read(base, path) {
  const result = await json(base, path);
  requireCheck(result.status === 200, `GET ${base}${path} returned HTTP ${result.status}.`);
  return result.body;
}

async function runPool(jobs, concurrency) {
  let cursor = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      results.push(await job());
    }
  }));
  return results;
}

async function main() {
  const args = options();
  const targets = [...new Set((args.url ?? 'http://localhost:3000').split(',').map((value) => {
    const url = new URL(value.trim());
    requireCheck(
      ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash,
      'Each target must be an HTTP origin such as http://localhost:3001.',
    );
    return url.origin;
  }))];
  const users = integer(args.users, 2000, 1, '--users');
  const duplicates = integer(args.duplicates, 20, 2, '--duplicates');
  const concurrency = integer(args.concurrency, 100, 1, '--concurrency');
  const before = await Promise.all(targets.map((base) => read(base, '/api/sale')));
  const sale = before[0];

  for (const [index, state] of before.entries()) {
    requireCheck(state.status === 'active', `${targets[index]} is ${state.status}. Create a fresh active test sale.`);
    requireCheck(
      Number.isSafeInteger(state.totalStock) && state.totalStock > 0 && state.remainingStock === state.totalStock,
      `${targets[index]} needs untouched stock. Create a new SALE_ID; restarting the API does not reset stock.`,
    );
    requireCheck(
      state.product?.id === sale.product?.id && state.totalStock === sale.totalStock &&
        state.startsAt === sale.startsAt && state.endsAt === sale.endsAt,
      'The APIs report different sale settings. Start both with the same SALE_ID and DATABASE_URL.',
    );
  }
  requireCheck(users >= sale.totalStock - 1, 'Supply enough distinct users to exhaust the test stock.');

  const prefix = `load-${randomUUID().slice(0, 8)}`;
  const repeatUser = `${prefix}-repeat`;
  let nextTarget = 0;
  const expectedStatus = { purchased: 201, already_purchased: 200, sold_out: 409 };

  async function purchase(userId) {
    const base = targets[nextTarget++ % targets.length];
    const startedAt = performance.now();
    try {
      const { status, body } = await json(base, '/api/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      requireCheck(
        Object.hasOwn(expectedStatus, body?.outcome) && expectedStatus[body.outcome] === status,
        `Unexpected HTTP ${status}: ${body?.outcome ?? 'missing outcome'}.`,
      );
      if (body.outcome !== 'sold_out') {
        requireCheck(typeof body.order?.orderId === 'string' && body.order.userId === userId, 'Missing or incorrect order.');
      }
      return { base, userId, outcome: body.outcome, orderId: body.order?.orderId, ms: performance.now() - startedAt };
    } catch (error) {
      return { base, userId, outcome: 'request_error', error: String(error), ms: performance.now() - startedAt };
    }
  }

  console.log(`\n  targets       ${targets.join(', ')}\n  product       ${sale.product.name}\n  stock         ${sale.totalStock} untouched units\n  load          ${duplicates} attempts by one user, then ${users} distinct users\n  concurrency   up to ${concurrency} in flight\n`);

  const startedAt = performance.now();
  const repeated = await runPool(Array.from({ length: duplicates }, () => () => purchase(repeatUser)), concurrency);
  const distinct = await runPool(Array.from({ length: users }, (_, i) => () => purchase(`${prefix}-${i}`)), concurrency);
  const wallMs = performance.now() - startedAt;
  const results = [...repeated, ...distinct];
  const winners = results.filter((result) => result.outcome === 'purchased');
  const repeatWinner = repeated.find((result) => result.outcome === 'purchased');
  const failures = results.filter((result) => result.outcome === 'request_error');
  const counts = new Map();
  for (const result of results) counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);

  console.log('  outcomes');
  for (const [outcome, count] of counts) console.log(`    ${outcome.padEnd(20)} ${count}`);
  console.log('\n  requests per API');
  for (const base of targets) console.log(`    ${base}  ${results.filter((result) => result.base === base).length}`);

  const latencies = results.map((result) => result.ms).sort((a, b) => a - b);
  const percentile = (p) => latencies[Math.ceil(latencies.length * p) - 1].toFixed(1);
  console.log(`\n  throughput    ${(results.length / (wallMs / 1000)).toFixed(0)} req/s over ${(wallMs / 1000).toFixed(2)}s\n  latency       p50 ${percentile(0.5)}ms  p95 ${percentile(0.95)}ms  p99 ${percentile(0.99)}ms  max ${latencies.at(-1).toFixed(1)}ms\n`);

  const after = await Promise.all(targets.map((base) => read(base, '/api/sale')));
  const lookups = await runPool(winners.flatMap((winner) => targets.map((base) => async () => {
    const body = await read(base, `/api/purchase/${encodeURIComponent(winner.userId)}`);
    return body.hasPurchased === true && body.order?.orderId === winner.orderId && body.order?.userId === winner.userId;
  })), 10);

  const checks = [
    [
      'one repeated user received one purchase and the same order on every retry',
      repeated.filter((result) => result.outcome === 'purchased').length === 1 &&
        repeated.filter((result) => result.outcome === 'already_purchased').length === duplicates - 1 &&
        repeated.every((result) => result.orderId === repeatWinner?.orderId),
    ],
    [`exactly ${sale.totalStock} units sold across all APIs`, winners.length === sale.totalStock],
    ['every winner has a distinct user and order', new Set(winners.map((result) => result.userId)).size === winners.length && new Set(winners.map((result) => result.orderId)).size === winners.length],
    ['all HTTP requests returned the expected status and outcome', failures.length === 0],
    ['every API reports zero remaining stock', after.every((state) => state.remainingStock === 0)],
    ['every winning order can be retrieved with the same ID from every API', winners.length > 0 && lookups.every(Boolean)],
  ];
  console.log('  assertions');
  for (const [name, passed] of checks) console.log(`    ${passed ? 'PASS' : 'FAIL'}  ${name}`);
  for (const failure of failures.slice(0, 3)) console.error(`    request error at ${failure.base}: ${failure.error}`);
  console.log('');
  if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n  FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
