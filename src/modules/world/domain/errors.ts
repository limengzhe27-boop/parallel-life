export class DomainError extends Error {
  readonly code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'INVALID_PROPOSAL' | 'INVALID_COMMAND' | 'IDEMPOTENCY_CONFLICT';
  constructor(code: DomainError['code'], message: string = code) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
