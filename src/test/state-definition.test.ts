import { expect, test } from 'bun:test';
import { schema, enumeration, int, object, array, optional, union } from '../schema/builder';
import { densing, undensing } from '../densing';

// Helper for round-trip encoding/decoding
const roundTrip = (testSchema: any, data: any) => {
  const encoded = densing(testSchema, data);
  const decoded = undensing(testSchema, encoded);
  expect(decoded).toEqual(data);
  return { encoded, decoded };
};

test('union with object variants', () => {
  // Old: ENUM_OPTIONS with different object types
  // New: union with discriminated variants
  const discriminator = enumeration('type', ['option0', 'option1', 'null']);
  const UnionSchema = schema(
    union('state', discriminator, {
      option0: [enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']), enumeration('enumB', ['B1', 'B2', 'B3'])],
      option1: [enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F'])],
      null: []
    })
  );

  // Test option0
  const data0 = { state: { type: 'option0', enumA: 'C', enumB: 'B2' } };
  roundTrip(UnionSchema, data0);

  // Test option1
  const data1 = { state: { type: 'option1', enumA: 'A' } };
  roundTrip(UnionSchema, data1);

  // Test null variant
  const data2 = { state: { type: 'null' } };
  roundTrip(UnionSchema, data2);
});

test('object with multiple enums', () => {
  const ObjectSchema = schema(
    object(
      'obj',
      enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
      enumeration(
        'enumB',
        Array.from({ length: 26 }, (_, i) => `E${i}`)
      ),
      enumeration(
        'enumC',
        Array.from({ length: 26 }, (_, i) => `F${i}`)
      )
    )
  );

  const data = {
    obj: {
      enumA: 'C',
      enumB: 'E10',
      enumC: 'F22'
    }
  };

  roundTrip(ObjectSchema, data);

  // Test with different values
  const data2 = {
    obj: {
      enumA: 'D',
      enumB: 'E15',
      enumC: 'F25'
    }
  };

  roundTrip(ObjectSchema, data2);
});

test('nested objects', () => {
  const NestedSchema = schema(
    object(
      'obj1',
      object(
        'obj',
        enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
        enumeration(
          'enumB',
          Array.from({ length: 26 }, (_, i) => `E${i}`)
        ),
        enumeration(
          'enumC',
          Array.from({ length: 26 }, (_, i) => `F${i}`)
        )
      )
    )
  );

  const data = {
    obj1: {
      obj: {
        enumA: 'D',
        enumB: 'E10',
        enumC: 'F22'
      }
    }
  };

  roundTrip(NestedSchema, data);
});

test('complex nested union with objects', () => {
  // Simulating the complex ENUM_OPTIONS structure
  const discriminator = enumeration('type', ['obj0', 'obj1', 'null', 'obj0alt', 'enum0']);
  const subDiscriminator = enumeration('type', ['subObj0', 'subObj1', 'subNull']);

  const ComplexUnionSchema = schema(
    union('action', discriminator, {
      obj0: [
        enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
        enumeration(
          'enumB',
          Array.from({ length: 26 }, (_, i) => `E${i}`)
        )
      ],
      obj1: [
        enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
        enumeration(
          'enumB',
          Array.from({ length: 26 }, (_, i) => `E${i}`)
        ),
        enumeration(
          'enumC',
          Array.from({ length: 26 }, (_, i) => `F${i}`)
        )
      ],
      null: [],
      obj0alt: [
        enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
        enumeration(
          'enumB',
          Array.from({ length: 26 }, (_, i) => `E${i}`)
        )
      ],
      enum0: [
        union('subAction', subDiscriminator, {
          subObj0: [
            enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
            enumeration(
              'enumB',
              Array.from({ length: 26 }, (_, i) => `E${i}`)
            )
          ],
          subObj1: [
            enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F']),
            enumeration(
              'enumB',
              Array.from({ length: 26 }, (_, i) => `E${i}`)
            ),
            enumeration(
              'enumC',
              Array.from({ length: 26 }, (_, i) => `F${i}`)
            )
          ],
          subNull: []
        }),
        enumeration('enumA', ['A', 'B', 'C', 'D', 'E', 'F'])
      ]
    })
  );

  // Test obj0
  const dataObj0 = { action: { type: 'obj0', enumA: 'C', enumB: 'E4' } };
  roundTrip(ComplexUnionSchema, dataObj0);

  // Test obj1
  const dataObj1 = { action: { type: 'obj1', enumA: 'D', enumB: 'E10', enumC: 'F15' } };
  roundTrip(ComplexUnionSchema, dataObj1);

  // Test null
  const dataNull = { action: { type: 'null' } };
  roundTrip(ComplexUnionSchema, dataNull);

  // Test enum0 with nested union
  const dataEnum0 = {
    action: {
      type: 'enum0',
      subAction: {
        type: 'subObj1',
        enumA: 'B',
        enumB: 'E5',
        enumC: 'F20'
      },
      enumA: 'E'
    }
  };
  roundTrip(ComplexUnionSchema, dataEnum0);
});

test('arrays with variable length', () => {
  const ArraySchema = schema(array('items', 0, 100, int('value', 0, 100)));

  // Test with length 3
  const data3 = { items: [10, 20, 30] };
  roundTrip(ArraySchema, data3);

  // Test with length 4
  const data4 = { items: [10, 20, 30, 40] };
  roundTrip(ArraySchema, data4);

  // Test with length 1
  const data1 = { items: [99] };
  roundTrip(ArraySchema, data1);

  // Test with length 10
  const data10 = { items: Array.from({ length: 10 }, (_, i) => i * 10) };
  roundTrip(ArraySchema, data10);

  // Test empty array
  const dataEmpty = { items: [] };
  roundTrip(ArraySchema, dataEmpty);
});

test('complex structure with arrays and optionals', () => {
  const modeDiscriminator = enumeration('type', ['simple', 'advanced', 'none']);

  const ComplexSchema = schema(
    object(
      'config',
      union('mode', modeDiscriminator, {
        simple: [
          enumeration('enumA', ['A', 'B', 'C', 'D']),
          enumeration(
            'enumB',
            Array.from({ length: 21 }, (_, i) => `E${i}`)
          )
        ],
        advanced: [enumeration('enumA', ['A', 'B', 'C', 'D'])],
        none: []
      }),
      array('values', 0, 100, int('item', 0, 100)),
      optional('extra', array('extraValues', 0, 100, int('item', 0, 100)))
    )
  );

  // Test with optional present
  const dataWithOptional = {
    config: {
      mode: { type: 'simple', enumA: 'B', enumB: 'E5' },
      values: [10, 20, 30],
      extra: [1, 2, 3, 4, 5]
    }
  };
  roundTrip(ComplexSchema, dataWithOptional);

  // Test with optional absent
  const dataWithoutOptional = {
    config: {
      mode: { type: 'advanced', enumA: 'C' },
      values: [40, 50],
      extra: null
    }
  };
  roundTrip(ComplexSchema, dataWithoutOptional);

  // Test with none variant
  const dataNone = {
    config: {
      mode: { type: 'none' },
      values: [1, 2, 3, 4, 5],
      extra: null
    }
  };
  roundTrip(ComplexSchema, dataNone);
});

test('array operations - adding and removing elements', () => {
  const ArraySchema = schema(array('numbers', 1, 101, int('value', 0, 100)));

  // Start with 3 elements
  let data = { numbers: [10, 20, 30] };
  const { encoded: enc1 } = roundTrip(ArraySchema, data);

  // Update to 4 elements
  data = { numbers: [10, 20, 30, 40] };
  const { encoded: enc2 } = roundTrip(ArraySchema, data);
  expect(enc2).not.toBe(enc1); // Different encodings

  // Update to 2 elements
  data = { numbers: [10, 20] };
  const { encoded: enc3 } = roundTrip(ArraySchema, data);
  expect(enc3).not.toBe(enc2);

  // Update first element
  data = { numbers: [50, 20] };
  const { encoded: enc4 } = roundTrip(ArraySchema, data);
  expect(enc4).not.toBe(enc3);

  // Single element
  data = { numbers: [99] };
  roundTrip(ArraySchema, data);

  // Maximum length
  data = { numbers: Array.from({ length: 10 }, (_, i) => i) };
  roundTrip(ArraySchema, data);
});

test('binary encoding for array operations', () => {
  const ArraySchema = schema(array('items', 0, 15, int('value', 0, 15)));

  // Empty array
  const data0 = { items: [] };
  const encoded0 = densing(ArraySchema, data0, 'binary');
  expect(encoded0).toBe('0000'); // 4 bits for length 0-15, length=0

  // Single element
  const data1 = { items: [5] };
  const encoded1 = densing(ArraySchema, data1, 'binary');
  expect(encoded1).toBe('00010101'); // 4 bits length (1) + 4 bits value (5)

  // Two elements
  const data2 = { items: [5, 10] };
  const encoded2 = densing(ArraySchema, data2, 'binary');
  expect(encoded2).toBe('001001011010'); // 4 bits length (2) + 4 bits value (5) + 4 bits value (10)

  // Verify round-trip
  expect(undensing(ArraySchema, encoded0, 'binary')).toEqual(data0);
  expect(undensing(ArraySchema, encoded1, 'binary')).toEqual(data1);
  expect(undensing(ArraySchema, encoded2, 'binary')).toEqual(data2);
});
