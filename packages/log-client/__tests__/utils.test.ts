import { describe, expect, it } from 'vitest';
import { RequestError } from '../src/utils.js';

describe('RequestError', () => {
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
