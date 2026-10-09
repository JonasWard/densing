// bits.ts - the MSB-first bit stream (see FORMAT.md) and its text form
import { DenseDecodeError } from '../errors';
import { BaseSpec, getCharsForBase } from '../encoding/alphabets';
import {
  baseStringToBigInt,
  baseStringToBits,
  bigIntToBaseString,
  bitsForChars,
  charsForBits,
  powerOfTwoExponent
} from '../encoding/radix';

/**
 * Helper class for writing the uInt numeric value of a field in the schema into the bigint representing the densed data
 */
export class BitWriter {
  /** Full chunks, oldest first; joined only when the bits are read, so writing stays linear */
  private chunks: { value: bigint; bits: number }[] = [];
  private current: bigint;
  private currentBits: number;
  private bitsWritten: number;

  constructor() {
    this.current = 0n;
    this.currentBits = 0;
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

    this.current = (this.current << BigInt(bitWidth)) | v;
    this.currentBits += bitWidth;
    this.bitsWritten += bitWidth;
    if (this.currentBits >= CHUNK_BITS) {
      this.chunks.push({ value: this.current, bits: this.currentBits });
      this.current = 0n;
      this.currentBits = 0;
    }
  };

  /** All bits written, as one integer (the first bit written is the most significant) */
  getBigInt = (): bigint => {
    if (!this.chunks.length) return this.current;
    let parts = [...this.chunks, { value: this.current, bits: this.currentBits }];
    // join neighbours pairwise, so long streams do not shift one ever-growing integer
    while (parts.length > 1) {
      const joined: { value: bigint; bits: number }[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        const [a, b] = [parts[i], parts[i + 1]];
        joined.push(b ? { value: (a.value << BigInt(b.bits)) | b.value, bits: a.bits + b.bits } : a);
      }
      parts = joined;
    }
    return parts[0].value;
  };

  getBitLength = (): number => this.bitsWritten;

  /**
   * The stream as text: the fewest characters that hold all bits written, with the stream
   * left-aligned in them (zero padding at the end)
   */
  getFromBase = (base: BaseSpec = 'base64url'): string => {
    const alphabet = getCharsForBase(base);
    const chars = charsForBits(this.bitsWritten, alphabet.length);
    const padding = bitsForChars(chars, alphabet.length) - this.bitsWritten;
    return bigIntToBaseString(this.getBigInt() << BigInt(padding), alphabet, chars);
  };
}

/** Bits collected before a chunk is set aside: small enough that appending to it stays cheap */
const CHUNK_BITS = 1024;

/**
 * Helper class for reading the uInt numeric value of a field in the schema from the bigint representing the densed data
 */
export class BitReader {
  /** The payload's bits as a string of 0s and 1s: reading a field is a slice, not a shift of the whole payload */
  private readonly bits: string;
  private position: number;
  private readonly totalBits: number;
  private readonly charCount: number;
  private readonly baseChars: string;

  private constructor(bits: string, charCount: number, baseChars: string) {
    this.bits = bits;
    this.position = 0;
    this.totalBits = bits.length;
    this.charCount = charCount;
    this.baseChars = baseChars;
  }

  /** Read an unsigned integer of up to 53 bits (the safe-integer range of a JS number) */
  readUInt = (bitWidth: number): number => {
    if (bitWidth === 0) return 0;
    if (bitWidth > 53) throw new Error(`Cannot read ${bitWidth} bits into a number (at most 53)`);
    return parseInt(this.take(bitWidth), 2);
  };

  /** @throws DenseDecodeError when the payload ends before `bitWidth` more bits */
  readUBigInt = (bitWidth: number): bigint => {
    if (bitWidth === 0) return 0n;
    return BigInt('0b' + this.take(bitWidth));
  };

  private take = (bitWidth: number): string => {
    const left = this.getBitsLeft();
    if (bitWidth > left)
      throw new DenseDecodeError('', `unexpected end of input: ${bitWidth} more bits needed, ${left} left`);
    const slice = this.bits.slice(this.position, this.position + bitWidth);
    this.position += bitWidth;
    return slice;
  };

  getBitsLeft = (): number => this.totalBits - this.position;

  /**
   * Check that the payload ends where the encoder would have ended it: exactly as many characters as
   * the bits read need, and zero padding. Rejects trailing characters and non-canonical encodings, so
   * every payload decodes from exactly one string.
   * @throws DenseDecodeError
   */
  assertCanonicalEnd = (): void => {
    const bitsRead = this.position;
    const expectedChars = charsForBits(bitsRead, this.baseChars.length);
    if (this.charCount !== expectedChars)
      throw new DenseDecodeError(
        '',
        `expected ${expectedChars} characters for ${bitsRead} bits of data, got ${this.charCount}`
      );
    if (this.take(this.getBitsLeft()).includes('1')) throw new DenseDecodeError('', 'non-zero padding bits');
  };

  /** @throws DenseDecodeError for characters outside the alphabet or a value the characters cannot be */
  static getFromBase = (baseString: string, base: BaseSpec): BitReader => {
    const baseChars = getCharsForBase(base);
    const totalBits = bitsForChars(baseString.length, baseChars.length);
    const k = powerOfTwoExponent(baseChars.length);
    if (k !== undefined) return new BitReader(baseStringToBits(baseString, baseChars, k), baseString.length, baseChars);
    const value = baseStringToBigInt(baseString, baseChars);
    // alphabets whose size is not a power of two can spell values above the bit capacity; the
    // encoder never produces them
    if (value >> BigInt(totalBits) !== 0n)
      throw new DenseDecodeError('', `value exceeds the ${totalBits} bits ${baseString.length} characters hold`);
    return new BitReader(totalBits ? value.toString(2).padStart(totalBits, '0') : '', baseString.length, baseChars);
  };
}
