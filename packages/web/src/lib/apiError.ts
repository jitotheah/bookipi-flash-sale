/** Thrown when the server (or the mock) reports an operation as a stub. */
export class ApiNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiNotImplementedError';
  }
}
