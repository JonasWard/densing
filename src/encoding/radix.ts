// radix.ts - conversion between non-negative BigInts and strings of digits in an alphabet.
// Plain radix conversion with no hidden state: the bit-stream padding lives in `codec/bits.ts`.
import { DenseDecodeError } from '../errors';
import { base64url, baseQRCode45UrlSafe } from './alphabets';

// Width arithmetic is integer-only (no Math.log2): floating-point logarithms are not required to be
// correctly rounded, so another implementation could compute a different width and misread every
// field after it. See FORMAT.md.

/** Number of bits in the binary representation of `n` (0 for 0) */
export const bitLength = (n: bigint): number => (n <= 0n ? 0 : n.toString(2).length);

/** `k` when `base` is `2^k`, otherwise `undefined` */
export const powerOfTwoExponent = (base: number): number | undefined =>
  (base & (base - 1)) === 0 ? bitLength(BigInt(base)) - 1 : undefined;

/** Smallest number of characters of a `base`-character alphabet that hold `bits` bits: min c with base^c >= 2^bits */
export const charsForBits = (bits: number, base: number): number => {
  if (bits <= 0) return 0;
  const k = powerOfTwoExponent(base);
  if (k !== undefined) return Math.ceil(bits / k);

  // each character holds between floor(log2 base) and ceil(log2 base) bits: start from the lower
  // bound on the count and step up exactly
  const b = BigInt(base);
  const target = 1n << BigInt(bits);
  let chars = Math.ceil(bits / bitLength(b));
  let capacity = b ** BigInt(chars);
  while (capacity < target) (capacity *= b), chars++;
  return chars;
};

/** Number of whole bits `chars` characters of a `base`-character alphabet hold: floor(log2(base^chars)) */
export const bitsForChars = (chars: number, base: number): number => {
  if (chars <= 0) return 0;
  const k = powerOfTwoExponent(base);
  if (k !== undefined) return chars * k;
  return bitLength(BigInt(base) ** BigInt(chars)) - 1;
};

const digitBitsCache = new Map<string, number>();
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Bits needed for any `count`-digit number in `base`: the bit length of `base^count - 1` */
export const bitsForDigits = (count: number, base: number): number => {
  if (count < 1) return 0;
  const k = powerOfTwoExponent(base);
  if (k !== undefined) return count * k;
  const key = `${base}:${count}`;
  let bits = digitBitsCache.get(key);
  if (bits === undefined) {
    bits = bitLength(BigInt(base) ** BigInt(count) - 1n);
    digitBitsCache.set(key, bits);
  }
  return bits;
};

/**
 * Write a non-negative value in an alphabet, most significant digit first, padded with leading zero
 * digits (`alphabet[0]`) to at least `minChars` characters
 */
export const bigIntToBaseString = (value: bigint, alphabet: string, minChars: number = 0): string => {
  if (value < 0n) throw new RangeError(`Cannot write negative value ${value}`);
  const k = powerOfTwoExponent(alphabet.length);
  if (k !== undefined) {
    // every character is exactly k bits: small values with plain numbers, larger ones by cutting the
    // binary form into k-bit groups (linear time; dividing a BigInt digit by digit is quadratic)
    if (value <= MAX_SAFE) {
      const digits: string[] = [];
      const radix = 2 ** k;
      for (let v = Number(value); v > 0; v = Math.floor(v / radix)) digits.push(alphabet[v % radix]);
      while (digits.length < minChars) digits.push(alphabet[0]);
      return digits.reverse().join('');
    }
    const bits = value.toString(2);
    const chars = Math.max(minChars, Math.ceil(bits.length / k));
    const padded = bits.padStart(chars * k, '0');
    let out = '';
    for (let i = 0; i < chars; i++) out += alphabet[parseInt(padded.slice(i * k, (i + 1) * k), 2)];
    return out;
  }
  const base = BigInt(alphabet.length);
  const digits: string[] = [];
  for (let v = value; v > 0n; v /= base) digits.push(alphabet[Number(v % base)]);
  while (digits.length < minChars) digits.push(alphabet[0]);
  return digits.reverse().join('');
};

/**
 * The bits of a string in a `2^k`-character alphabet, k per character, as a string of 0s and 1s
 * @throws DenseDecodeError for a character that is not in the alphabet
 */
export const baseStringToBits = (baseString: string, alphabet: string, k: number): string => {
  const groups: string[] = new Array(baseString.length);
  for (let i = 0; i < baseString.length; i++) {
    const digit = alphabet.indexOf(baseString[i]);
    if (digit === -1) throw new DenseDecodeError('', `invalid character "${baseString[i]}" at position ${i}`);
    groups[i] = digit.toString(2).padStart(k, '0');
  }
  return groups.join('');
};

/**
 * Read a string of digits in an alphabet, most significant digit first
 * @throws DenseDecodeError for a character that is not in the alphabet
 */
export const baseStringToBigInt = (baseString: string, alphabet: string): bigint => {
  const k = powerOfTwoExponent(alphabet.length);
  if (k !== undefined) return BigInt('0b0' + baseStringToBits(baseString, alphabet, k));
  const base = BigInt(alphabet.length);
  let acc = 0n;
  for (let i = 0; i < baseString.length; i++) {
    const digit = alphabet.indexOf(baseString[i]);
    if (digit === -1) throw new DenseDecodeError('', `invalid character "${baseString[i]}" at position ${i}`);
    acc = acc * base + BigInt(digit);
  }
  return acc;
};

/**
 * Value → string in a named alphabet. Inverse of the matching `getBigIntFrom…` for every value.
 * @param bitWidth - optional: pad with leading zero digits to hold this many bits; throws when the
 * value does not fit in it
 */
const toBase =
  (alphabet: string) =>
  (bigInt: bigint, bitWidth?: number): string => {
    if (bitWidth !== undefined && (bigInt < 0n || bigInt >> BigInt(bitWidth) !== 0n))
      throw new RangeError(`${bigInt} does not fit in ${bitWidth} bits`);
    return bigIntToBaseString(bigInt, alphabet, bitWidth === undefined ? 0 : charsForBits(bitWidth, alphabet.length));
  };

const fromBase =
  (alphabet: string) =>
  (encoded: string): bigint =>
    baseStringToBigInt(encoded, alphabet);

export const getBase64FromBigInt: (bigInt: bigint, bitWidth?: number) => string = toBase(base64url);
export const getBigIntFromBase64: (encoded: string) => bigint = fromBase(base64url);
export const getbaseQRCode45UrlSafeFromBigInt: (bigInt: bigint, bitWidth?: number) => string = toBase(baseQRCode45UrlSafe);
export const getBigIntFrombaseQRCode45UrlSafe: (encoded: string) => bigint = fromBase(baseQRCode45UrlSafe);
