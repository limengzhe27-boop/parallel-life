export class DomainError extends Error {
  readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'INVALID_STATE' | 'INVALID_COMMAND';

  constructor(code: DomainError['code'], message: string = code) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
