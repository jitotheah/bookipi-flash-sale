import type { Product } from '@flash/shared';

export type InventoryDriver = 'memory' | 'postgres' | 'redis';

export interface SaleConfig {
  product: Product;
  startsAt: Date;
  endsAt: Date;
  totalStock: number;
  inventoryDriver: InventoryDriver;
  databaseUrl: string;
  redisUrl: string;
  port: number;
  host: string;
}

const PRODUCT: Product = {
  id: 'iphone-17-pro',
  name: 'iPhone 17 Pro',
  tagline: 'Titanium. Unreasonably fast. Yours for one hour only.',
  priceCents: 149_900,
  currency: 'USD',
  colour: '#2f3542',
};

const HOUR_MS = 60 * 60 * 1000;

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date in configuration: "${value}" (expected ISO-8601)`);
  }
  return parsed;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received "${value}"`);
  }
  return parsed;
}

/**
 * Configuration is resolved once at boot and then passed down explicitly.
 * Nothing below this file reads `process.env`, which is what lets a test spin
 * up an app with a sale that ended yesterday, or one with a stock of 1.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SaleConfig {
  const now = new Date();
  const startsAt = parseDate(env.SALE_START_AT, now);
  const endsAt = parseDate(env.SALE_END_AT, new Date(startsAt.getTime() + HOUR_MS));

  if (endsAt <= startsAt) {
    throw new Error('SALE_END_AT must be after SALE_START_AT');
  }

  const drivers: InventoryDriver[] = ['memory', 'postgres', 'redis'];
  const driver = (env.INVENTORY_DRIVER ?? 'memory') as InventoryDriver;
  if (!drivers.includes(driver)) {
    throw new Error(
      `Unknown INVENTORY_DRIVER "${driver}" (expected one of: ${drivers.join(', ')})`,
    );
  }

  return {
    product: PRODUCT,
    startsAt,
    endsAt,
    totalStock: parseInteger(env.TOTAL_STOCK, 10),
    inventoryDriver: driver,
    databaseUrl: env.DATABASE_URL ?? 'postgres://flash:flash@localhost:5432/flashsale',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    port: parseInteger(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
  };
}
