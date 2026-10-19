import { DenseSchema, DenseField, assertNeverDenseField } from '../schema-type';
import { constantFieldValueError, lengthError } from '../values';
import { variantNames, variantObject } from './variants';
import { ActivePresets, PRESETS_KEY, findTemplate, lookupNumeric, presetsErrors } from './definitions';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const pushLengthError = (
  length: number,
  minLength: number,
  maxLength: number,
  path: string,
  errors: ValidationError[]
) => {
  const message = lengthError(length, minLength, maxLength);
  if (message) errors.push({ path, message });
};

/**
 * Check data against a schema without encoding it. Uses the same rules as `densing`, which throws a
 * `DenseEncodeError` for the first value that would fail here.
 */
export const validate = (schema: DenseSchema, data: any): ValidationResult => {
  const errors: ValidationError[] = [];

  errors.push(...presetsErrors(schema, data[PRESETS_KEY]));
  // with invalid presets it is unknown which preset a `reference_numeric` value has to fit
  const ctx: Context = { errors, schema, presets: data[PRESETS_KEY], presetsKnown: errors.length === 0 };

  for (const field of schema.fields) {
    check(field, data[field.name], field.name, ctx);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate one value against a field, appending to `errors`
 * @param schema - the root schema; needed to follow `reference` and `reference_numeric` fields and the
 * variants of unions loaded from JSON (without it they are not checked)
 * @param presets - the active preset per definition (the data's `$presets`), default presets when not given
 */
export const validateField = (
  field: DenseField,
  value: any,
  path: string,
  errors: ValidationError[],
  schema?: DenseSchema,
  presets?: ActivePresets
): void => check(field, value, path, { errors, schema, presets, presetsKnown: true });

interface Context {
  errors: ValidationError[];
  schema?: DenseSchema;
  presets?: ActivePresets;
  /** false when `$presets` is invalid: `reference_numeric` values are then only checked to be numbers */
  presetsKnown: boolean;
}

const check = (field: DenseField, value: any, path: string, ctx: Context): void => {
  const { errors, schema } = ctx;
  const recurse = (f: DenseField, v: any, p: string) => check(f, v, p, ctx);

  // For optional fields, undefined/null is valid
  if (field.type === 'optional') {
    if (value === undefined || value === null) {
      return; // Optional fields can be undefined
    }
    // If present, validate the inner field
    recurse(field.field, value, path);
    return;
  }

  if (value === undefined) {
    errors.push({
      path,
      message: 'missing value'
    });
    return;
  }

  switch (field.type) {
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum': {
      const error = constantFieldValueError(field, value);
      if (error) errors.push({ path, message: error });
      return;
    }

    case 'reference_numeric': {
      if (!ctx.presetsKnown) {
        if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ path, message: 'expected number' });
        return;
      }
      if (!schema) return; // cannot resolve without the root schema
      const result = lookupNumeric(field, schema, ctx.presets);
      const error = 'error' in result ? result.error : constantFieldValueError(result.field, value);
      if (error) errors.push({ path, message: error });
      return;
    }

    case 'array':
      if (!Array.isArray(value)) {
        errors.push({ path, message: 'expected array' });
        return;
      }

      pushLengthError(value.length, field.minLength, field.maxLength, path, errors);

      value.forEach((item, i) => recurse(field.items, item, `${path}[${i}]`));
      return;

    case 'union': {
      if (typeof value !== 'object' || value === null) {
        errors.push({ path, message: 'expected object' });
        return;
      }

      const discName = field.discriminator;
      const discValue = value[discName];
      const names = variantNames(field);

      // Check if discriminator value is valid
      if (typeof discValue !== 'string' || !names.includes(discValue)) {
        errors.push({
          path: `${path}.${discName}`,
          message: `invalid discriminator "${discValue}", expected one of [${names.join(', ')}]`
        });
        return;
      }

      let variantFields: DenseField[];
      try {
        variantFields = variantObject(field, discValue, schema).fields;
      } catch (error) {
        if (!schema) return; // a bound union cannot resolve its variants without the root schema
        errors.push({ path: `${path}.${discName}`, message: error instanceof Error ? error.message : String(error) });
        return;
      }

      for (const f of variantFields) {
        recurse(f, value[f.name], `${path}.${f.name}`);
      }

      return;
    }

    case 'enum_array':
      if (!Array.isArray(value)) {
        errors.push({ path, message: 'expected an array' });
        return;
      }

      pushLengthError(value.length, field.minLength, field.maxLength, path, errors);

      // Check all elements are valid enum values
      value.forEach((v, i) => {
        const error = constantFieldValueError(field.enum, v);
        if (error) errors.push({ path: `${path}[${i}]`, message: error });
      });
      return;

    case 'object': {
      if (typeof value !== 'object' || value === null) {
        errors.push({ path, message: 'expected object' });
        return;
      }

      for (const f of field.fields) {
        recurse(f, value[f.name], `${path}.${f.name}`);
      }
      return;
    }

    case 'reference': {
      if (!schema) return; // cannot resolve without the root schema
      const template = findTemplate(schema, field.ref);
      if (!template) {
        errors.push({ path, message: `template ${field.ref} does not exist` });
        return;
      }
      recurse(template, value, path);
      return;
    }

    default:
      assertNeverDenseField(field);
  }
};
