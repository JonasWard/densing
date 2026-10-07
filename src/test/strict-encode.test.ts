import { describe, expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { BitWriter } from '../codec/bits';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, schema, union } from '../schema/builder';
import { validate } from '../schema/validation';
import { DenseEncodeError } from '../errors';

const encodeError = (fn: () => unknown): DenseEncodeError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DenseEncodeError) return e;
    throw e;
  }
  throw new Error('expected a DenseEncodeError');
};

describe('#2: the encoder rejects values that do not fit instead of truncating them', () => {
  const S = schema(int('x', 0, 15));

  test('out of range and negative ints throw with the allowed range', () => {
    expect(encodeError(() => densing(S, { x: 99 })).message).toBe('x: value 99 out of range [0, 15]');
    expect(encodeError(() => densing(S, { x: -1 })).message).toBe('x: value -1 out of range [0, 15]');
  });

  test('non-integers and wrong types throw', () => {
    expect(encodeError(() => densing(S, { x: 3.7 })).message).toBe('x: expected integer');
    expect(encodeError(() => densing(S, { x: '3' })).message).toBe('x: expected integer');
    expect(encodeError(() => densing(schema(bool('b')), { b: 1 })).message).toBe('b: expected boolean');
  });

  test('missing values throw', () => {
    expect(encodeError(() => densing(S, {})).message).toBe('x: missing value');
    expect(encodeError(() => densing(S, null)).message).toBe('expected object');
  });

  test('an unknown enum value no longer becomes another option', () => {
    const E = schema(enumeration('e', ['a', 'b', 'c', 'd']));
    expect(encodeError(() => densing(E, { e: 'z' })).message).toBe('e: invalid enum value z, expected one of [a, b, c, d]');
  });

  test('array lengths outside [minLength, maxLength] throw instead of corrupting the next field', () => {
    const A = schema(array('a', 2, 2, int('v', 0, 3)), int('y', 0, 3));
    expect(encodeError(() => densing(A, { a: [1, 2, 3], y: 1 })).message).toBe('a: array length 3 exceeds maxLength 2');
    expect(encodeError(() => densing(A, { a: [1], y: 1 })).message).toBe('a: array length 1 is less than minLength 2');
    const EA = schema(enumArray('e', enumeration('d', ['x', 'y']), 0, 2));
    expect(encodeError(() => densing(EA, { e: ['x', 'y', 'x'] })).message).toBe('e: array length 3 exceeds maxLength 2');
    expect(encodeError(() => densing(EA, { e: ['x', 'q'] })).path).toBe('e[1]');
  });

  test('error paths point at the offending value', () => {
    const N = schema(
      object(
        'net',
        array('hosts', 0, 4, int('h', 0, 255)),
        union('mode', enumeration('kind', ['dhcp', 'static']), { dhcp: [], static: [int('ip', 0, 255)] })
      )
    );
    const ok = { net: { hosts: [1, 2], mode: { kind: 'static', ip: 1 } } };
    expect(encodeError(() => densing(N, { net: { ...ok.net, hosts: [1, 256] } })).path).toBe('net.hosts[1]');
    expect(encodeError(() => densing(N, { net: { ...ok.net, mode: { kind: 'static', ip: -5 } } })).path).toBe('net.mode.ip');
    expect(encodeError(() => densing(N, { net: { ...ok.net, mode: { kind: 'manual' } } })).path).toBe('net.mode.kind');
  });

  test('valid data, optionals and long enum arrays still encode', () => {
    const O = schema(optional('o', int('v', 0, 3)), enumArray('e', enumeration('d', ['a', 'b', 'c']), 0, 40));
    const data = { o: null, e: Array.from({ length: 40 }, (_, i) => ['a', 'b', 'c'][i % 3]) };
    expect(undensing(O, densing(O, data))).toEqual(data);
  });
});

