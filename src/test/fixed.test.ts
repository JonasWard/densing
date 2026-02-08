import { expect, test } from 'bun:test';
import { schema, fixed } from '../schema/builder';
import { densing, undensing } from '../densing';

// Test values: [value, min, max, precision, bitString]
export const values: [number, number, number, number, string][] = [
  [1, 0, 1, 0.1, '1010'], // max
  [0, 0, 1, 0.1, '0000'], // min
  [0.2, 0, 1, 0.1, '0010'], // middle
  [0.4, 0, 1, 0.1, '0100'], // middle
  [0.8, 0, 1, 0.1, '1000'], // middle
  [-10, -10, 10, 1, '00000'],
  [0, -10, 10, 0.1, '01100100'], // middle
  [10, -10, 10, 0.1, '11001000'], // max
  [0, 0, 15, 0.1, '00000000'], // min
  [3, 0, 15, 0.1, '00011110'], // middle
  [15, 0, 15, 0.1, '10010110'], // max
  [0, 0, 1, 0.01, '0000000'], // min
  [0.07, 0, 1, 0.01, '0000111'], // middle
  [0.61, 0, 1, 0.01, '0111101'], // middle
  [1, 0, 1, 0.01, '1100100'], // max
  [0, 0, 1, 0.001, '0000000000'], // min
  [0.065, 0, 1, 0.001, '0001000001'], // middle
  [0.598, 0, 1, 0.001, '1001010110'], // middle
  [1, 0, 1, 0.001, '1111101000'] // max
];

values.forEach(([v, min, max, precision, bitString]) =>
  test(`fixed ${v}, min: ${min}, max: ${max}, precision: ${precision} encodes to '${bitString}'`, () => {
    const FixedSchema = schema(fixed('value', min, max, precision));
    const data = { value: v };

    const encoded = densing(FixedSchema, data, 'binary');
    expect(encoded).toBe(bitString);
  })
);

values.forEach(([v, min, max, precision, bitString]) =>
  test(`parsing '${bitString}' as fixed`, () => {
    const FixedSchema = schema(fixed('value', min, max, precision));
    const decoded = undensing(FixedSchema, bitString, 'binary');

    expect(decoded.value).toBeCloseTo(v, Math.abs(Math.log10(precision)));
  })
);

// Test round-trip encoding/decoding
test('fixed point round-trip test', () => {
  const FixedSchema = schema(fixed('temperature', -40, 125, 0.1));

  const testValues = [-40, -10.5, 0, 25.3, 100.7, 125];

  testValues.forEach((temp) => {
    const data = { temperature: temp };
    const encoded = densing(FixedSchema, data);
    const decoded = undensing(FixedSchema, encoded);

    expect(decoded.temperature).toBeCloseTo(temp, 1);
  });
});
