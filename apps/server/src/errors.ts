import type { ApiErrorCode } from '@milight-studio/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** An error that maps cleanly onto an HTTP response and the shared error envelope. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: { details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('not_found', 404, `${resource} '${id}' does not exist`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', 409, message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: ErrorDetail[]) {
    super('validation_failed', 400, message, { details });
    this.name = 'ValidationError';
  }
}

export class UnsupportedCapabilityError extends AppError {
  constructor(message: string, details: ErrorDetail[]) {
    super('unsupported_capability', 422, message, { details });
    this.name = 'UnsupportedCapabilityError';
  }
}

export class HubUnreachableError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('hub_unreachable', 503, message, { cause });
    this.name = 'HubUnreachableError';
  }
}

export class HubFailureError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('hub_error', 502, message, { cause });
    this.name = 'HubFailureError';
  }
}
