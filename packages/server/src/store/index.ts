import type { SaleConfig } from '../config.ts';
import type { InventoryStore } from './inventoryStore.ts';
import { MemoryInventoryStore } from './memoryStore.ts';
import { RedisInventoryStore } from './redisStore.ts';

export type { InventoryStore, ReservationResult } from './inventoryStore.ts';
export { MemoryInventoryStore } from './memoryStore.ts';
export { RedisInventoryStore } from './redisStore.ts';

export function createInventoryStore(config: SaleConfig): InventoryStore {
  switch (config.inventoryDriver) {
    case 'redis':
      return new RedisInventoryStore(config.redisUrl, config.product.id);
    case 'memory':
      return new MemoryInventoryStore();
  }
}
