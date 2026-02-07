/**
 * In Densing defined base types
 * You can provide your own as well
 */
export const BaseTypes = ['base64url', 'baseQRCode45UrlSafe'] as const;

/**
 * Predefined base types
 */
export type BaseType = (typeof BaseTypes)[number];

export const base64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // normal base64 with + and / substituted for - and _ to make it url parameter safe.
export const baseQRCode45UrlSafe = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.'; // only characters that are url parameter safe are used, that is only 38 of the 45 characters of the QRCode Base45 definition. However, this is still more efficient than using base64 for qr codes.

const baseCharTypes: Record<BaseType, string> = {
  base64url,
  baseQRCode45UrlSafe
};

const getMinRequiredCharsForBase = (bitWidth: number, baseChars: string): number =>
  Math.ceil(bitWidth / Math.log2(baseChars.length));

const getMaxBitWidthForBase = (baseString: string, baseChars: string): number =>
  Math.floor(baseString.length * Math.log2(baseChars.length));

const getBaseStringFromBigInt = (bigInt: bigint, baseChars: string, bitWidth?: number): string => {
  const minChars = bitWidth ? getMinRequiredCharsForBase(bitWidth, baseChars) : 0;

  const base = BigInt(baseChars.length);
  const acc = [];

  while (bigInt > 0) acc.push(Number(bigInt % base)), (bigInt = bigInt / base);
  while (minChars > 0 && acc.length < minChars) acc.push(0);

  return acc
    .reverse()
    .map((n) => base64url.charAt(n))
    .join('');
};

const getCharsForBase = (base: BaseType | string): string =>
  BaseTypes.includes(base as BaseType) ? baseCharTypes[base as BaseType] : base;

const getBigIntFromBaseString = (baseString: string, baseChars: string): bigint => {
  const base = BigInt(baseChars.length);
  return baseString
    .split('')
    .map((c) => baseChars.indexOf(c))
    .reduce((acc, n) => acc * base + BigInt(n), 0n);
};

export const getBigIntFromBase64 = (base64: string): bigint => getBigIntFromBaseString(base64, base64url);
export const getBase64FromBigInt = (bigInt: bigint, bitWidth?: number): string =>
  getBaseStringFromBigInt(bigInt, base64url, bitWidth);

export const getbaseQRCode45UrlSafeFromBigInt = (bigInt: bigint, bitWidth?: number): string =>
  getBaseStringFromBigInt(bigInt, baseQRCode45UrlSafe, bitWidth);
export const getBigIntFrombaseQRCode45UrlSafe = (baseQRCode45UrlSafe: string): bigint =>
  getBigIntFromBaseString(baseQRCode45UrlSafe, baseQRCode45UrlSafe);

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

  writeUInt = (value: number | bigint, bitWidth: number): void => {
    if (bitWidth <= 0) return;

    const bw = BigInt(bitWidth);
    const v = BigInt(value);

    // mask the value of the bit width
    const masked = v & ((1n << bw) - 1n);

    this.buffer = (this.buffer << bw) | masked;
    this.bitsWritten += bitWidth;
  };

  getBigInt = (): bigint => this.buffer;

  getBitLength = (): number => Number(this.bitsWritten);

  getFromBase = (base: BaseType | string = 'base64url'): string =>
    getBaseStringFromBigInt(this.buffer, getCharsForBase(base), this.bitsWritten);
}

export class BitReader {
  private buffer: bigint;
  private bitsLeft: number;

  private constructor(bigInt: bigint, totalBits: number) {
    this.buffer = bigInt;
    this.bitsLeft = totalBits;
  }

  readUInt = (bitWidth: number): number => {
    if (bitWidth === 0) return 0;
    if (bitWidth > 32) throw new Error('Cannot read more than 32 bits into a UInt at a time');
    return Number(this.readUBigInt(bitWidth));
  };

  readUBigInt = (bitWidth: number): bigint => {
    if (bitWidth === 0) return 0n;
    if (bitWidth > this.bitsLeft)
      throw new Error(`Not enough bits left (${this.bitsLeft}) when trying to get ${bitWidth}`);

    // applying the bitWidth delta to the bitsLeft
    this.bitsLeft -= bitWidth;

    const shift = BigInt(this.bitsLeft);
    const bw = BigInt(bitWidth);
    const mask = (1n << bw) - 1n;

    const value = (this.buffer >> shift) & mask;

    return value;
  };

  static getFromBase = (baseString: string, base: BaseType | string): BitReader =>
    new BitReader(
      getBigIntFromBaseString(baseString, getCharsForBase(base)),
      getMaxBitWidthForBase(baseString, getCharsForBase(base))
    );
}
