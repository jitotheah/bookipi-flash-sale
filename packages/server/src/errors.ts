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
