import { expect, test } from 'bun:test';
import { schema, enumArray, enumeration } from '../schema/builder';
import { densing, undensing } from '../densing';

// Binary encoding tests - verify exact bit strings
const binaryEncodingTests: [string[], number, number, number, string, string][] = [
  // [values, enumSize, minLength, maxLength, expectedBitString, description]
  [[], 2, 0, 4, '000', 'empty array (3 bits for length 0-4)'],
  [['A'], 2, 0, 4, '0010', '1 element A from 2 options (3 bits length=1 + 1 bit content=0)'],
  [['B'], 2, 0, 4, '0011', '1 element B from 2 options (3 bits length=1 + 1 bit content=1)'],
  [['A', 'B'], 2, 0, 4, '01001', '2 elements A,B (3 bits length=2 + 2 bits content=01)'],
  [['B', 'A'], 2, 0, 4, '01010', '2 elements B,A (3 bits length=2 + 2 bits content=10)'],
  [['A', 'A'], 2, 0, 4, '01000', '2 elements A,A (3 bits length=2 + 2 bits content=00)'],
  [['B', 'B'], 2, 0, 4, '01011', '2 elements B,B (3 bits length=2 + 2 bits content=11)'],
  [['A', 'B', 'A'], 2, 0, 4, '011010', '3 elements A,B,A (3 bits length=3 + 3 bits content=010)'],
  [['A'], 4, 0, 4, '00100', '1 element A from 4 options (3 bits length=1 + 2 bits content=00)'],
  [['B'], 4, 0, 4, '00101', '1 element B from 4 options (3 bits length=1 + 2 bits content=01)'],
  [['A', 'B', 'C'], 4, 0, 4, '011000110', '3 elements A,B,C from 4 options (3 bits length=3 + 6 bits content)'],
  [['A'], 8, 0, 8, '0001000', '1 element A from 8 options (4 bits length=1 + 3 bits content=000)'],
  [['A', 'B'], 8, 0, 8, '0010000001', '2 elements A,B from 8 options (4 bits length=2 + 6 bits content)']
];

binaryEncodingTests.forEach(([values, enumSize, minLength, maxLength, expectedBitString, description]) => {
  test(`binary enum_array: ${description}`, () => {
    const options = Array.from({ length: enumSize }, (_, i) => String.fromCharCode(65 + i)); // ['A', 'B', ...]
    const enumDef = enumeration('item', options);
    const EnumArraySchema = schema(enumArray('values', enumDef, minLength, maxLength));

    const data = { values };
    const encoded = densing(EnumArraySchema, data, 'binary');
    expect(encoded).toBe(expectedBitString);

    const decoded = undensing(EnumArraySchema, encoded, 'binary');
    expect(decoded.values).toEqual(values);
  });
});

// Original test cases from factory API - verify exact bit strings
/**
 * Format: [enumIndices, maxEnumValue, minLength, maxLength, expectedBitString]
 * enumIndices - array of enum indices (0-based)
 * maxEnumValue - maximum enum value (creates enum with 0 to maxEnumValue)
 * minLength - minimum array length
 * maxLength - maximum array length
 * expectedBitString - expected binary encoding
 */
const originalFactoryTests: [number[], number, number, number, string][] = [
  [[0], 1, 1, 2, '00'],
  [[0, 1, 2, 2, 3, 4, 5, 6, 7, 7, 8], 8, 1, 13, '101000000011100111001111011100011101101'],
  [[0, 1, 2, 2, 3, 4, 5, 6, 7, 7, 8], 8, 11, 11, '00000011100111001111011100011101101'],
  [[0, 1, 2, 2, 3, 4, 5, 6, 7, 7, 8], 15, 11, 11, '00000001001000100011010001010110011101111000'],
  [
    [...Array.from({ length: 32 }, (_, i) => i)],
    31,
    1,
    32,
    '111110000000001000100001100100001010011000111010000100101010010110110001101011100111110000100011001010011101001010110110101111100011001110101101111100111011111011111'
  ],
  [[], 16, 0, 3, '00'],
  [[], 16, 0, 4, '000']
];

originalFactoryTests.forEach(([enumIndices, maxEnumValue, minLength, maxLength, expectedBitString]) => {
  test(`original factory test: ${enumIndices.length} elements, enum 0-${maxEnumValue}, range [${minLength},${maxLength}]`, () => {
    const options = Array.from({ length: maxEnumValue + 1 }, (_, i) => `E${i}`);
    const enumDef = enumeration('value', options);
    const EnumArraySchema = schema(enumArray('values', enumDef, minLength, maxLength));

    // Convert indices to enum string values
    const enumValues = enumIndices.map((i) => `E${i}`);
    const data = { values: enumValues };

    const encoded = densing(EnumArraySchema, data, 'binary');
    expect(encoded).toBe(expectedBitString);

    const decoded = undensing(EnumArraySchema, encoded, 'binary');
    expect(decoded.values).toEqual(enumValues);
  });
});

// Parsing tests - decode binary strings
const parsingTests: [string, number, number, number, string[], string][] = [
  // [bitString, enumSize, minLength, maxLength, expectedValues, description]
  ['000', 2, 0, 4, [], 'empty array'],
  ['0010', 2, 0, 4, ['A'], 'single A from 2 options'],
  ['0011', 2, 0, 4, ['B'], 'single B from 2 options'],
  ['01001', 2, 0, 4, ['A', 'B'], 'A,B from 2 options'],
  ['01010', 2, 0, 4, ['B', 'A'], 'B,A from 2 options'],
  ['00100', 4, 0, 4, ['A'], 'single A from 4 options'],
  ['011000110', 4, 0, 4, ['A', 'B', 'C'], 'A,B,C from 4 options'],
  ['0001000', 8, 0, 8, ['A'], 'single A from 8 options']
];

