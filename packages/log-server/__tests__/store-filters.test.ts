import { describe, expect, it } from 'vitest';
import { parseRunStatusFilter } from '../src/store-filters.js';

describe('parseRunStatusFilter', () => {
  it('returns undefined if input is undefined', () => {
    expect(parseRunStatusFilter(undefined)).toBeUndefined();
  });

  it('returns empty array if input is empty array', () => {
    expect(parseRunStatusFilter([])).toEqual([]);
  });

  it('returns array with single status if input is a single status', () => {
    expect(parseRunStatusFilter('running')).toEqual(['running']);
  });

  it('returns array with multiple statuses if input is an array', () => {
    expect(parseRunStatusFilter(['running', 'completed'])?.sort()).toEqual(
      ['completed', 'running'].sort(),
    );
  });

  it('excludes statuses with "-" prefix', () => {
    expect(parseRunStatusFilter(['-running', '-completed'])?.sort()).toEqual(
      ['idle', 'canceled', 'interrupted'].sort(),
    );
  });

  it('includes all except excluded if first is exclusion', () => {
    expect(parseRunStatusFilter(['-idle', '-canceled'])?.sort()).toEqual(
      ['running', 'completed', 'interrupted'].sort(),
    );
  });

  it('includes only explicitly specified statuses if no exclusions', () => {
    expect(parseRunStatusFilter(['completed', 'idle'])?.sort()).toEqual(
      ['completed', 'idle'].sort(),
    );
  });

  it('handles duplicate statuses', () => {
    expect(
      parseRunStatusFilter(['running', 'running', 'completed'])?.sort(),
    ).toEqual(['running', 'completed'].sort());
  });

  it('handles exclusion of all', () => {
    expect(
      parseRunStatusFilter([
        '-idle',
        '-running',
        '-completed',
        '-canceled',
        '-interrupted',
      ]),
    ).toEqual([]);
  });

  it('handles mixing inclusion and exclusions (discouraged)', () => {
    expect(
      parseRunStatusFilter(['idle', 'running', '-idle', '-canceled']),
    ).toEqual(['running']);
    expect(
      parseRunStatusFilter(['-idle', 'running', '-canceled'])?.sort(),
    ).toEqual(['running', 'completed', 'interrupted'].sort());
    expect(
      parseRunStatusFilter(['-idle', 'running', '-canceled', 'idle'])?.sort(),
    ).toEqual(['idle', 'running', 'completed', 'interrupted'].sort());
  });
});