describe('BitWriter.writeUInt never truncates', () => {
  test('rejects values that do not fit', () => {
    const w = new BitWriter();
    expect(() => w.writeUInt(16, 4)).toThrow(RangeError);
    expect(() => w.writeUInt(-1, 4)).toThrow(RangeError);
    expect(() => w.writeUInt(1.5, 4)).toThrow(RangeError);
    expect(() => w.writeUInt(1, 0)).toThrow(RangeError);
    expect(() => w.writeUInt(2n ** 40n, 40)).toThrow(RangeError);
  });

  test('accepts values that fit, including 0 in a 0-bit field', () => {
    const w = new BitWriter();
    w.writeUInt(0, 0);
    w.writeUInt(15, 4);
    w.writeUInt(2n ** 40n - 1n, 40);
    expect(w.getBitLength()).toBe(44);
  });
});

describe('#3: fixed-point precision alignment', () => {
  const T = schema(fixed('t', 0, 10, 0.1));

  test('values between steps are invalid, steps are valid', () => {
    expect(validate(T, { t: 3.14 }).errors).toEqual([{ path: 't', message: 'value 3.14 does not align with precision 0.1' }]);
    for (const t of [3.1, 0, 10, 0.1 + 0.2]) expect(validate(T, { t }).valid).toBe(true);
    expect(encodeError(() => densing(T, { t: 3.14 })).message).toBe('t: value 3.14 does not align with precision 0.1');
  });

  test('values that are exact but awkward in binary stay valid', () => {
    const W = schema(fixed('p', -40, 125, 0.1));
    for (const p of [0.1, 100.3, -39.9, 124.9]) expect(validate(W, { p }).valid).toBe(true);
  });

  test('range is checked before alignment', () => {
    expect(validate(T, { t: 10.5 }).errors[0].message).toBe('value 10.5 out of range [0, 10]');
    expect(validate(T, { t: -0.04 }).errors[0].message).toBe('value -0.04 does not align with precision 0.1');
  });
});

describe('#4: fixed-point values round-trip exactly', () => {
  test('issue reproductions', () => {
    const S = schema(fixed('p', -40, 125, 0.1));
    expect(undensing(S, densing(S, { p: 0.1 })).p).toBe(0.1);
    expect(undensing(S, densing(S, { p: 100.3 })).p).toBe(100.3);
  });

  for (const precision of [0.1, 0.01, 0.001]) {
    for (const min of [-40, -1.5, 0, 2.25]) {
      test(`every step round-trips (precision ${precision}, min ${min})`, () => {
        const scale = Math.round(1 / precision);
        const S = schema(fixed('v', min, min + 3, precision));
        const digits = Math.round(Math.log10(scale));
        for (let k = 0; k <= 3 * scale; k++) {
          // the decimal value of step k, as a user would write it
          const v = Number((min + k / scale).toFixed(digits));
          if (!validate(S, { v }).valid) continue; // min not on this precision grid (2.25 at 0.1)
          expect(undensing(S, densing(S, { v })).v).toBe(v);
        }
      });
    }
  }

  test('a min that is not on the precision grid keeps its meaning', () => {
    const S = schema(fixed('f', 0.05, 1, 0.1));
    expect(undensing(S, densing(S, { f: 0.15 })).f).toBe(0.15);
    expect(densing(S, { f: 0.15 }, 'binary')).toBe('0001');
  });
});

test('validate() and densing() agree on every value', () => {
  const S = schema(int('i', -5, 5), fixed('f', -1, 1, 0.25), enumeration('e', ['a', 'b', 'c']), bool('b'));
  const candidates: Record<string, unknown[]> = {
    i: [-6, -5, 0, 5, 6, 1.5, '1', null, undefined],
    f: [-1.25, -1, -0.5, 0.25, 0.3, 1, 1.0000000001, NaN, '0'],
    e: ['a', 'c', 'd', 1, undefined],
    b: [true, false, 0, 'true']
  };
  const base = { i: 0, f: 0, e: 'a', b: true };
  for (const [key, values] of Object.entries(candidates)) {
    for (const value of values) {
      const data = { ...base, [key]: value };
      let threw = false;
      try {
        densing(S, data);
      } catch (e) {
        expect(e).toBeInstanceOf(DenseEncodeError);
        threw = true;
      }
      expect({ key, value, valid: validate(S, data).valid }).toEqual({ key, value, valid: !threw });
    }
  }
});
