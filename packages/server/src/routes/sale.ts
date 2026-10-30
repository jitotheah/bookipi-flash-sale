import type { FastifyInstance } from 'fastify';
import type { FlashSaleService } from '../domain/flashSale.ts';

export function registerSaleRoutes(app: FastifyInstance, service: FlashSaleService): void {
  /**
   * GET /api/sale -- poll target for every connected browser, so it is the
   * highest-volume endpoint in the system by a wide margin.
   *
   * GUIDE.md step 5: put a 1-second cache in front of this (per-process memo,
   * then a CDN / shared cache). One cached response serving 50k pollers is the
   * difference between a flat read load and an inventory store melting down
   * answering the same question 50k times a second.
   */
  app.get('/api/sale', async () => service.getState());
}
