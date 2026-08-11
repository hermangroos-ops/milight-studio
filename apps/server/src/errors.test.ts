import { describe, expect, it } from 'vitest';

import {
  AppError,
  ConflictError,
  HubFailureError,
  HubUnreachableError,
  NotFoundError,
  UnsupportedCapabilityError,
  ValidationError,
} from './errors.js';

describe('AppError', () => {
  it('carries its code, status and optional details', () => {
    const error = new AppError('internal_error', 500, 'boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('internal_error');
    expect(error.status).toBe(500);
    expect(error.details).toBeUndefined();
  });

  it('keeps the cause when one is supplied', () => {
    const cause = new Error('root cause');
    expect(new AppError('hub_error', 502, 'wrapped', { cause }).cause).toBe(cause);
  });

  it('leaves the cause undefined when none is supplied', () => {
    expect(new AppError('hub_error', 502, 'plain').cause).toBeUndefined();
  });
});

describe('error subclasses', () => {
  const details = [{ path: 'name', message: 'required' }];

  it.each([
    { error: new NotFoundError('Light', 'abc'), code: 'not_found', status: 404, name: 'NotFoundError' },
    { error: new ConflictError('taken'), code: 'conflict', status: 409, name: 'ConflictError' },
    {
      error: new ValidationError('bad', details),
      code: 'validation_failed',
      status: 400,
      name: 'ValidationError',
    },
    {
      error: new UnsupportedCapabilityError('nope', details),
      code: 'unsupported_capability',
      status: 422,
      name: 'UnsupportedCapabilityError',
    },
    {
      error: new HubUnreachableError('gone'),
      code: 'hub_unreachable',
      status: 503,
      name: 'HubUnreachableError',
    },
    { error: new HubFailureError('sad hub'), code: 'hub_error', status: 502, name: 'HubFailureError' },
  ])('maps $name onto $status/$code', ({ error, code, status, name }) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.name).toBe(name);
  });

  it('renders a helpful not-found message', () => {
    expect(new NotFoundError('Light', 'abc').message).toBe("Light 'abc' does not exist");
  });

  it('attaches details to the errors that have them and to no others', () => {
    expect(new ValidationError('bad', details).details).toEqual(details);
    expect(new UnsupportedCapabilityError('nope', details).details).toEqual(details);
    expect(new NotFoundError('Light', 'abc').details).toBeUndefined();
    expect(new ConflictError('taken').details).toBeUndefined();
    expect(new HubUnreachableError('gone').details).toBeUndefined();
  });

  it.each([
    { build: (cause: Error) => new HubUnreachableError('gone', cause) },
    { build: (cause: Error) => new HubFailureError('sad hub', cause) },
  ])('passes the hub failure cause through', ({ build }) => {
    const cause = new Error('socket hang up');
    expect(build(cause).cause).toBe(cause);
  });
});
