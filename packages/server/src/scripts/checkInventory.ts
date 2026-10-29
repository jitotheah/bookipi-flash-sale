import { loadConfig } from '../config.ts';
import { PostgresInventoryStore } from '../store/postgresStore.ts';

const config = loadConfig();
const store = new PostgresInventoryStore(config.databaseUrl);

try {
  await store.init(config.totalStock);
  console.log('Database initialisation: OK');

  const remaining = await store.remaining();
  console.log('Remaining stock:', remaining);

  const order = await store.findOrder('ada');
  console.log('Order for ada:', order);
} catch (error) {
  console.error('Inventory check failed:', error);
  process.exitCode = 1;
} finally {
  await store.close();
}