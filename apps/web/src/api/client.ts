import { API_BASE_PATH } from '@milight-studio/shared';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Thrown for every non-2xx response, and for responses we cannot parse. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details: readonly ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Human readable summary including field-level problems, ready for a toast. */
  get fullMessage(): string {
    if (this.details.length === 0) return this.message;
    const fields = this.details.map((detail) => `${detail.path}: ${detail.message}`).join(', ');
    return `${this.message} (${fields})`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pull `code`/`message`/`details` out of the standard error envelope, defensively. */
export function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const envelope = body.error;
    const code = typeof envelope.code === 'string' ? envelope.code : 'unknown_error';
    const message = typeof envelope.message === 'string' ? envelope.message : 'Onbekende serverfout.';
    const rawDetails = envelope.details;
    const details: ApiErrorDetail[] = Array.isArray(rawDetails)
      ? rawDetails.flatMap((detail: unknown) =>
          isRecord(detail) && typeof detail.path === 'string' && typeof detail.message === 'string'
            ? [{ path: detail.path, message: detail.message }]
            : [],
        )
      : [];
    return new ApiError(status, code, message, details);
  }
  return new ApiError(status, 'invalid_response', `Onverwacht antwoord van de server (${status}).`);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Typed fetch wrapper. Returns `undefined` (cast to `T`) for 204 responses so
 * callers can type delete/pair endpoints as `Promise<void>`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Netwerkfout';
    throw new ApiError(0, 'network_error', `De server is niet bereikbaar: ${message}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parseFailed = true;
  }

  if (!response.ok) {
    if (parseFailed) {
      throw new ApiError(
        response.status,
        'invalid_response',
        `Onverwacht antwoord van de server (${response.status}).`,
      );
    }
    throw parseErrorEnvelope(response.status, parsed);
  }

  if (parseFailed) {
    throw new ApiError(response.status, 'invalid_response', 'De server stuurde geen geldige JSON terug.');
  }

  return parsed as T;
}

/** For 204-only endpoints, where there is nothing to decode. */
export async function requestVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await request<unknown>(path, options);
}
