import cors from '@fastify/cors';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { SaleConfig } from './config.ts';
import { NotImplementedError } from './errors.ts';
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

  // A stub driver must not stop the server booting: we want it to start and
  // then answer 501 on each endpoint, so the UI can say which step is missing
  // instead of the process dying with a stack trace. Any other failure here is
  // real and should still abort the boot.
  try {
    await store.init(config.totalStock);
  } catch (error) {
    if (!(error instanceof NotImplementedError)) throw error;
    app.log.warn(
      `${config.inventoryDriver} driver is a stub — endpoints will answer 501. ${error.message}`,
    );
  }

  const service = new FlashSaleService({ store, config, sink, now });

  app.get('/health', async () => ({ status: 'ok' }));
  registerSaleRoutes(app, service);
  registerPurchaseRoutes(app, service);

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ outcome: 'error', message: 'Not found' }),
  );

  // Fail closed. A purchase that errored is a purchase the server did not
  // commit, so the client is safe to retry -- which is only true because
  // reserve() is atomic and keyed by user.
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

    // 501 is not a failure, it is an honest "not written yet". Pass the real
    // message through so the UI can say which step is missing.
    if (status === 501) {
      request.log.warn({ err: error }, 'unimplemented operation called');
      return reply.code(501).send({ outcome: 'not_implemented', message: error.message });
    }

    request.log.error({ err: error }, 'request failed');
    return reply.code(status).send({
      outcome: 'error',
      message: status >= 500 ? 'The service is busy. Please retry.' : error.message,
    });
  });

  app.addHook('onClose', async () => store.close());

  return app;
}
