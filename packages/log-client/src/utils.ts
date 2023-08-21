import { JsonValue } from 'type-fest';

type JsonFetchUrl = string | URL;
type JsonFetchOptions<AllowBody extends boolean = true> = Omit<
  NonNullable<Parameters<typeof fetch>[1]>,
  'body' | 'method' | 'headers'
> & {
  body?: AllowBody extends true ? JsonValue : never;
  headers?: Record<string, string>;
};

function makeJsonFetchMethod(
  method: string,
  opt: { noBody: true },
): (url: JsonFetchUrl, options: JsonFetchOptions<false>) => Promise<unknown>;
function makeJsonFetchMethod(
  method: string,
  opt?: { noBody: false },
): (url: JsonFetchUrl, options: JsonFetchOptions) => Promise<unknown>;
function makeJsonFetchMethod(method: string, { noBody = false } = {}) {
  return async function fetchMethod(
    url: JsonFetchUrl,
    options: JsonFetchOptions,
  ) {
    let body = noBody ? undefined : JSON.stringify(options.body);
    let headers: JsonFetchOptions['headers'] = {
      ...options.headers,
      Accept: 'application/json',
    };
    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }
    let response = await fetch(url, { ...options, method, body, headers });
    let json = await response.json();
    if (response.ok) {
      return json as unknown;
    } else {
      throw new Error(json.message ?? 'Unknown error');
    }
  };
}

export const post = makeJsonFetchMethod('POST');
export const put = makeJsonFetchMethod('PUT');
export const get = makeJsonFetchMethod('GET', { noBody: true });
export const del = makeJsonFetchMethod('DELETE');
export const patch = makeJsonFetchMethod('PATCH');
