import type { FastifyInstance } from 'fastify';
import type { PurchaseOutcome } from '@flash/shared';
import type { FlashSaleService } from '../domain/flashSale.ts';

/**
 * Outcomes are decided by the domain; this map is the only place that knows
 * what they mean over HTTP.
 *   201 the caller now owns a unit
 *   200 the caller already owned one (idempotent replay, not an error)
 *   409 the sale's state refused the request
 *   400 the request itself was malformed
 */
const STATUS_BY_OUTCOME: Record<PurchaseOutcome, number> = {
  purchased: 201,
  already_purchased: 200,
  sold_out: 409,
  sale_not_started: 409,
  sale_ended: 409,
  invalid_user: 400,
};

export function registerPurchaseRoutes(app: FastifyInstance, service: FlashSaleService): void {
  app.post<{ Body: { userId?: unknown } }>('/api/purchase', async (request, reply) => {
    const result = await service.purchase(request.body?.userId);
    return reply.code(STATUS_BY_OUTCOME[result.outcome]).send(result);
  });

  app.get<{ Params: { userId: string } }>('/api/purchase/:userId', async (request, reply) => {
    const result = await service.lookup(request.params.userId);
    if (!result) {
      return reply.code(400).send({ outcome: 'invalid_user', message: 'Invalid user identifier.' });
    }
    return reply.send(result);
  });
}
