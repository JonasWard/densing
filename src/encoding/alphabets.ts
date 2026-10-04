// alphabets.ts - the character sets payloads are written in

/**
 * In Densing defined base types
 * You can provide your own as well
 */
export const BaseTypes = ['base64url', 'baseQRCode45UrlSafe', 'binary'] as const;

/**
 * Predefined base types
 */
export type BaseType = (typeof BaseTypes)[number];

/** A custom alphabet: `alphabet[d]` is digit `d`. Never confused with a `BaseType` name. */
export interface CustomBase {
  readonly alphabet: string;
}

/**
 * The base a payload is written in: a `BaseType` name or a `CustomBase`.
 * A plain string that is not a `BaseType` name is also read as a custom alphabet, for compatibility;
 * prefer `customBase(chars)`, since a plain string equal to a name (e.g. `"binary"`) is the named base.
 */
export type BaseSpec = BaseType | CustomBase | string;

export const base64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // normal base64 with + and / substituted for - and _ to make it url parameter safe.
export const baseQRCode45UrlSafe = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.'; // only characters that are url parameter safe are used, that is only 38 of the 45 characters of the QRCode Base45 definition. However, this is still more efficient than using base64 for qr codes.
export const binary = '01'; // binary base, only 0 and 1 are used

const baseCharTypes: Record<BaseType, string> = {
  base64url,
  baseQRCode45UrlSafe,
  binary
};

/**
 * Throw when `alphabet` cannot be decoded unambiguously: it needs at least two characters, no
 * duplicates, and every character must be a single UTF-16 code unit (no emoji or other astral
 * characters, which the codec would split in two).
 */
export const assertValidAlphabet = (alphabet: string): void => {
  if (alphabet.length < 2) throw new Error(`alphabet "${alphabet}" needs at least 2 characters`);
  for (let i = 0; i < alphabet.length; i++) {
    const code = alphabet.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff)
      throw new Error(`alphabet "${alphabet}": characters must be single UTF-16 code units`);
    if (alphabet.indexOf(alphabet[i]) !== i)
      throw new Error(`alphabet "${alphabet}": duplicate character "${alphabet[i]}"`);
  }
};

/** A validated custom alphabet, e.g. `densing(schema, data, customBase('0123456789ABCDEF'))` */
export const customBase = (alphabet: string): CustomBase => {
  assertValidAlphabet(alphabet);
  return { alphabet };
};

/** The characters of a base; custom alphabets are validated */
export const getCharsForBase = (base: BaseSpec): string => {
  if (typeof base === 'string' && BaseTypes.includes(base as BaseType)) return baseCharTypes[base as BaseType];
  const chars = typeof base === 'object' ? base.alphabet : base;
  assertValidAlphabet(chars);
  return chars;
};
