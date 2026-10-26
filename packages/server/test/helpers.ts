import { loadConfig, type SaleConfig } from '../src/config.ts';

/** A sale that is open right now, with whatever stock the test needs. */
export function testConfig(overrides: Partial<SaleConfig> = {}): SaleConfig {
  const base = loadConfig({
    TOTAL_STOCK: '10',
    INVENTORY_DRIVER: 'memory',
  });
  return { ...base, ...overrides };
}
