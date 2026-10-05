import {
  httpStatuses,
  type HttpStatusCode,
  type HttpStatusMap,
  type HttpStatusText,
} from '@lightmill/log-api/vocabulary';
import type { ConditionalKeys, JsonObject } from 'type-fest';
import type { NewLog } from './data-store.ts';

/** The log a log resource of a request body describes. */
export function toNewLog({
  attributes,
}: {
  attributes: {
    number: number;
    logType: string;
    values: Record<string, unknown>;
  };
}): NewLog {
  return {
    number: attributes.number,
    type: attributes.logType,
    // values is necessarily a JsonObject since it's coming from the request
    // body.
    values: attributes.values as JsonObject,
  };
}

export function parseCookies(cookieHeader: string | undefined) {
  if (cookieHeader == null) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [key, value] = cookie
        .split('=')
        .map((part) => decodeURIComponent(part.trim()));
      if (key == null || value == null) {
        throw new Error(
          `Invalid cookie format: "${cookie}". Expected "key=value" format.`,
        );
      }
      return [key, value];
    }),
  );
}

export const reverseHttpStatuses = Object.fromEntries(
  Object.entries(httpStatuses).map(([code, text]) => [text, Number(code)]),
) as ReverseHttpStatusMap;

export function httpStatusCodeFromText<const Text extends HttpStatusText>(
  status: Text,
): HttpStatusCodeFromText<Text> {
  return reverseHttpStatuses[status];
}

export function httpStatusTextFromCode<Code extends HttpStatusCode>(
  status: Code,
): HttpStatusTextFromCode<Code> {
  return httpStatuses[status];
}

export type ReverseHttpStatusMap = {
  [Text in HttpStatusText]: ConditionalKeys<HttpStatusMap, Text>;
};
export type HttpStatusCodeFromText<Text extends HttpStatusText> =
  ReverseHttpStatusMap[Text];
export type HttpStatusTextFromCode<Code extends HttpStatusCode> =
  HttpStatusMap[Code];

export const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof httpMethods)[number];
