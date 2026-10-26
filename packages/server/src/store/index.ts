import type { SaleConfig } from '../config.ts';
import type { InventoryStore } from './inventoryStore.ts';
import { MemoryInventoryStore } from './memoryStore.ts';
import { PostgresInventoryStore } from './postgresStore.ts';
import { RedisInventoryStore } from './redisStore.ts';

export type { InventoryStore, ReservationResult } from './inventoryStore.ts';
export { MemoryInventoryStore } from './memoryStore.ts';
export { PostgresInventoryStore } from './postgresStore.ts';
export { RedisInventoryStore } from './redisStore.ts';

export function createInventoryStore(config: SaleConfig): InventoryStore {
  switch (config.inventoryDriver) {
    case 'postgres':
      return new PostgresInventoryStore(config.databaseUrl);
    case 'redis':
      return new RedisInventoryStore(config.redisUrl, config.product.id);
    case 'memory':
      return new MemoryInventoryStore();
  }
}
