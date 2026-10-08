import { describe, expect, it } from 'vitest';
import { RequestError } from '../src/utils.js';

describe('RequestError', () => {
  it('should fall back to the status code without a body or status text', () => {
    const error = new RequestError({
      response: new Response(null, { status: 502, statusText: '' }),
      error: '',
    });
    expect(error.message).toBe('HTTP 502');
    expect(error.errors).toEqual([{ status: 'HTTP 502' }]);
  });

  it('should use the status text when there is no body', () => {
    const error = new RequestError({
      response: new Response(null, { status: 502, statusText: 'Bad Gateway' }),
      error: '',
    });
    expect(error.message).toBe('Bad Gateway');
  });

  it('should build from a body with an empty errors array', () => {
    const response = new Response(null, {
      status: 502,
      statusText: 'Bad Gateway',
    });
    const error = new RequestError({ response, error: { errors: [] } });
    expect(error).toMatchObject({
      message: 'Bad Gateway',
      status: 502,
      errors: [{ status: 'Bad Gateway' }],
      detail: undefined,
      code: undefined,
    });
    expect(error.headers).toBe(response.headers);
  });
});
