// bits.ts - the MSB-first bit stream (see FORMAT.md) and its text form
import { DenseDecodeError } from '../errors';
import { BaseSpec, getCharsForBase } from '../encoding/alphabets';
import { baseStringToBigInt, bigIntToBaseString, bitsForChars, charsForBits } from '../encoding/radix';

/**
 * Helper class for writing the uInt numeric value of a field in the schema into the bigint representing the densed data
 */
export class BitWriter {
  private buffer: bigint;
  private bitsWritten: number;

  constructor() {
    this.buffer = 0n;
    this.bitsWritten = 0;
  }

  /**
   * Append `value` as an unsigned integer of exactly `bitWidth` bits
   * @throws when the value is not a non-negative integer that fits in `bitWidth` bits; values are
   * never truncated, so a bad value cannot turn into a valid-looking payload
   */
  writeUInt = (value: number | bigint, bitWidth: number): void => {
    if (typeof value === 'number' && !Number.isInteger(value))
      throw new RangeError(`Cannot write ${value}: not an integer`);
    const v = BigInt(value);
    if (v < 0n || v >> BigInt(Math.max(bitWidth, 0)) !== 0n)
      throw new RangeError(`Cannot write ${value} in ${Math.max(bitWidth, 0)} bits`);
    if (bitWidth <= 0) return;

    const bw = BigInt(bitWidth);
    this.buffer = (this.buffer << bw) | v;
    this.bitsWritten += bitWidth;
  };

  getBigInt = (): bigint => this.buffer;

  getBitLength = (): number => Number(this.bitsWritten);

  /**
   * The stream as text: the fewest characters that hold all bits written, with the stream
   * left-aligned in them (zero padding at the end)
   */
  getFromBase = (base: BaseSpec = 'base64url'): string => {
    const alphabet = getCharsForBase(base);
    const chars = charsForBits(this.bitsWritten, alphabet.length);
    const padding = bitsForChars(chars, alphabet.length) - this.bitsWritten;
    return bigIntToBaseString(this.buffer << BigInt(padding), alphabet, chars);
  };
}

/**
 * Helper class for reading the uInt numeric value of a field in the schema from the bigint representing the densed data
 */
export class BitReader {
  private buffer: bigint;
  private bitsLeft: number;
  private readonly totalBits: number;
  private readonly charCount: number;
  private readonly baseChars: string;

  private constructor(bigInt: bigint, totalBits: number, charCount: number, baseChars: string) {
    this.buffer = bigInt;
    this.bitsLeft = totalBits;
    this.totalBits = totalBits;
    this.charCount = charCount;
    this.baseChars = baseChars;
  }

  /** Read an unsigned integer of up to 53 bits (the safe-integer range of a JS number) */
  readUInt = (bitWidth: number): number => {
    if (bitWidth === 0) return 0;
    if (bitWidth > 53) throw new Error(`Cannot read ${bitWidth} bits into a number (at most 53)`);
    return Number(this.readUBigInt(bitWidth));
  };

  /** @throws DenseDecodeError when the payload ends before `bitWidth` more bits */
  readUBigInt = (bitWidth: number): bigint => {
    if (bitWidth === 0) return 0n;
    if (bitWidth > this.bitsLeft)
      throw new DenseDecodeError('', `unexpected end of input: ${bitWidth} more bits needed, ${this.bitsLeft} left`);

    // applying the bitWidth delta to the bitsLeft
    this.bitsLeft -= bitWidth;

    const shift = BigInt(this.bitsLeft);
    const bw = BigInt(bitWidth);
    const mask = (1n << bw) - 1n;

    const value = (this.buffer >> shift) & mask;

    return value;
  };

  getBitsLeft = (): number => this.bitsLeft;

  /**
   * Check that the payload ends where the encoder would have ended it: exactly as many characters as
   * the bits read need, and zero padding. Rejects trailing characters and non-canonical encodings, so
   * every payload decodes from exactly one string.
   * @throws DenseDecodeError
   */
  assertCanonicalEnd = (): void => {
    const bitsRead = this.totalBits - this.bitsLeft;
    const expectedChars = charsForBits(bitsRead, this.baseChars.length);
    if (this.charCount !== expectedChars)
      throw new DenseDecodeError(
        '',
        `expected ${expectedChars} characters for ${bitsRead} bits of data, got ${this.charCount}`
      );
    if (this.readUBigInt(this.bitsLeft) !== 0n) throw new DenseDecodeError('', 'non-zero padding bits');
  };

  /** @throws DenseDecodeError for characters outside the alphabet or a value the characters cannot be */
  static getFromBase = (baseString: string, base: BaseSpec): BitReader => {
    const baseChars = getCharsForBase(base);
    const value = baseStringToBigInt(baseString, baseChars);
    const totalBits = bitsForChars(baseString.length, baseChars.length);
    // alphabets whose size is not a power of two can spell values above the bit capacity; the
    // encoder never produces them
    if (value >> BigInt(totalBits) !== 0n)
      throw new DenseDecodeError('', `value exceeds the ${totalBits} bits ${baseString.length} characters hold`);
    return new BitReader(value, totalBits, baseString.length, baseChars);
  };
}
