// values.ts - which values a field accepts, and how a value maps to the unsigned integer that is stored.
// Shared by the encoder and by `validate()`, so the two cannot disagree about what is valid.
import { ConstantBitWidthField, FixedPointField, assertNeverDenseField } from './schema-type';

/**
 * How far, in steps of the field's precision, a fixed-point value may lie from the nearest step and
 * still count as aligned. Absorbs binary floating-point error (`0.1`, `100.3`) without accepting
 * values that are genuinely between steps (`3.14` at precision `0.1` is 0.4 steps off).
 */
export const PRECISION_ALIGNMENT_TOLERANCE = 1e-6;

/**
 * Error thrown by `densing` when the data does not match the schema.
 * `path` uses the same notation as `validate()` (`a.b`, `list[2]`).
 */
export class DenseEncodeError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'DenseEncodeError';
    this.path = path;
  }
}

/**
 * Widest `int` / `fixed` field: values are JS numbers, which hold integers exactly up to 2^53.
 */
export const MAX_FIELD_BITS = 53;

export const scaleForPrecision = (precision: number): number => Math.round(1 / precision);

/**
 * Whether `steps` lies on a step. `magnitude` is the size of the operands `steps` was computed from:
 * besides the fixed tolerance, a few ulps of it are allowed, which is the floating-point error of
 * `value * scale` for large step counts (e.g. `fixed(-180, 180, 1e-10)`).
 */
const isOnStep = (steps: number, magnitude: number = Math.abs(steps)): boolean =>
  Math.abs(steps - Math.round(steps)) <= PRECISION_ALIGNMENT_TOLERANCE + magnitude * 8 * Number.EPSILON;

/**
 * `min` in steps. It is an integer whenever `min` lies on the precision grid, which keeps the
 * arithmetic in the integer domain so that decoded values are the closest double to the decimal.
 */
const fixedMinSteps = (field: FixedPointField): number => {
  const steps = field.min * scaleForPrecision(field.precision);
  return isOnStep(steps) ? Math.round(steps) : steps;
};

/** Number of steps between `min` and `max`; the stored value is in `[0, fixedMaxStep]` */
export const fixedMaxStep = (min: number, max: number, precision: number): number =>
  Math.round((max - min) * scaleForPrecision(precision));

/** The (unrounded) offset of a value from `min` in steps, and whether it lies on a step */
const fixedSteps = (field: FixedPointField, value: number): { steps: number; aligned: boolean } => {
  const scaled = value * scaleForPrecision(field.precision);
  const minSteps = fixedMinSteps(field);
  const steps = scaled - minSteps;
  return { steps, aligned: isOnStep(steps, Math.abs(scaled) + Math.abs(minSteps)) };
};

export const uIntForFixed = (field: FixedPointField, value: number): number =>
  Math.round(fixedSteps(field, value).steps);

/** Inverse of `uIntForFixed`: divides exactly once, so `0.1` decodes as `0.1` */
export const fixedFromUInt = (field: FixedPointField, uInt: number): number =>
  (uInt + fixedMinSteps(field)) / scaleForPrecision(field.precision);

const outOfRange = (value: unknown, min: number, max: number) => `value ${value} out of range [${min}, ${max}]`;

/**
 * Why `value` is not valid for a constant-width field, or `undefined` when it is.
 * The messages are the ones `validate()` reports.
 */
export const constantFieldValueError = (field: ConstantBitWidthField, value: unknown): string | undefined => {
  switch (field.type) {
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'expected boolean';

    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'expected integer';
      return value < field.min || value > field.max ? outOfRange(value, field.min, field.max) : undefined;

    case 'fixed': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected number';
      const { steps, aligned } = fixedSteps(field, value);
      const step = Math.round(steps);
      if (step < 0 || step > fixedMaxStep(field.min, field.max, field.precision))
        return outOfRange(value, field.min, field.max);
      if (!aligned)
        return `value ${value} does not align with precision ${field.precision}`;
      return undefined;
    }

    case 'enum':
      if (typeof value !== 'string') return 'expected string for enum value';
      return field.options.includes(value)
        ? undefined
        : `invalid enum value ${value}, expected one of [${field.options.join(', ')}]`;

    default:
      return assertNeverDenseField(field);
  }
};

/** Why `length` is not valid for an `array` / `enum_array`, or `undefined` when it is */
export const lengthError = (length: number, minLength: number, maxLength: number): string | undefined => {
  if (length < minLength) return `array length ${length} is less than minLength ${minLength}`;
  if (length > maxLength) return `array length ${length} exceeds maxLength ${maxLength}`;
  return undefined;
};