parsingTests.forEach(([bitString, enumSize, minLength, maxLength, expectedValues, description]) => {
  test(`parsing enum_array '${bitString}' as ${description}`, () => {
    const options = Array.from({ length: enumSize }, (_, i) => String.fromCharCode(65 + i));
    const enumDef = enumeration('item', options);
    const EnumArraySchema = schema(enumArray('values', enumDef, minLength, maxLength));

    const decoded = undensing(EnumArraySchema, bitString, 'binary');
    expect(decoded.values).toEqual(expectedValues);
  });
});

// Round-trip tests for enum arrays
test('enum array round-trip - small array', () => {
  const enumDef = enumeration('color', ['Red', 'Green', 'Blue', 'Yellow']);
  const EnumArraySchema = schema(enumArray('colors', enumDef, 0, 10));

  const data = { colors: ['Red', 'Green', 'Blue', 'Red'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.colors).toEqual(['Red', 'Green', 'Blue', 'Red']);
});

test('enum array round-trip - single element', () => {
  const enumDef = enumeration('option', ['A', 'B']);
  const EnumArraySchema = schema(enumArray('options', enumDef, 1, 2));

  const data = { options: ['A'] };
  const encoded = densing(EnumArraySchema, data, 'binary');
  const decoded = undensing(EnumArraySchema, encoded, 'binary');

  expect(decoded.options).toEqual(['A']);
});

test('enum array round-trip - empty array', () => {
  const enumDef = enumeration('option', ['A', 'B', 'C']);
  const EnumArraySchema = schema(enumArray('options', enumDef, 0, 5));

  const data = { options: [] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.options).toEqual([]);
});

test('enum array round-trip - moderate size array', () => {
  const enumDef = enumeration(
    'digit',
    Array.from({ length: 9 }, (_, i) => `E${i}`)
  );
  const EnumArraySchema = schema(enumArray('digits', enumDef, 1, 13));

  const data = { digits: ['E0', 'E1', 'E2', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E7', 'E8'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.digits).toEqual(data.digits);
});

test('enum array round-trip - fixed length', () => {
  const enumDef = enumeration(
    'digit',
    Array.from({ length: 16 }, (_, i) => `E${i}`)
  );
  const EnumArraySchema = schema(enumArray('digits', enumDef, 11, 11));

  const data = { digits: ['E0', 'E1', 'E2', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E7', 'E8'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.digits).toEqual(data.digits);
});

test('enum array round-trip - large array', () => {
  const enumDef = enumeration(
    'num',
    Array.from({ length: 32 }, (_, i) => `N${i}`)
  );
  const EnumArraySchema = schema(enumArray('numbers', enumDef, 1, 32));

  const data = { numbers: Array.from({ length: 32 }, (_, i) => `N${i}`) };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.numbers).toEqual(data.numbers);
});

test('enum array with large alphabet', () => {
  // Create a 64-option enum (6 bits per element in non-packed encoding)
  const enumDef = enumeration(
    'char',
    Array.from({ length: 64 }, (_, i) => String.fromCharCode(65 + i))
  );
  const EnumArraySchema = schema(enumArray('text', enumDef, 0, 20));

  const data = { text: ['A', 'B', 'C', 'D', 'E'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.text).toEqual(data.text);
});

test('enum array - repeated values', () => {
  const enumDef = enumeration('letter', ['X', 'Y', 'Z']);
  const EnumArraySchema = schema(enumArray('letters', enumDef, 0, 10));

  const data = { letters: ['X', 'X', 'X', 'Y', 'Z', 'Z'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.letters).toEqual(data.letters);
});

test('enum array - binary encoding efficiency', () => {
  const enumDef = enumeration('bit', ['0', '1']);
  const EnumArraySchema = schema(enumArray('bits', enumDef, 0, 10));

  const data = { bits: ['0', '1', '1', '0', '1'] };
  const encoded = densing(EnumArraySchema, data, 'binary');
  const decoded = undensing(EnumArraySchema, encoded, 'binary');

  expect(decoded.bits).toEqual(data.bits);
  // With 2 options and 5 elements, should be very compact
  expect(encoded.length).toBeLessThan(20); // Much less than 5 separate enums
});

test('enum array - various lengths with same schema', () => {
  const enumDef = enumeration('color', ['R', 'G', 'B']);
  const EnumArraySchema = schema(enumArray('colors', enumDef, 0, 10));

  const testCases = [[], ['R'], ['R', 'G'], ['R', 'G', 'B'], ['B', 'B', 'B', 'B'], ['R', 'G', 'B', 'R', 'G', 'B', 'R']];

  testCases.forEach((colors) => {
    const data = { colors };
    const encoded = densing(EnumArraySchema, data);
    const decoded = undensing(EnumArraySchema, encoded);
    expect(decoded.colors).toEqual(colors);
  });
});

test('enum array - all values in small enum', () => {
  const enumDef = enumeration('option', ['A', 'B', 'C', 'D']);
  const EnumArraySchema = schema(enumArray('options', enumDef, 0, 10));

  const data = { options: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'] };
  const encoded = densing(EnumArraySchema, data);
  const decoded = undensing(EnumArraySchema, encoded);

  expect(decoded.options).toEqual(data.options);
});
