import { loadConfig } from '../config.ts';
import { PostgresInventoryStore } from '../store/postgresStore.ts';

const config = loadConfig();
const store = new PostgresInventoryStore(
  config.databaseUrl,
  config.saleId,
);
try {
  await store.init(config.totalStock);
  console.log('Database initialisation: OK');

  const sale = await store.getSale();

  console.log('Saved sale details:', {
    productId: sale.productId,
    startsAt: sale.startsAt.toISOString(),
    endsAt: sale.endsAt.toISOString(),
    totalStock: sale.totalStock,
    remainingStock: sale.remainingStock,
    databaseTime: sale.serverTime.toISOString(),
  });

  const order = await store.findOrder('ada');
  console.log('Order for ada:', order);
} catch (error) {
  console.error('Inventory check failed:', error);
  process.exitCode = 1;
} finally {
  await store.close();
}