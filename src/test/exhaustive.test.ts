import { expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { analyzeDenseSchemaSize, calculateDenseDataSize, walkDenseSchema } from '../api';
import { getDefaultData, generateTypes, validate } from '../schema';
import { DenseSchema } from '../schema-type';

// A schema with a field type the library does not know, e.g. from a newer version or a typo in JSON
const unknown = { fields: [{ type: 'mystery', name: 'm' }] } as unknown as DenseSchema;

test('an unknown field type throws everywhere instead of being silently skipped', () => {
  const message = 'Unknown field type "mystery"';
  expect(() => densing(unknown, { m: 1 })).toThrow(message);
  expect(() => undensing(unknown, 'AAAA')).toThrow(message);
  expect(() => validate(unknown, { m: 1 })).toThrow(message);
  expect(() => getDefaultData(unknown)).toThrow(message);
  expect(() => generateTypes(unknown)).toThrow(message);
  expect(() => analyzeDenseSchemaSize(unknown)).toThrow(message);
  expect(() => calculateDenseDataSize(unknown, { m: 1 })).toThrow(message);
  expect(() => walkDenseSchema(unknown, () => {})).toThrow(message);
});
