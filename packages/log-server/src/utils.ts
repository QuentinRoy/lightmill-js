export function arrayify<T>(value: T | T[], isEmptyWithUndefined?: false): T[];
export function arrayify<T>(
  value: T | T[] | undefined,
  isEmptyWithUndefined: true
): T[];
export function arrayify<T>(value: T | T[], isEmptyWithUndefined = false): T[] {
  if (value === undefined && isEmptyWithUndefined) return [];
  return Array.isArray(value) ? value : [value];
}
