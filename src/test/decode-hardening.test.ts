import { describe, expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { DenseDecodeError } from '../errors';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, schema, union } from '../schema/builder';
import { validate } from '../schema/validation';
import { DenseSchema } from '../schema-type';

const decodeError = (fn: () => unknown): DenseDecodeError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DenseDecodeError) return e;
    throw e;
  }
  throw new Error('expected a DenseDecodeError');
};

const X = schema(int('x', 0, 10)); // 4 bits: stored values 11..15 are never written

describe('undensing rejects strings the encoder cannot produce', () => {
  test('characters outside the alphabet', () => {
    expect(decodeError(() => undensing(X, 'A!')).message).toBe('invalid character "!" at position 1');
    expect(decodeError(() => undensing(X, '2', 'binary')).message).toBe('invalid character "2" at position 0');
  });

  test('an int above its maximum', () => {
    // 1111 = 15 > 10
    expect(decodeError(() => undensing(X, 'F', '0123456789ABCDEF')).message).toBe(
      "x: stored value 15 exceeds the field's maximum 10"
    );
    const F = schema(fixed('f', 0, 10, 0.1)); // 7 bits, max step 100
    expect(decodeError(() => undensing(F, '1111111', 'binary')).path).toBe('f');
  });

  test('enum index, union discriminator index and array length beyond the schema', () => {
    const E = schema(enumeration('e', ['a', 'b', 'c']));
    expect(decodeError(() => undensing(E, '11', 'binary')).message).toBe("e: stored value 3 exceeds the field's maximum 2");

    const U = schema(object('o', union('u', enumeration('t', ['a', 'b', 'c']), { a: [], b: [], c: [] })));
    expect(decodeError(() => undensing(U, '11', 'binary')).message).toBe('o.u.t: discriminator index 3 exceeds the 3 options');

    const A = schema(array('a', 0, 5, bool('b'))); // 3 length bits: 6 and 7 are never written
    expect(decodeError(() => undensing(A, '1100000000', 'binary')).message).toBe('a: array length 6 exceeds maxLength 5');

    const EA = schema(enumArray('e', enumeration('d', ['x', 'y', 'z']), 1, 1)); // 3 options in 2 bits: 11 is never written
    expect(decodeError(() => undensing(EA, '11', 'binary')).message).toBe('e: content does not encode 1 values of 3 options');
  });

  test('too few characters', () => {
    expect(decodeError(() => undensing(X, '')).message).toBe('x: unexpected end of input: 4 more bits needed, 0 left');
    const N = schema(object('o', int('a', 0, 255), int('b', 0, 255)));
    expect(decodeError(() => undensing(N, 'AA')).path).toBe('o.b');
  });

  test('trailing characters', () => {
    expect(decodeError(() => undensing(X, 'AAAAAAAAAA')).message).toBe('expected 1 characters for 4 bits of data, got 10');
    expect(decodeError(() => undensing(schema(int('x', 3, 3)), 'A')).message).toBe(
      'expected 0 characters for 0 bits of data, got 1'
    );
  });

  test('non-zero padding: every payload has exactly one spelling', () => {
    expect(undensing(X, 'A')).toEqual({ x: 0 });
    for (const s of ['B', 'C', 'D']) expect(decodeError(() => undensing(X, s)).message).toBe('non-zero padding bits');
  });

  test('values above the capacity of a non-power-of-two alphabet', () => {
    // 3 base38 characters hold 15 bits (38^3 = 54872 > 2^15 = 32768)
    const S = schema(int('x', 0, 2 ** 15 - 1));
    expect(undensing(S, densing(S, { x: 2 ** 15 - 1 }, 'baseQRCode45UrlSafe'), 'baseQRCode45UrlSafe')).toEqual({
      x: 2 ** 15 - 1
    });
    expect(decodeError(() => undensing(S, '...', 'baseQRCode45UrlSafe')).message).toBe(
      'value exceeds the 15 bits 3 characters hold'
    );
  });
});

describe('fuzz: undensing either rejects a string or returns valid data that re-encodes to it', () => {
  const expr = union('expr', enumeration('type', ['number', 'add', 'neg']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')],
    neg: [pointer('inner', 'expr')]
  });
  const schemas: [string, DenseSchema][] = [
    ['ints', schema(int('a', 0, 10), int('b', -3, 3))],
    ['fixed', schema(fixed('t', -40, 125, 0.1), bool('on'))],
    ['collections', schema(array('a', 0, 5, int('v', 0, 5)), enumArray('e', enumeration('d', ['x', 'y', 'z']), 0, 4))],
    ['optional', schema(optional('o', object('in', int('w', 0, 200), enumeration('c', ['r', 'g', 'b']))))],
    ['recursive', schema(expr)]
  ];

  // deterministic pseudo-random strings
  let seed = 42;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  for (const [name, S] of schemas) {
    for (const [baseName, alphabet] of [
      ['base64url', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'],
      ['baseQRCode45UrlSafe', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.']
    ] as const) {
      test(`${name} in ${baseName}`, () => {
        let accepted = 0;
        for (let i = 0; i < 3000; i++) {
          const length = Math.floor(random() * 8);
          const s = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
          let data: any;
          try {
            data = undensing(S, s, baseName);
          } catch (e) {
            expect(e).toBeInstanceOf(DenseDecodeError);
            continue;
          }
          accepted++;
          expect(validate(S, data).valid).toBe(true);
          expect(densing(S, data, baseName)).toBe(s);
        }
        expect(accepted).toBeGreaterThan(0);
      });
    }
  }
});
