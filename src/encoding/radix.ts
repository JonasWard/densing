// radix.ts - conversion between non-negative BigInts and strings of digits in an alphabet.
// Plain radix conversion with no hidden state: the bit-stream padding lives in `codec/bits.ts`.
import { DenseDecodeError } from '../errors';
import { base64url, baseQRCode45UrlSafe } from './alphabets';

/** Smallest number of characters of a `base`-character alphabet that hold `bits` bits */
export const charsForBits = (bits: number, base: number): number => (bits <= 0 ? 0 : Math.ceil(bits / Math.log2(base)));

/** Number of whole bits `chars` characters of a `base`-character alphabet hold */
export const bitsForChars = (chars: number, base: number): number => Math.floor(chars * Math.log2(base));

/**
 * Write a non-negative value in an alphabet, most significant digit first, padded with leading zero
 * digits (`alphabet[0]`) to at least `minChars` characters
 */
export const bigIntToBaseString = (value: bigint, alphabet: string, minChars: number = 0): string => {
  if (value < 0n) throw new RangeError(`Cannot write negative value ${value}`);
  const base = BigInt(alphabet.length);
  const digits: string[] = [];
  for (let v = value; v > 0n; v /= base) digits.push(alphabet[Number(v % base)]);
  while (digits.length < minChars) digits.push(alphabet[0]);
  return digits.reverse().join('');
};

/**
 * Read a string of digits in an alphabet, most significant digit first
 * @throws DenseDecodeError for a character that is not in the alphabet
 */
export const baseStringToBigInt = (baseString: string, alphabet: string): bigint => {
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
