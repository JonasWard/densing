import { expect, test } from 'bun:test';
import { schema, bool, int, fixed, enumeration, optional, object } from '../schema/builder';
import { densing, undensing } from '../densing';
import { getDefaultData } from '../schema/default-data';

test('optional field - present value', () => {
  const OptionalSchema = schema(int('required', 0, 100), optional('optional', int('value', 0, 255), undefined));

  const dataWithOptional = { required: 50, optional: 100 };
  const encoded = densing(OptionalSchema, dataWithOptional);
  const decoded = undensing(OptionalSchema, encoded);

  console.log('Optional present - data:', dataWithOptional);
  console.log('Optional present - encoded:', encoded);
  console.log('Optional present - decoded:', decoded);

  expect(decoded).toEqual(dataWithOptional);
});

test('optional field - absent value', () => {
  const OptionalSchema = schema(int('required', 0, 100), optional('optional', int('value', 0, 255), undefined));

  const dataWithoutOptional = { required: 50, optional: null };
  const encoded = densing(OptionalSchema, dataWithoutOptional);
  const decoded = undensing(OptionalSchema, encoded);

  console.log('Optional absent - data:', dataWithoutOptional);
  console.log('Optional absent - encoded:', encoded);
  console.log('Optional absent - decoded:', decoded);

  expect(decoded.required).toBe(50);
  expect(decoded.optional).toBeNull();
});

test('optional field - with default value', () => {
  const OptionalSchema = schema(int('required', 0, 100), optional('optional', int('value', 0, 255), 42));

  const dataWithoutOptional = { required: 50, optional: null };
  const encoded = densing(OptionalSchema, dataWithoutOptional);
  const decoded = undensing(OptionalSchema, encoded);

  console.log('Optional with default - data:', dataWithoutOptional);
  console.log('Optional with default - encoded:', encoded);
  console.log('Optional with default - decoded:', decoded);

  expect(decoded.required).toBe(50);
  expect(decoded.optional).toBe(42);
});

test('object field - simple object', () => {
  const ObjectSchema = schema(int('id', 0, 1000), object('point', int('x', -100, 100), int('y', -100, 100)));

  const data = {
    id: 123,
    point: { x: 10, y: -20 }
  };

  const encoded = densing(ObjectSchema, data);
  const decoded = undensing(ObjectSchema, encoded);

  console.log('Object - data:', data);
  console.log('Object - encoded:', encoded);
  console.log('Object - decoded:', decoded);

  expect(decoded).toEqual(data);
});

test('object field - nested objects', () => {
  const NestedObjectSchema = schema(
    object('outer', int('value', 0, 100), object('inner', bool('enabled'), fixed('temperature', -40, 125, 0.1)))
  );

  const data = {
    outer: {
      value: 42,
      inner: {
        enabled: true,
        temperature: 25.5
      }
    }
  };

  const encoded = densing(NestedObjectSchema, data);
  const decoded = undensing(NestedObjectSchema, encoded);

  console.log('Nested object - data:', data);
  console.log('Nested object - encoded:', encoded);
  console.log('Nested object - decoded:', decoded);

  expect(decoded).toEqual(data);
});

test('optional object field', () => {
  const OptionalObjectSchema = schema(
    int('id', 0, 1000),
    optional('metadata', object('meta', int('version', 0, 10), bool('active')), undefined)
  );

  const dataWithMetadata = {
    id: 100,
    metadata: { version: 2, active: true }
  };

  const dataWithoutMetadata = {
    id: 100,
    metadata: null
  };

  const encoded1 = densing(OptionalObjectSchema, dataWithMetadata);
  const decoded1 = undensing(OptionalObjectSchema, encoded1);

  const encoded2 = densing(OptionalObjectSchema, dataWithoutMetadata);
  const decoded2 = undensing(OptionalObjectSchema, encoded2);

  console.log('Optional object present - data:', dataWithMetadata);
  console.log('Optional object present - encoded:', encoded1);
  console.log('Optional object present - decoded:', decoded1);

  console.log('Optional object absent - data:', dataWithoutMetadata);
  console.log('Optional object absent - encoded:', encoded2);
  console.log('Optional object absent - decoded:', decoded2);

  expect(decoded1).toEqual(dataWithMetadata);
  expect(decoded2.id).toBe(100);
  expect(decoded2.metadata).toBeNull();
});

test('getDefaultData with optional and object fields', () => {
  const ComplexSchema = schema(
    int('id', 0, 100),
    optional('optionalValue', int('value', 0, 255), 50),
    object('settings', bool('enabled'), int('count', 0, 10))
  );

  const defaultData = getDefaultData(ComplexSchema);

  console.log('Default data with optional and object:', defaultData);

  expect(defaultData).toHaveProperty('id');
  expect(defaultData).toHaveProperty('optionalValue');
  expect(defaultData.optionalValue).toBe(50); // default value
  expect(defaultData).toHaveProperty('settings');
  expect(defaultData.settings).toHaveProperty('enabled');
  expect(defaultData.settings).toHaveProperty('count');

  // Should be able to encode/decode default data
  const encoded = densing(ComplexSchema, defaultData);
  const decoded = undensing(ComplexSchema, encoded);
  expect(decoded).toEqual(defaultData);
});

test('complex combination - array of objects with optional fields', () => {
  const { array } = require('../schema/builder');

  const ComplexSchema = schema(
    array('items', 0, 5, object('item', int('id', 0, 100), optional('name', int('nameId', 0, 1000), undefined)))
  );

  const data = {
    items: [
      { id: 1, name: 100 },
      { id: 2, name: null },
      { id: 3, name: 500 }
    ]
  };

  const encoded = densing(ComplexSchema, data);
  const decoded = undensing(ComplexSchema, encoded);

  console.log('Array of objects with optional - data:', data);
  console.log('Array of objects with optional - encoded:', encoded);
  console.log('Array of objects with optional - decoded:', decoded);

  expect(decoded.items.length).toBe(3);
  expect(decoded.items[0]).toEqual({ id: 1, name: 100 });
  expect(decoded.items[1].id).toBe(2);
  expect(decoded.items[1].name).toBeNull();
  expect(decoded.items[2]).toEqual({ id: 3, name: 500 });
});
