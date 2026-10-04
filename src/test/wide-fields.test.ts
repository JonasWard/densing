import { expect, test } from 'bun:test';
import { bitsForRange, densing, undensing } from '../densing';
import { fixed, int, schema } from '../schema/builder';
import { validate } from '../schema/validation';

test('ints wider than 32 bits round-trip (millisecond timestamps)', () => {
  const S = schema(int('ts', 0, 2 ** 42));
  for (const ts of [0, 1_700_000_000_123, 2 ** 42]) expect(undensing(S, densing(S, { ts }))).toEqual({ ts });
});

test('fixed fields wider than 32 bits round-trip (longitude at 1e-8)', () => {
  const S = schema(fixed('lon', -180, 180, 1e-8));
  for (const lon of [-180, 12.5, 4.35678912, 179.99999999, 180]) expect(undensing(S, densing(S, { lon })).lon).toBe(lon);
});

test('very fine precisions accept on-grid values and reject off-grid ones', () => {
  const S = schema(fixed('lon', -180, 180, 1e-10));
  for (const lon of [-179.9999999999, 4.3567891234, 179.9999999999]) {
    expect(validate(S, { lon }).valid).toBe(true);
    expect(undensing(S, densing(S, { lon })).lon).toBe(lon);
  }
  expect(validate(S, { lon: 4.35678912345 }).valid).toBe(false);
});

test('53-bit fields are the widest', () => {
  const S = schema(int('x', 0, 2 ** 53 - 1));
  const x = Number.MAX_SAFE_INTEGER;
  expect(undensing(S, densing(S, { x }))).toEqual({ x });
  expect(() => int('x', 0, 2 ** 53)).toThrow('int "x": range [0, 9007199254740992] needs more than 53 bits');
  expect(() => fixed('f', 0, 1e6, 1e-10)).toThrow('needs more than 53 bits');
});

test('bitsForRange is exact just above large powers of two', () => {
  // Math.ceil(Math.log2(2 ** 49 + 1)) is 49, one bit short
  expect(bitsForRange(2 ** 49 + 1)).toBe(50);
  const S = schema(int('x', 0, 2 ** 49));
  expect(undensing(S, densing(S, { x: 2 ** 49 }))).toEqual({ x: 2 ** 49 });
  for (let k = 1; k <= 53; k++) {
    expect(bitsForRange(2 ** k)).toBe(k);
    if (k > 1) expect(bitsForRange(2 ** k - 1)).toBe(k);
    if (k < 53) expect(bitsForRange(2 ** k + 1)).toBe(k + 1);
  }
});
