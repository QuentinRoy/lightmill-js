import { describe, expect, it } from 'vitest';
import { parseAcceptHeader } from '../src/accept-headers.ts';

describe('parseAcceptHeader', () => {
  it('returns empty array for undefined header', () => {
    expect(parseAcceptHeader(undefined)).toEqual([]);
  });

  it('parses single type without weight', () => {
    expect(parseAcceptHeader('application/json')).toEqual([
      { type: 'application/json', weight: 1.0 },
    ]);
  });

  it('parses multiple types without weights', () => {
    expect(parseAcceptHeader('application/json,text/html')).toEqual([
      { type: 'application/json', weight: 1.0 },
      { type: 'text/html', weight: 1.0 },
    ]);
  });

  it('parses type with weight', () => {
    expect(parseAcceptHeader('application/json;q=0.8')).toEqual([
      { type: 'application/json', weight: 0.8 },
    ]);
  });

  it('parses multiple types with and without weights', () => {
    expect(parseAcceptHeader('application/json;q=0.8,text/html')).toEqual([
      { type: 'text/html', weight: 1.0 },
      { type: 'application/json', weight: 0.8 },
    ]);
  });

  it('sorts by weight descending', () => {
    expect(parseAcceptHeader('text/html;q=0.5,application/json;q=0.9')).toEqual(
      [
        { type: 'application/json', weight: 0.9 },
        { type: 'text/html', weight: 0.5 },
      ],
    );
  });

  it('handles extra spaces', () => {
    expect(parseAcceptHeader(' application/json ;q= 0.7 , text/html ')).toEqual(
      [
        { type: 'text/html', weight: 1.0 },
        { type: 'application/json', weight: 0.7 },
      ],
    );
  });

  it('returns weight 0 for invalid q value', () => {
    expect(parseAcceptHeader('application/json;q=abc')).toEqual([
      { type: 'application/json', weight: 0 },
    ]);
  });

  it('ignores empty parts', () => {
    expect(parseAcceptHeader('application/json,,text/html')).toEqual([
      { type: 'application/json', weight: 1.0 },
      { type: 'text/html', weight: 1.0 },
    ]);
  });

  it('always sorts results by weight descending', () => {
    expect(
      parseAcceptHeader(
        'text/plain;q=0.2,application/xml;q=0.9,application/json;q=0.5,image/png;q=0.9',
      ),
    ).toEqual([
      { type: 'application/xml', weight: 0.9 },
      { type: 'image/png', weight: 0.9 },
      { type: 'application/json', weight: 0.5 },
      { type: 'text/plain', weight: 0.2 },
    ]);
  });
});
