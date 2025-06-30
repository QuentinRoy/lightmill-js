import { filter, map, pipe, prop, sortBy } from 'remeda';

export function parseAcceptHeader(acceptHeader: string | undefined) {
  if (acceptHeader == null) return [];
  return pipe(
    acceptHeader.split(','),
    map(parseAcceptHeaderPart),
    filter((p) => p.type != null),
    sortBy([prop('weight'), 'desc']),
  );
}

function parseAcceptHeaderPart(part: string) {
  let [type, weight] = part.split(';');
  type = type?.trim();
  if (type == null || type === '') return { type: null, weight: 0 };
  return {
    type: type.trim(),
    weight: weight == null ? 1.0 : parseAcceptHeaderWeight(weight),
  };
}

function parseAcceptHeaderWeight(q: string | undefined) {
  if (q == null) return 1.0;
  let match = q.match(/^\s*q\s*=\s*([0-9.]+)\s*$/);
  let value = match?.[1];
  if (value == null) return 0;
  return parseFloat(value);
}
