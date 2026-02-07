import { expect, test } from 'bun:test';
import { schema, bool, int, fixed, enumeration, optional, object, array, enumArray, union } from '../schema/builder';
import { validate } from '../schema/validation';

test('validation - simple types', () => {
  const TestSchema = schema(
    bool('enabled'),
    int('count', 0, 100),
    fixed('temperature', -40, 125, 0.1),
    enumeration('color', ['R', 'G', 'B'])
  );

  // Valid data
  const validData = {
    enabled: true,
    count: 50,
    temperature: 25.5,
    color: 'G'
  };
  const validResult = validate(TestSchema, validData);
  console.log('Valid simple types:', validResult);
  expect(validResult.valid).toBe(true);
  expect(validResult.errors).toHaveLength(0);

  // Invalid bool
  const invalidBool = { ...validData, enabled: 'yes' };
  const invalidBoolResult = validate(TestSchema, invalidBool);
  console.log('Invalid bool:', invalidBoolResult);
  expect(invalidBoolResult.valid).toBe(false);
  expect(invalidBoolResult.errors.some((e) => e.path === 'enabled')).toBe(true);

  // Invalid int (out of range)
  const invalidInt = { ...validData, count: 150 };
  const invalidIntResult = validate(TestSchema, invalidInt);
  console.log('Invalid int:', invalidIntResult);
  expect(invalidIntResult.valid).toBe(false);
  expect(invalidIntResult.errors.some((e) => e.path === 'count')).toBe(true);

  // Invalid enum
  const invalidEnum = { ...validData, color: 'InvalidColor' };
  const invalidEnumResult = validate(TestSchema, invalidEnum);
  console.log('Invalid enum:', invalidEnumResult);
  expect(invalidEnumResult.valid).toBe(false);
  expect(invalidEnumResult.errors.some(e => e.path === 'color')).toBe(true);
});

test('validation - optional fields', () => {
  const TestSchema = schema(
    int('required', 0, 100),
    optional('optional', int('value', 0, 255), undefined)
  );

  // Valid with optional present
  const validWithOptional = { required: 50, optional: 100 };
  const validWithOptionalResult = validate(TestSchema, validWithOptional);
  console.log('Valid with optional:', validWithOptionalResult);
  expect(validWithOptionalResult.valid).toBe(true);

  // Valid with optional absent (null)
  const validWithoutOptional = { required: 50, optional: null };
  const validWithoutOptionalResult = validate(TestSchema, validWithoutOptional);
  console.log('Valid without optional:', validWithoutOptionalResult);
  expect(validWithoutOptionalResult.valid).toBe(true);

  // Valid with optional absent (undefined)
  const validWithUndefined = { required: 50, optional: undefined };
  const validWithUndefinedResult = validate(TestSchema, validWithUndefined);
  console.log('Valid with undefined:', validWithUndefinedResult);
  expect(validWithUndefinedResult.valid).toBe(true);

  // Invalid optional value
  const invalidOptional = { required: 50, optional: 300 };
  const invalidOptionalResult = validate(TestSchema, invalidOptional);
  console.log('Invalid optional:', invalidOptionalResult);
  expect(invalidOptionalResult.valid).toBe(false);
});

test('validation - object fields', () => {
  const TestSchema = schema(
    int('id', 0, 1000),
    object('point',
      int('x', -100, 100),
      int('y', -100, 100)
    )
  );

  // Valid object
  const validData = {
    id: 123,
    point: { x: 10, y: -20 }
  };
  const validResult = validate(TestSchema, validData);
  console.log('Valid object:', validResult);
  expect(validResult.valid).toBe(true);

  // Invalid object (not an object)
  const invalidNotObject = { id: 123, point: 'not an object' };
  const invalidNotObjectResult = validate(TestSchema, invalidNotObject);
  console.log('Invalid not object:', invalidNotObjectResult);
  expect(invalidNotObjectResult.valid).toBe(false);

  // Invalid object field value
  const invalidFieldValue = { id: 123, point: { x: 200, y: 10 } };
  const invalidFieldValueResult = validate(TestSchema, invalidFieldValue);
  console.log('Invalid object field:', invalidFieldValueResult);
  expect(invalidFieldValueResult.valid).toBe(false);
  expect(invalidFieldValueResult.errors.some(e => e.path === 'point.x')).toBe(true);
});

