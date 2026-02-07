import { expect, test } from 'bun:test';
import { schema, bool, int, fixed, enumeration, union, array, enumArray } from '../schema/builder';
import { getDefaultData } from '../schema/default-data';
import { undensing, densing } from '../densing';

test('getDefaultData for simple types', () => {
  const BoolSchema = schema(bool('enabled'));
  const IntSchema = schema(int('value', 0, 1023));
  const FixedSchema = schema(fixed('value', -40, 125, 0.1));
  const EnumSchema = schema(enumeration('value', ['R', 'G', 'B']));

  const boolDefault = getDefaultData(BoolSchema);
  const intDefault = getDefaultData(IntSchema);
  const fixedDefault = getDefaultData(FixedSchema);
  const enumDefault = getDefaultData(EnumSchema);

  console.log('Bool default:', boolDefault);
  console.log('Int default:', intDefault);
  console.log('Fixed default:', fixedDefault);
  console.log('Enum default:', enumDefault);

  expect(boolDefault).toHaveProperty('enabled');
  expect(typeof boolDefault.enabled).toBe('boolean');
  expect(intDefault).toHaveProperty('value');
  expect(typeof intDefault.value).toBe('number');
  expect(fixedDefault).toHaveProperty('value');
  expect(typeof fixedDefault.value).toBe('number');
  expect(enumDefault).toHaveProperty('value');
  expect(typeof enumDefault.value).toBe('string');
  expect(enumDefault.value).toBe('R'); // First option by default
});

test('getDefaultData for array types', () => {
  const ArraySchema = schema(array('items', 0, 16, int('value', 0, 1023)));
  const arrayDefault = getDefaultData(ArraySchema);

  console.log('Array default:', arrayDefault);

  expect(arrayDefault).toHaveProperty('items');
  expect(Array.isArray(arrayDefault.items)).toBe(true);
  expect(arrayDefault.items.length).toBe(0); // minLength is 0
});

test('getDefaultData for enum array types', () => {
  const EnumArraySchema = schema(enumArray('colors', enumeration('color', ['R', 'G', 'B']), 0, 511));
  const enumArrayDefault = getDefaultData(EnumArraySchema);

  console.log('EnumArray default:', enumArrayDefault);

  expect(enumArrayDefault).toHaveProperty('colors');
  expect(Array.isArray(enumArrayDefault.colors)).toBe(true);
});

test('getDefaultData for union types', () => {
  const UnionSchema = schema(
    union('action', enumeration('type', ['start', 'setSpeed']), {
      start: [int('delay', 0, 60)],
      setSpeed: [int('rpm', 0, 10000)]
    })
  );
  const unionDefault = getDefaultData(UnionSchema);

  console.log('Union default:', unionDefault);

  expect(unionDefault).toHaveProperty('action');
  expect(unionDefault.action).toHaveProperty('type');
  expect(['start', 'setSpeed']).toContain(unionDefault.action.type);

  // Should have the fields for the default variant
  if (unionDefault.action.type === 'start') {
    expect(unionDefault.action).toHaveProperty('delay');
  } else {
    expect(unionDefault.action).toHaveProperty('rpm');
  }
});

test('getDefaultData can be encoded and decoded', () => {
  const ComplexSchema = schema(
    bool('enabled'),
    int('count', 0, 100),
    fixed('temperature', -40, 125, 0.1),
    enumeration('color', ['R', 'G', 'B']),
    array('items', 0, 10, int('value', 0, 255))
  );

  const defaultData = getDefaultData(ComplexSchema);
  console.log('Complex default data:', defaultData);

  // Should be able to encode and decode the default data
  const encoded = undensing(ComplexSchema, defaultData);
  const decoded = densing(ComplexSchema, encoded);

  console.log('Encoded:', encoded);
  console.log('Decoded:', decoded);

  expect(decoded).toEqual(defaultData);
});
