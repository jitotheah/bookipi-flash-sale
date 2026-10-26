import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createInventoryStore } from './store/index.ts';

const config = loadConfig();
const store = createInventoryStore(config);
// LOG_LEVEL=warn during stress runs: per-request logging at `info` writes
// thousands of lines a second and shows up in the latency numbers.
const app = await buildApp({
  config,
  store,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

await app.listen({ port: config.port, host: config.host });

app.log.info(
  {
    product: config.product.name,
    stock: config.totalStock,
    driver: config.inventoryDriver,
    startsAt: config.startsAt.toISOString(),
    endsAt: config.endsAt.toISOString(),
  },
  'flash sale ready',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // Drain in-flight requests before exiting so a deploy mid-sale does not
    // drop reservations that were already acknowledged.
    app.close().then(() => process.exit(0));
  });
}
