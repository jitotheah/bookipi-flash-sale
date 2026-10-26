import type { Order } from '@flash/shared';
import type { InventoryStore, ReservationResult } from './inventoryStore.ts';

/**
 * ============================================================================
 *  GUIDE.md step 3b -- the scale-out driver. Write it yourself.
 * ============================================================================
 *
 * Read `postgresStore.ts` first. That driver is the one to submit as the
 * default: it is durable, it is one system, and for ten units it is very
 * likely the right answer. This file is what you reach for when sustained
 * write throughput on the contended row becomes the limit -- and the point of
 * building it is to *measure* that trade-off rather than assert it.
 *
 * What Redis buys: Postgres serialises every buyer behind a row lock on one
 * row and, well before that lock is the limit, behind a connection pool of
 * tens. Redis is single-threaded and runs a Lua script to completion with
 * nothing interleaved, giving the same guarantee at ~100k ops/s with one
 * network round trip and no pool to exhaust.
 *
 * What it costs: Redis is not durable by default, so the business record moves
 * to an async worker (step 4) and you now owe a reconciliation job, an AOF
 * policy, and a cold-start rule -- none of which the Postgres driver needs.
 *
 * The contract you must satisfy (same as MemoryInventoryStore):
 *   dedupe check + stock check + decrement happen as ONE atomic step.
 *
 * Suggested keys
 *   flash:{saleId}:stock          -> integer, remaining units
 *   flash:{saleId}:orders         -> hash, userId -> JSON order
 *
 * Sketch of the script -- EVAL it, then switch to EVALSHA with an EVAL
 * fallback on NOSCRIPT so you are not shipping the source on every request:
 *
 *   local existing = redis.call('HGET', KEYS[2], ARGV[1])
 *   if existing then return {'duplicate', existing} end
 *   local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
 *   if stock <= 0 then return {'sold_out', ''} end
 *   redis.call('DECR', KEYS[1])
 *   redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
 *   return {'reserved', ARGV[2]}
 *
 * Things the reviewer will look for, in rough order of importance:
 *   1. The dedupe write and the decrement cannot be separated -- if the process
 *      dies between them, stock is gone and nobody owns it.
 *   2. `init` must not reset stock on every deploy. Use SET ... NX so a rolling
 *      restart mid-sale does not refill the shelf.
 *   3. Connection failures must surface as 503, never as a silent oversell.
 *      Fail closed: if you cannot reach Redis, you did not sell anything.
 *   4. ioredis `maxRetriesPerRequest` and a command timeout, so a Redis stall
 *      sheds load instead of parking every request until the client gives up.
 */
export class RedisInventoryStore implements InventoryStore {
  constructor(
    private readonly url: string,
    private readonly saleId = 'iphone-17-pro',
  ) {}

  async init(_totalStock: number): Promise<void> {
    throw new Error('RedisInventoryStore is not implemented yet -- see GUIDE.md step 3b');
  }

  async reserve(_userId: string, _orderId: string, _at: Date): Promise<ReservationResult> {
    throw new Error('RedisInventoryStore is not implemented yet -- see GUIDE.md step 3b');
  }

  async findOrder(_userId: string): Promise<Order | null> {
    throw new Error('RedisInventoryStore is not implemented yet -- see GUIDE.md step 3b');
  }

  async remaining(): Promise<number> {
    throw new Error('RedisInventoryStore is not implemented yet -- see GUIDE.md step 3b');
  }

  async close(): Promise<void> {
    /* close the ioredis connection here once you add it */
  }
}
