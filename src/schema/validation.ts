import { DenseSchema, DenseField, assertNeverDenseField } from '../schema-type';
import { constantFieldValueError, lengthError } from '../values';

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

  for (const field of schema.fields) {
    validateField(field, data[field.name], field.name, errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

export const validateField = (field: DenseField, value: any, path: string, errors: ValidationError[]): any => {
  // For optional fields, undefined/null is valid
  if (field.type === 'optional') {
    if (value === undefined || value === null) {
      return; // Optional fields can be undefined
    }
    // If present, validate the inner field
    validateField(field.field, value, path, errors);
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

    case 'array':
      if (!Array.isArray(value)) {
        errors.push({ path, message: 'expected array' });
        return;
      }

      pushLengthError(value.length, field.minLength, field.maxLength, path, errors);

      value.forEach((item, i) => validateField(field.items, item, `${path}[${i}]`, errors));
      return;

    case 'union': {
      if (typeof value !== 'object' || value === null) {
        errors.push({ path, message: 'expected object' });
        return;
      }

      const discName = field.discriminator.name;
      const discValue = value[discName];

      // Check if discriminator value is valid
      if (typeof discValue !== 'string' || !field.discriminator.options.includes(discValue)) {
        errors.push({
          path: `${path}.${discName}`,
          message: `invalid discriminator "${discValue}", expected one of [${field.discriminator.options.join(', ')}]`
        });
        return;
      }

      const variantFields = field.variants[discValue];
      if (!variantFields) {
        errors.push({
          path: `${path}.${discName}`,
          message: `no variant definition for discriminator "${discValue}"`
        });
        return;
      }

      for (const f of variantFields) {
        validateField(f, value[f.name], `${path}.${f.name}`, errors);
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
        validateField(f, value[f.name], `${path}.${f.name}`, errors);
      }
      return;
    }

    case 'pointer': {
      // For pointers, we need the schema context to resolve the target
      // This would require passing schema through validateField
      // For now, we just validate that the value exists
      // The actual type validation will happen during encoding
      return;
    }

    default:
      assertNeverDenseField(field);
  }
};