test('validation - array fields', () => {
  const TestSchema = schema(
    array('items', 1, 5, int('value', 0, 100))
  );

  // Valid array
  const validData = { items: [10, 20, 30] };
  const validResult = validate(TestSchema, validData);
  console.log('Valid array:', validResult);
  expect(validResult.valid).toBe(true);

  // Array too short
  const tooShort = { items: [] };
  const tooShortResult = validate(TestSchema, tooShort);
  console.log('Array too short:', tooShortResult);
  expect(tooShortResult.valid).toBe(false);

  // Array too long
  const tooLong = { items: [1, 2, 3, 4, 5, 6] };
  const tooLongResult = validate(TestSchema, tooLong);
  console.log('Array too long:', tooLongResult);
  expect(tooLongResult.valid).toBe(false);

  // Invalid array element
  const invalidElement = { items: [10, 200, 30] };
  const invalidElementResult = validate(TestSchema, invalidElement);
  console.log('Invalid array element:', invalidElementResult);
  expect(invalidElementResult.valid).toBe(false);
  expect(invalidElementResult.errors.some(e => e.path === 'items[1]')).toBe(true);
});

test('validation - enum array fields', () => {
  const TestSchema = schema(
    enumArray('colors', enumeration('color', ['R', 'G', 'B']), 0, 10)
  );

  // Valid enum array
  const validData = { colors: ['R', 'G', 'B', 'G', 'R'] };
  const validResult = validate(TestSchema, validData);
  console.log('Valid enum array:', validResult);
  expect(validResult.valid).toBe(true);

  // Invalid enum value
  const invalidEnum = { colors: ['R', 'InvalidColor', 'B'] };
  const invalidEnumResult = validate(TestSchema, invalidEnum);
  console.log('Invalid enum in array:', invalidEnumResult);
  expect(invalidEnumResult.valid).toBe(false);
  expect(invalidEnumResult.errors.some((e) => e.path === 'colors[1]')).toBe(true);

  // Array too long
  const tooLong = { colors: ['R', 'G', 'B', 'R', 'G', 'B', 'R', 'G', 'B', 'R', 'G'] };
  const tooLongResult = validate(TestSchema, tooLong);
  console.log('Enum array too long:', tooLongResult);
  expect(tooLongResult.valid).toBe(false);
});

test('validation - union fields', () => {
  const TestSchema = schema(
    union('action', enumeration('type', ['start', 'stop']), {
      start: [int('delay', 0, 60)],
      stop: [bool('immediate')]
    })
  );

  // Valid union (start)
  const validStart = { action: { type: 'start', delay: 10 } };
  const validStartResult = validate(TestSchema, validStart);
  console.log('Valid union (start):', validStartResult);
  expect(validStartResult.valid).toBe(true);

  // Valid union (stop)
  const validStop = { action: { type: 'stop', immediate: true } };
  const validStopResult = validate(TestSchema, validStop);
  console.log('Valid union (stop):', validStopResult);
  expect(validStopResult.valid).toBe(true);

  // Invalid discriminator
  const invalidDisc = { action: { type: 'invalid', delay: 10 } };
  const invalidDiscResult = validate(TestSchema, invalidDisc);
  console.log('Invalid discriminator:', invalidDiscResult);
  expect(invalidDiscResult.valid).toBe(false);

  // Invalid field in variant
  const invalidField = { action: { type: 'start', delay: 100 } };
  const invalidFieldResult = validate(TestSchema, invalidField);
  console.log('Invalid union field:', invalidFieldResult);
  expect(invalidFieldResult.valid).toBe(false);
  expect(invalidFieldResult.errors.some(e => e.path === 'action.delay')).toBe(true);
});

test('validation - missing required fields', () => {
  const TestSchema = schema(
    int('required', 0, 100),
    bool('enabled')
  );

  // Missing field
  const missingField = { required: 50 };
  const missingFieldResult = validate(TestSchema, missingField);
  console.log('Missing field:', missingFieldResult);
  expect(missingFieldResult.valid).toBe(false);
  expect(missingFieldResult.errors.some(e => e.path === 'enabled')).toBe(true);
});

test('validation - complex nested structure', () => {
  const TestSchema = schema(
    int('id', 0, 1000),
    object('config',
      bool('enabled'),
      optional('settings', object('s',
        int('value', 0, 100)
      ), undefined)
    ),
    array('items', 0, 5,
      object('item',
        int('id', 0, 100),
        optional('name', int('nameId', 0, 1000), undefined)
      )
    )
  );

  // Valid complex data
  const validData = {
    id: 123,
    config: {
      enabled: true,
      settings: { value: 50 }
    },
    items: [
      { id: 1, name: 100 },
      { id: 2, name: null }
    ]
  };
  const validResult = validate(TestSchema, validData);
  console.log('Valid complex:', validResult);
  expect(validResult.valid).toBe(true);

  // Invalid nested value
  const invalidNested = {
    id: 123,
    config: {
      enabled: true,
      settings: { value: 150 }
    },
    items: []
  };
  const invalidNestedResult = validate(TestSchema, invalidNested);
  console.log('Invalid nested:', invalidNestedResult);
  expect(invalidNestedResult.valid).toBe(false);
  expect(invalidNestedResult.errors.some(e => e.path === 'config.settings.value')).toBe(true);
});
