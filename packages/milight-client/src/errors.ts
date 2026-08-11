/** Base class for every failure raised by the Milight hub client. */
export class MilightHubError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(message: string, options: { code: string; status?: number; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MilightHubError';
    this.code = options.code;
    this.status = options.status;
  }
}

/** The hub could not be reached at all (DNS, connection refused, timeout). */
export class MilightHubUnreachableError extends MilightHubError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'hub_unreachable', cause });
    this.name = 'MilightHubUnreachableError';
  }
}

/** The hub answered, but with an error status. */
export class MilightHubResponseError extends MilightHubError {
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message, { code: 'hub_error', status });
    this.name = 'MilightHubResponseError';
    this.body = body;
  }
}

export function isMilightHubError(error: unknown): error is MilightHubError {
  return error instanceof MilightHubError;
}
