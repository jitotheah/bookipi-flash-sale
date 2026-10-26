#!/usr/bin/env node
/**
 * Dependency-free load generator: `npm run stress`.
 *
 * It is deliberately not a throughput benchmark -- it is a correctness test run
 * under load. The two invariants it asserts are the ones the whole design
 * exists to protect:
 *
 *   1. winners === totalStock          (no overselling, no undersell)
 *   2. every winner is a distinct user (one item per user)
 *
 * A throughput number that comes with a broken invariant is worthless, so the
 * script exits non-zero when either assertion fails.
 *
 * Usage:
 *   node stress/run.mjs --users 5000 --duplicates 40 --url http://localhost:3000
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const BASE = args.url ?? 'http://localhost:3000';
const USERS = Number(args.users ?? 2000);
const DUPLICATES = Number(args.duplicates ?? 50);
const CONCURRENCY = Number(args.concurrency ?? 500);

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function purchase(userId) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${BASE}/api/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const body = await response.json();
    return { userId, outcome: body.outcome ?? 'error', ms: performance.now() - startedAt };
  } catch (error) {
    return { userId, outcome: 'network_error', ms: performance.now() - startedAt, error };
  }
}

/** Runs every job with a bounded number in flight, so we load the server, not the client. */
async function runPool(jobs, limit) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      results.push(await jobs[index]());
    }
  });
  await Promise.all(workers);
  return results;
}

const sale = await fetch(`${BASE}/api/sale`).then((r) => r.json());
console.log(
  `\n  target        ${BASE}\n` +
    `  product       ${sale.product.name}\n` +
    `  sale status   ${sale.status}\n` +
    `  stock         ${sale.remainingStock} / ${sale.totalStock} remaining\n` +
    `  load          ${USERS} unique users + ${DUPLICATES} retries from one user\n` +
    `  concurrency   ${CONCURRENCY} in flight\n`,
);

if (sale.status !== 'active') {
  console.error(`  Sale is "${sale.status}" — restart the server to open a fresh window.\n`);
  process.exit(1);
}

const jobs = [
  ...Array.from({ length: USERS }, (_, i) => () => purchase(`shopper-${i}@example.com`)),
  // The same user hammering Buy Now. Exactly one of these may win.
  ...Array.from({ length: DUPLICATES }, () => () => purchase('repeat-offender@example.com')),
];

// Shuffle so the duplicate cohort is interleaved with everyone else rather
// than arriving as a tidy block at the end.
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}

const startedAt = performance.now();
const results = await runPool(jobs, CONCURRENCY);
const wallMs = performance.now() - startedAt;

const counts = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const winners = results.filter((r) => r.outcome === 'purchased').map((r) => r.userId);
const uniqueWinners = new Set(winners);

console.log('  outcomes');
for (const [outcome, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${outcome.padEnd(20)} ${count}`);
}

console.log(
  `\n  throughput    ${(results.length / (wallMs / 1000)).toFixed(0)} req/s over ${(wallMs / 1000).toFixed(2)}s\n` +
    `  latency       p50 ${percentile(latencies, 0.5).toFixed(1)}ms` +
    `  p95 ${percentile(latencies, 0.95).toFixed(1)}ms` +
    `  p99 ${percentile(latencies, 0.99).toFixed(1)}ms` +
    `  max ${latencies.at(-1).toFixed(1)}ms\n`,
);

const checks = [
  {
    name: `exactly ${sale.totalStock} units sold (no oversell, no undersell)`,
    pass: winners.length === sale.totalStock,
    detail: `sold ${winners.length}`,
  },
  {
    name: 'every winner is a distinct user',
    pass: uniqueWinners.size === winners.length,
    detail: `${uniqueWinners.size} unique of ${winners.length}`,
  },
  {
    name: 'no request failed at the transport layer',
    pass: (counts.network_error ?? 0) + (counts.error ?? 0) === 0,
    detail: `${(counts.network_error ?? 0) + (counts.error ?? 0)} failures`,
  },
  {
    name: 'stock reads zero afterwards',
    pass: (await fetch(`${BASE}/api/sale`).then((r) => r.json())).remainingStock === 0,
    detail: 'checked via GET /api/sale',
  },
];

console.log('  assertions');
for (const check of checks) {
  console.log(`    ${check.pass ? 'PASS' : 'FAIL'}  ${check.name}  (${check.detail})`);
}
console.log('');

process.exit(checks.every((c) => c.pass) ? 0 : 1);

/**
 * TODO (GUIDE.md step 7):
 *   - Port this to k6 (stress/purchase.k6.js) for a proper ramping profile and
 *     threshold-based pass/fail: `k6 run --vus 2000 --duration 30s`.
 *   - Add a soak variant that keeps polling GET /api/sale during the burst, so
 *     you can show read traffic does not starve writes.
 *   - Run the same script against two API instances behind a load balancer to
 *     prove the Redis driver holds the invariants the memory driver cannot.
 */
