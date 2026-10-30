/**
 * Raised by any store operation that is still a stub.
 *
 * It carries `statusCode` so Fastify answers 501 Not Implemented rather than a
 * generic 500: an unfinished operation and a crashed one are different facts,
 * and the client should be able to tell them apart without reading logs.
 */
export class NotImplementedError extends Error {
  readonly statusCode = 501;

  constructor(operation: string, guideStep: string) {
    super(`${operation} is not implemented yet — see GUIDE.md ${guideStep}`);
    this.name = 'NotImplementedError';
  }
}

const TEMPORARY_DATABASE_CODES = new Set([
  // Network and connection errors.
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',

  // PostgreSQL connection errors.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',

  // Transaction conflicts, capacity limits, and timeouts.
  '40001',
  '40P01',
  '53300',
  '55P03',
  '57014',

  // PostgreSQL shutdown or startup.
  '57P01',
  '57P02',
  '57P03',
]);

// Some node-postgres connection errors have no error code.
const CONNECTION_FAILURE_MESSAGES = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
]);

export function isTemporaryDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;

  return (
    (typeof code === 'string' &&
      TEMPORARY_DATABASE_CODES.has(code)) ||
    CONNECTION_FAILURE_MESSAGES.has(error.message)
  );
}