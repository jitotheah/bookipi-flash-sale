import cors from '@fastify/cors';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { SaleConfig } from './config.ts';
import { FlashSaleService } from './domain/flashSale.ts';
import type { OrderSink } from './persistence/orderSink.ts';
import { registerPurchaseRoutes } from './routes/purchase.ts';
import { registerSaleRoutes } from './routes/sale.ts';
import type { InventoryStore } from './store/inventoryStore.ts';

export interface BuildAppOptions {
  config: SaleConfig;
  store: InventoryStore;
  sink?: OrderSink;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the app without listening on a port, so integration tests can drive
 * it through `app.inject()` -- real routing, serialisation and error handling,
 * no sockets.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, store, sink, now, logger = false } = options;

  const app = Fastify({
    logger,
    // The API sits behind a load balancer in the target design; trusting the
    // proxy is what makes per-IP rate limiting (GUIDE.md step 5) see the real
    // client instead of the balancer.
    trustProxy: true,
  });

  await app.register(cors, { origin: true });

  await store.init(config.totalStock);
  const service = new FlashSaleService({ store, config, sink, now });

  app.get('/health', async () => ({ status: 'ok' }));
  registerSaleRoutes(app, service);
  registerPurchaseRoutes(app, service);

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ outcome: 'error', message: 'Not found' }),
  );

  // Fail closed and say so. A purchase that errored is a purchase that did not
  // happen -- the client is safe to retry, which is only true because reserve()
  // is atomic and keyed by user.
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({
      outcome: 'error',
      message: status >= 500 ? 'The service is busy. Please retry.' : error.message,
    });
  });

  app.addHook('onClose', async () => store.close());

  return app;
}
