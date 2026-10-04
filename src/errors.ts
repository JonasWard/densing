// errors.ts - errors thrown by the codec. `path` uses the notation of `validate()` (`a.b`, `list[2]`).

/** Thrown by `densing` when the data does not match the schema */
export class DenseEncodeError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'DenseEncodeError';
    this.path = path;
  }
}

/**
 * Thrown by `undensing` when the string is not a payload the encoder could have produced for this
 * schema: a character outside the alphabet, a value outside its field's range, a length or index
 * the schema does not allow, too few or too many characters, or non-zero padding.
 */
export class DenseDecodeError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'DenseDecodeError';
    this.path = path;
  }
}
