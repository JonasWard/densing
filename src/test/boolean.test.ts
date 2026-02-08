import { expect, test } from 'bun:test';
import { schema, bool } from '../schema/builder';
import { densing, undensing } from '../densing';

export const values: [boolean, string][] = [
  [false, '0'],
  [true, '1']
];

values.forEach(([v, bitString]) =>
  test(`boolean ${v} encodes to '${bitString}'`, () => {
    const BoolSchema = schema(bool('value'));
    const data = { value: v };

    const encoded = densing(BoolSchema, data, 'binary');
    expect(encoded).toBe(bitString);
  })
);

values.forEach(([v, bitString]) =>
  test(`parsing '${bitString}' as boolean`, () => {
    const BoolSchema = schema(bool('value'));
    const decoded = undensing(BoolSchema, bitString, 'binary');

    expect(decoded.value).toBe(v);
  })
);

// Test round-trip encoding/decoding
test('boolean round-trip test', () => {
  const BoolSchema = schema(bool('enabled'));

  // Test false
  const falseData = { enabled: false };
  const encodedFalse = densing(BoolSchema, falseData);
  const decodedFalse = undensing(BoolSchema, encodedFalse);
  expect(decodedFalse.enabled).toBe(false);

  // Test true
  const trueData = { enabled: true };
  const encodedTrue = densing(BoolSchema, trueData);
  const decodedTrue = undensing(BoolSchema, encodedTrue);
  expect(decodedTrue.enabled).toBe(true);
});

// Test multiple booleans in a schema
test('multiple booleans in schema', () => {
  const MultiBoolSchema = schema(bool('flag1'), bool('flag2'), bool('flag3'), bool('flag4'));

  const testCases = [
    { flag1: false, flag2: false, flag3: false, flag4: false },
    { flag1: true, flag2: false, flag3: false, flag4: false },
    { flag1: true, flag2: true, flag3: false, flag4: false },
    { flag1: true, flag2: true, flag3: true, flag4: false },
    { flag1: true, flag2: true, flag3: true, flag4: true },
    { flag1: false, flag2: true, flag3: false, flag4: true },
    { flag1: true, flag2: false, flag3: true, flag4: false }
  ];

  testCases.forEach((data) => {
    const encoded = densing(MultiBoolSchema, data);
    const decoded = undensing(MultiBoolSchema, encoded);

    expect(decoded).toEqual(data);
  });
});
