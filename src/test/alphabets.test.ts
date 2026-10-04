import { describe, expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { customBase } from '../encoding/alphabets';
import {
  charsForBits,
  getBase64FromBigInt,
  getBigIntFromBase64,
  getBigIntFrombaseQRCode45UrlSafe,
  getbaseQRCode45UrlSafeFromBigInt
} from '../encoding/radix';
import { enumeration, int, schema } from '../schema/builder';

describe('#12: the exported base helpers are inverses, with or without bitWidth', () => {
  const pairs = [
    ['base64url', getBase64FromBigInt, getBigIntFromBase64, 64],
    ['baseQRCode45UrlSafe', getbaseQRCode45UrlSafeFromBigInt, getBigIntFrombaseQRCode45UrlSafe, 38]
  ] as const;

  for (const [name, encode, decode, size] of pairs) {
    test(name, () => {
      for (let width = 1; width <= 80; width++) {
        for (const value of [0n, 1n, (1n << BigInt(width)) - 1n, (1n << BigInt(width)) / 3n]) {
          const encoded = encode(value, width);
          expect(encoded.length).toBe(charsForBits(width, size));
          expect(decode(encoded)).toBe(value);
          expect(decode(encode(value))).toBe(value);
        }
      }
    });
  }

  test('issue reproduction', () => {
    expect(getBigIntFromBase64(getBase64FromBigInt(12345n, 16))).toBe(12345n);
    expect(getBigIntFromBase64(getBase64FromBigInt(12345n))).toBe(12345n);
  });

  test('a value that does not fit the requested width throws', () => {
    expect(() => getBase64FromBigInt(12345n, 10)).toThrow('12345 does not fit in 10 bits');
    expect(() => getBase64FromBigInt(-1n, 10)).toThrow(RangeError);
    expect(() => getBase64FromBigInt(-1n)).toThrow(RangeError);
  });
});

describe('#16: custom alphabets', () => {
  const S = schema(int('a', 0, 255), enumeration('e', ['x', 'y', 'z']));
  const data = { a: 200, e: 'z' };

  test('customBase is never mistaken for a named base', () => {
    expect(densing(S, data, 'binary')).toBe('1100100010');
    const sixChars = customBase('binary'); // the alphabet b, i, n, a, r, y
    const encoded = densing(S, data, sixChars);
    expect(encoded).not.toBe('1100100010');
    expect(encoded.length).toBe(4); // 10 bits in base 6
    expect(undensing(S, encoded, sixChars)).toEqual(data);
  });

  test('plain strings still work as custom alphabets', () => {
    expect(densing(S, data, '0123456789ABCDEF')).toBe(densing(S, data, customBase('0123456789ABCDEF')));
  });

  test('alphabets that cannot be decoded unambiguously are rejected', () => {
    expect(() => customBase('a')).toThrow('needs at least 2 characters');
    expect(() => customBase('')).toThrow('needs at least 2 characters');
    expect(() => customBase('abca')).toThrow('duplicate character "a"');
    expect(() => customBase('ab😀')).toThrow('single UTF-16 code units');
    // a single-character alphabet used to loop forever
    expect(() => densing(S, data, 'a')).toThrow('needs at least 2 characters');
    expect(() => undensing(S, 'aaaa', 'aab')).toThrow('duplicate character "a"');
  });
});
