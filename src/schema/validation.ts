import { DenseSchema, DenseField } from '../schema-type';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validate(schema: DenseSchema, data: any): ValidationResult {
  const errors: ValidationError[] = [];

  for (const field of schema.fields) {
    validateField(field, data[field.name], field.name, errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateField(field: DenseField, value: any, path: string, errors: ValidationError[]) {
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
      if (typeof value !== 'boolean') {
        errors.push({ path, message: 'expected boolean' });
      }
      return;

    case 'int':
      if (!Number.isInteger(value)) {
        errors.push({ path, message: 'expected integer' });
        return;
      }
      if (value < field.min || value > field.max) {
        errors.push({
          path,
          message: `value ${value} out of range [${field.min}, ${field.max}]`
        });
      }
      return;

    case 'fixed': {
      if (typeof value !== 'number') {
        errors.push({ path, message: 'expected number' });
        return;
      }
      const scale = 1 / field.precision;
      const scaled = (value - field.min) * scale;

      if (value < field.min || value > field.max) {
        errors.push({
          path,
          message: `value ${value} out of range [${field.min}, ${field.max}]`
        });
      } else if (!Number.isInteger(Math.round(scaled))) {
        errors.push({
          path,
          message: `value ${value} does not align with precision ${field.precision}`
        });
      }
      return;
    }

    case 'enum':
      if (typeof value !== 'string') {
        errors.push({ path, message: 'expected string for enum value' });
        return;
      }

      if (!field.options.includes(value)) {
        const optionsStr = field.options.join(', ');
        errors.push({
          path,
          message: `invalid enum value ${value}, expected one of [${optionsStr}]`
        });
      }
      return;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push({ path, message: 'expected array' });
        return;
      }

      if (value.length < field.minLength) {
        errors.push({
          path,
          message: `array length ${value.length} is less than minLength ${field.minLength}`
        });
      }

      if (value.length > field.maxLength) {
        errors.push({
          path,
          message: `array length ${value.length} exceeds maxLength ${field.maxLength}`
        });
      }

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

      // Check minimum length
      if (value.length < field.minLength) {
        errors.push({
          path,
          message: `array length ${value.length} is less than minLength ${field.minLength}`
        });
      }

      // Check maximum length
      if (value.length > field.maxLength) {
        errors.push({
          path,
          message: `array length ${value.length} exceeds maxLength ${field.maxLength}`
        });
      }

      // Check all elements are valid enum values
      value.forEach((v, i) => {
        if (typeof v !== 'string' || !field.enum.options.includes(v)) {
          const optionsStr = field.enum.options.join(', ');
          errors.push({
            path: `${path}[${i}]`,
            message: `invalid enum value ${v}, expected one of [${optionsStr}]`
          });
        }
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
  }
}
