import { describe, expect, test } from 'bun:test';
import { bitsForRange } from '../densing';
import { bitsForChars, bitsForDigits, charsForBits } from '../encoding/radix';

// #11: widths are derived with integer arithmetic only. These tests compare them with the previous
// floating-point formulas over the ranges in practical use; any disagreement would be a latent bug
// in the old formula (the only one known is bitsForRange(2^49 + 1), covered in wide-fields.test.ts).

describe('integer widths match the previous Math.log2 formulas', () => {
  test('bitsForRange for every range 1..2^20', () => {
    for (let range = 1; range <= 2 ** 20; range++) {
      const expected = range <= 1 ? 0 : Math.ceil(Math.log2(range));
      if (bitsForRange(range) !== expected) expect({ range, bits: bitsForRange(range) }).toEqual({ range, bits: expected });
    }
  });

  test('enum array content for bases 2..64 and lengths 1..256', () => {
    for (let base = 2; base <= 64; base++)
      for (let length = 1; length <= 256; length++) {
        const expected = Math.ceil(length * Math.log2(base));
        if (bitsForDigits(length, base) !== expected)
          expect({ base, length, bits: bitsForDigits(length, base) }).toEqual({ base, length, bits: expected });
      }
  });

  test('character counts for alphabets of 2..95 characters and 1..2048 bits', () => {
    for (let base = 2; base <= 95; base++)
      for (let bits = 1; bits <= 2048; bits++) {
        const chars = Math.ceil(bits / Math.log2(base));
        const capacity = Math.floor(chars * Math.log2(base));
        if (charsForBits(bits, base) !== chars || bitsForChars(chars, base) !== capacity)
          expect({ base, bits, chars: charsForBits(bits, base), capacity: bitsForChars(chars, base) }).toEqual({
            base,
            bits,
            chars,
            capacity
          });
      }
  }, 30_000);
});

describe('integer widths are exact by definition', () => {
  test('bitsForDigits is the bit length of base^count - 1', () => {
    expect(bitsForDigits(0, 3)).toBe(0);
    expect(bitsForDigits(3, 3)).toBe(5); // 26 = 11010
    expect(bitsForDigits(5, 10)).toBe(17); // 99999 < 2^17
    expect(bitsForDigits(1000, 10)).toBe((10n ** 1000n - 1n).toString(2).length);
  });

  test('charsForBits is the smallest count with base^chars >= 2^bits, bitsForChars the bits they hold', () => {
    for (const [base, bits] of [[38, 1], [38, 15], [38, 16], [10, 10], [10, 1000], [64, 6], [64, 7]]) {
      const chars = charsForBits(bits, base);
      expect(BigInt(base) ** BigInt(chars) >= 1n << BigInt(bits)).toBe(true);
      expect(BigInt(base) ** BigInt(chars - 1) < 1n << BigInt(bits)).toBe(true);
      const capacity = bitsForChars(chars, base);
      expect(1n << BigInt(capacity) <= BigInt(base) ** BigInt(chars)).toBe(true);
      expect(1n << BigInt(capacity + 1) > BigInt(base) ** BigInt(chars)).toBe(true);
    }
    expect(charsForBits(0, 38)).toBe(0);
    expect(bitsForChars(0, 38)).toBe(0);
  });
});
