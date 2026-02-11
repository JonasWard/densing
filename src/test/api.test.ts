// api.test.ts - Test the high-level API methods
import { test, expect } from 'bun:test';
import { schema } from '../schema/builder';
import { int, fixed, bool, enumeration, optional, object, array, union, enumArray } from '../schema/builder';
import {
  getDenseFieldBitWidthRange,
  calculateDenseFieldBitWidth,
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  getFieldByPath,
  walkDenseSchema,
  getAllDenseSchemaPaths,
} from '../api';
import { densing } from '../densing';

// Helper to create simple test schemas
const SimpleSchema = schema(
  bool('enabled'),
  int('count', 0, 100),
  fixed('temperature', -40, 125, 0.1),
  enumeration('color', ['red', 'green', 'blue'])
);

const OptionalSchema = schema(int('required', 0, 100), optional('optional', int('optionalValue', 0, 255)));

const ArraySchema = schema(array('items', 0, 5, int('value', 0, 10)));

const NestedSchema = schema(
  int('id', 0, 1000),
  object('settings', bool('enabled'), int('timeout', 0, 60))
);

const UnionSchema = schema(
  union(
    'action',
    enumeration('actionType', ['start', 'stop']),
    {
      start: [int('delay', 0, 60)],
      stop: [bool('force')],
    }
  )
);

// ===== Bit Width Range Tests =====

test('getDenseFieldBitWidthRange - bool field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'enabled')!;
  const range = getDenseFieldBitWidthRange(field);
  expect(range).toEqual({ min: 1, max: 1 });
});

test('getDenseFieldBitWidthRange - int field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'count')!;
  const range = getDenseFieldBitWidthRange(field);
  // 0-100 = 101 values = 7 bits
  expect(range).toEqual({ min: 7, max: 7 });
});

test('getDenseFieldBitWidthRange - fixed field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'temperature')!;
  const range = getDenseFieldBitWidthRange(field);
  // -40 to 125 with 0.1 precision = 1650 values = 11 bits
  expect(range).toEqual({ min: 11, max: 11 });
});

test('getDenseFieldBitWidthRange - enum field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'color')!;
  const range = getDenseFieldBitWidthRange(field);
  // 3 options = 2 bits
  expect(range).toEqual({ min: 2, max: 2 });
});

test('getDenseFieldBitWidthRange - optional field', () => {
  const field = OptionalSchema.fields.find((f) => f.name === 'optional')!;
  const range = getDenseFieldBitWidthRange(field);
  // 1 bit presence flag + 0-8 bits for value
  expect(range).toEqual({ min: 1, max: 9 });
});

test('getDenseFieldBitWidthRange - array field', () => {
  const field = ArraySchema.fields.find((f) => f.name === 'items')!;
  const range = getDenseFieldBitWidthRange(field);
  // Array 0-5: 3 bits for length, items 0-10: 4 bits each
  // Min: 3 + 0*4 = 3, Max: 3 + 5*4 = 23
  expect(range).toEqual({ min: 3, max: 23 });
});

test('getDenseFieldBitWidthRange - object field', () => {
  const field = NestedSchema.fields.find((f) => f.name === 'settings')!;
  const range = getDenseFieldBitWidthRange(field);
  // bool (1 bit) + int 0-60 (6 bits) = 7 bits
  expect(range).toEqual({ min: 7, max: 7 });
});

test('getDenseFieldBitWidthRange - union field', () => {
  const field = UnionSchema.fields.find((f) => f.name === 'action')!;
  const range = getDenseFieldBitWidthRange(field);
  // Discriminator: 2 options = 1 bit
  // start variant: 6 bits (int 0-60)
  // stop variant: 1 bit (bool)
  // Min: 1 + 1 = 2, Max: 1 + 6 = 7
  expect(range).toEqual({ min: 2, max: 7 });
});

// ===== Actual Bit Width Calculation Tests =====

test('calculateDenseFieldBitWidth - bool field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'enabled')!;
  expect(calculateDenseFieldBitWidth(field, true)).toBe(1);
  expect(calculateDenseFieldBitWidth(field, false)).toBe(1);
});

test('calculateDenseFieldBitWidth - int field', () => {
  const field = SimpleSchema.fields.find((f) => f.name === 'count')!;
  expect(calculateDenseFieldBitWidth(field, 0)).toBe(7);
  expect(calculateDenseFieldBitWidth(field, 50)).toBe(7);
  expect(calculateDenseFieldBitWidth(field, 100)).toBe(7);
});

test('calculateDenseFieldBitWidth - optional field present', () => {
  const field = OptionalSchema.fields.find((f) => f.name === 'optional')!;
  // 1 presence bit + 8 bits for value
  expect(calculateDenseFieldBitWidth(field, 100)).toBe(9);
});

test('calculateDenseFieldBitWidth - optional field absent', () => {
  const field = OptionalSchema.fields.find((f) => f.name === 'optional')!;
  // Just 1 presence bit
  expect(calculateDenseFieldBitWidth(field, null)).toBe(1);
});

test('calculateDenseFieldBitWidth - array field', () => {
  const field = ArraySchema.fields.find((f) => f.name === 'items')!;
  // 3 bits for length + 4 bits per item
  expect(calculateDenseFieldBitWidth(field, [])).toBe(3); // Empty array
  expect(calculateDenseFieldBitWidth(field, [5])).toBe(7); // 3 + 1*4
  expect(calculateDenseFieldBitWidth(field, [1, 2, 3])).toBe(15); // 3 + 3*4
});

test('calculateDenseFieldBitWidth - object field', () => {
  const field = NestedSchema.fields.find((f) => f.name === 'settings')!;
  const value = { enabled: true, timeout: 30 };
  // 1 bit (bool) + 6 bits (int 0-60) = 7 bits
  expect(calculateDenseFieldBitWidth(field, value)).toBe(7);
});

test('calculateDenseFieldBitWidth - union field', () => {
  const field = UnionSchema.fields.find((f) => f.name === 'action')!;

  // start variant: 1 discriminator bit + 6 bits for delay
  const startValue = { actionType: 'start', delay: 10 };
  expect(calculateDenseFieldBitWidth(field, startValue)).toBe(7);

  // stop variant: 1 discriminator bit + 1 bit for force
  const stopValue = { actionType: 'stop', force: true };
  expect(calculateDenseFieldBitWidth(field, stopValue)).toBe(2);
});

// ===== Schema Size Analysis Tests =====

test('analyzeDenseSchemaSize - simple schema', () => {
  const sizeInfo = analyzeDenseSchemaSize(SimpleSchema);

  // bool(1) + int(7) + fixed(11) + enum(2) = 21 bits
  expect(sizeInfo.staticRange.minBits).toBe(21);
  expect(sizeInfo.staticRange.maxBits).toBe(21);
  expect(sizeInfo.staticRange.minBytes).toBe(3); // ceil(21/8)
  expect(sizeInfo.staticRange.maxBytes).toBe(3);
  expect(sizeInfo.staticRange.minBase64Chars).toBe(4); // ceil(21/6)
  expect(sizeInfo.staticRange.maxBase64Chars).toBe(4);

  expect(sizeInfo.fieldRanges.enabled).toEqual({ min: 1, max: 1 });
  expect(sizeInfo.fieldRanges.count).toEqual({ min: 7, max: 7 });
  expect(sizeInfo.fieldRanges.temperature).toEqual({ min: 11, max: 11 });
  expect(sizeInfo.fieldRanges.color).toEqual({ min: 2, max: 2 });
});

test('analyzeDenseSchemaSize - schema with variable fields', () => {
  const sizeInfo = analyzeDenseSchemaSize(OptionalSchema);

  // required(7) + optional(1-9) = 8-16 bits
  expect(sizeInfo.staticRange.minBits).toBe(8);
  expect(sizeInfo.staticRange.maxBits).toBe(16);
  expect(sizeInfo.fieldRanges.required).toEqual({ min: 7, max: 7 });
  expect(sizeInfo.fieldRanges.optional).toEqual({ min: 1, max: 9 });
});

// ===== Data Size Calculation Tests =====

test('calculateDenseDataSize - simple schema', () => {
  const data = { enabled: true, count: 50, temperature: 20.5, color: 'green' };
  const sizeInfo = calculateDenseDataSize(SimpleSchema, data);

  expect(sizeInfo.totalBits).toBe(21);
  expect(sizeInfo.totalBytes).toBe(3);
  expect(sizeInfo.base64Length).toBe(4);
  expect(sizeInfo.fieldSizes.enabled).toBe(1);
  expect(sizeInfo.fieldSizes.count).toBe(7);
  expect(sizeInfo.fieldSizes.temperature).toBe(11);
  expect(sizeInfo.fieldSizes.color).toBe(2);
  expect(sizeInfo.efficiency.utilizationPercent).toBe(100); // Fixed size schema
});

test('calculateDenseDataSize - optional field present', () => {
  const data = { required: 50, optional: 100 };
  const sizeInfo = calculateDenseDataSize(OptionalSchema, data);

  expect(sizeInfo.totalBits).toBe(16); // 7 + 9
  expect(sizeInfo.fieldSizes.required).toBe(7);
  expect(sizeInfo.fieldSizes.optional).toBe(9); // 1 presence + 8 value
  expect(sizeInfo.efficiency.utilizationPercent).toBe(100); // Using max
});

test('calculateDenseDataSize - optional field absent', () => {
  const data = { required: 50, optional: null };
  const sizeInfo = calculateDenseDataSize(OptionalSchema, data);

  expect(sizeInfo.totalBits).toBe(8); // 7 + 1
  expect(sizeInfo.fieldSizes.required).toBe(7);
  expect(sizeInfo.fieldSizes.optional).toBe(1); // Just presence bit
  expect(sizeInfo.efficiency.utilizationPercent).toBe(0); // Using min
});

test('calculateDenseDataSize - array field', () => {
  const data = { items: [1, 2, 3] };
  const sizeInfo = calculateDenseDataSize(ArraySchema, data);

  expect(sizeInfo.totalBits).toBe(15); // 3 length + 3*4 items
  expect(sizeInfo.fieldSizes.items).toBe(15);
});

test('calculateDenseDataSize - matches actual encoding', () => {
  // Verify that calculated size matches actual encoding
  const data = { enabled: true, count: 50, temperature: 20.5, color: 'green' };
  const sizeInfo = calculateDenseDataSize(SimpleSchema, data);
  const encoded = densing(SimpleSchema, data, 'binary');

  expect(sizeInfo.totalBits).toBe(encoded.length);
});

// ===== Path Resolution Tests =====

test('getFieldByPath - top level field', () => {
  const field = getFieldByPath(SimpleSchema, 'enabled');
  expect(field).not.toBeNull();
  expect(field?.name).toBe('enabled');
  expect(field?.type).toBe('bool');
});

test('getFieldByPath - nested field', () => {
  const field = getFieldByPath(NestedSchema, 'settings.enabled');
  expect(field).not.toBeNull();
  expect(field?.name).toBe('enabled');
  expect(field?.type).toBe('bool');
});

test('getFieldByPath - non-existent field', () => {
  const field = getFieldByPath(SimpleSchema, 'nonexistent');
  expect(field).toBeNull();
});

test('getFieldByPath - invalid nested path', () => {
  const field = getFieldByPath(NestedSchema, 'settings.invalid');
  expect(field).toBeNull();
});

// ===== Schema Walking Tests =====

test('walkDenseSchema - visits all fields', () => {
  const paths: string[] = [];
  walkDenseSchema(SimpleSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toEqual(['enabled', 'count', 'temperature', 'color']);
});

test('walkDenseSchema - visits nested fields', () => {
  const paths: string[] = [];
  walkDenseSchema(NestedSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toEqual(['id', 'settings', 'settings.enabled', 'settings.timeout']);
});

test('walkDenseSchema - provides field objects to callback', () => {
  const fieldTypes: string[] = [];
  walkDenseSchema(SimpleSchema, (field) => {
    fieldTypes.push(field.type);
  });

  expect(fieldTypes).toEqual(['bool', 'int', 'fixed', 'enum']);
});

test('walkDenseSchema - handles array items', () => {
  const paths: string[] = [];
  walkDenseSchema(ArraySchema, (field, path) => {
    paths.push(path);
  });

  // Should visit the array itself and its items
  expect(paths).toContain('items');
  expect(paths).toContain('items[].value');
});

test('walkDenseSchema - handles optional fields', () => {
  const paths: string[] = [];
  walkDenseSchema(OptionalSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toEqual(['required', 'optional', 'optional.optionalValue']);
});

test('walkDenseSchema - handles union variants', () => {
  const paths: string[] = [];
  walkDenseSchema(UnionSchema, (field, path) => {
    paths.push(path);
  });

  // Should visit the discriminator and all variant fields
  expect(paths).toContain('action');
  expect(paths).toContain('action.actionType');
  expect(paths).toContain('action.delay'); // start variant
  expect(paths).toContain('action.force'); // stop variant
});

test('walkDenseSchema - deeply nested structures', () => {
  const DeeplyNestedSchema = schema(
    object(
      'level1',
      object(
        'level2',
        object('level3', int('deepValue', 0, 100), bool('deepFlag')),
        array('deepArray', 0, 3, int('item', 0, 10))
      ),
      optional('optionalNested', int('nestedInt', 0, 50))
    )
  );

  const paths: string[] = [];
  walkDenseSchema(DeeplyNestedSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toContain('level1');
  expect(paths).toContain('level1.level2');
  expect(paths).toContain('level1.level2.level3');
  expect(paths).toContain('level1.level2.level3.deepValue');
  expect(paths).toContain('level1.level2.level3.deepFlag');
  expect(paths).toContain('level1.level2.deepArray');
  expect(paths).toContain('level1.level2.deepArray[].item');
  expect(paths).toContain('level1.optionalNested');
  expect(paths).toContain('level1.optionalNested.nestedInt');
});

test('walkDenseSchema - with custom prefix', () => {
  const paths: string[] = [];
  walkDenseSchema(SimpleSchema, (field, path) => {
    paths.push(path);
  }, 'config');

  expect(paths).toEqual(['config.enabled', 'config.count', 'config.temperature', 'config.color']);
});

test('walkDenseSchema - collects field metadata', () => {
  const fieldInfo: Array<{ path: string; type: string; name: string }> = [];
  walkDenseSchema(NestedSchema, (field, path) => {
    fieldInfo.push({ path, type: field.type, name: field.name });
  });

  expect(fieldInfo).toEqual([
    { path: 'id', type: 'int', name: 'id' },
    { path: 'settings', type: 'object', name: 'settings' },
    { path: 'settings.enabled', type: 'bool', name: 'enabled' },
    { path: 'settings.timeout', type: 'int', name: 'timeout' },
  ]);
});

test('walkDenseSchema - array of objects', () => {
  const ArrayOfObjectsSchema = schema(
    array(
      'users',
      0,
      5,
      object('user', int('id', 0, 1000), bool('active'), enumeration('role', ['admin', 'user', 'guest']))
    )
  );

  const paths: string[] = [];
  walkDenseSchema(ArrayOfObjectsSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toContain('users');
  expect(paths).toContain('users[].user');
  expect(paths).toContain('users[].user.id');
  expect(paths).toContain('users[].user.active');
  expect(paths).toContain('users[].user.role');
});

test('walkDenseSchema - union with nested objects', () => {
  const ComplexUnionSchema = schema(
    union(
      'message',
      enumeration('messageType', ['text', 'image', 'file']),
      {
        text: [int('length', 0, 1000)],
        image: [object('imageData', int('width', 0, 4096), int('height', 0, 4096))],
        file: [object('fileData', int('size', 0, 1000000), bool('compressed'))],
      }
    )
  );

  const paths: string[] = [];
  walkDenseSchema(ComplexUnionSchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toContain('message');
  expect(paths).toContain('message.messageType');
  expect(paths).toContain('message.length'); // text variant
  expect(paths).toContain('message.imageData'); // image variant
  expect(paths).toContain('message.imageData.width');
  expect(paths).toContain('message.imageData.height');
  expect(paths).toContain('message.fileData'); // file variant
  expect(paths).toContain('message.fileData.size');
  expect(paths).toContain('message.fileData.compressed');
});

test('walkDenseSchema - empty schema', () => {
  const EmptySchema = schema();
  const paths: string[] = [];
  walkDenseSchema(EmptySchema, (field, path) => {
    paths.push(path);
  });

  expect(paths).toEqual([]);
});

test('getAllDenseSchemaPaths - simple schema', () => {
  const paths = getAllDenseSchemaPaths(SimpleSchema);
  expect(paths).toEqual(['enabled', 'count', 'temperature', 'color']);
});

test('getAllDenseSchemaPaths - nested schema', () => {
  const paths = getAllDenseSchemaPaths(NestedSchema);
  expect(paths).toEqual(['id', 'settings', 'settings.enabled', 'settings.timeout']);
});

test('getAllDenseSchemaPaths - includes all nested levels', () => {
  const ComplexSchema = schema(
    int('id', 0, 100),
    array('items', 0, 5, int('value', 0, 10)),
    object('config', bool('enabled'), optional('port', int('portNum', 1024, 65535)))
  );

  const paths = getAllDenseSchemaPaths(ComplexSchema);

  expect(paths).toContain('id');
  expect(paths).toContain('items');
  expect(paths).toContain('items[].value');
  expect(paths).toContain('config');
  expect(paths).toContain('config.enabled');
  expect(paths).toContain('config.port');
  expect(paths).toContain('config.port.portNum');
});

test('getAllDenseSchemaPaths - union schema', () => {
  const paths = getAllDenseSchemaPaths(UnionSchema);

  expect(paths).toContain('action');
  expect(paths).toContain('action.actionType');
  expect(paths).toContain('action.delay');
  expect(paths).toContain('action.force');
});

test('getAllDenseSchemaPaths - preserves path order', () => {
  const OrderedSchema = schema(
    int('first', 0, 10),
    int('second', 0, 10),
    int('third', 0, 10),
    int('fourth', 0, 10)
  );

  const paths = getAllDenseSchemaPaths(OrderedSchema);
  expect(paths).toEqual(['first', 'second', 'third', 'fourth']);
});

test('getAllDenseSchemaPaths - enum array', () => {
  const EnumArraySchema = schema(
    enumArray('colors', enumeration('color', ['red', 'green', 'blue']), 0, 5),
    int('count', 0, 100)
  );

  const paths = getAllDenseSchemaPaths(EnumArraySchema);
  expect(paths).toContain('colors');
  expect(paths).toContain('count');
});

// ===== EnumArray Tests =====

test('getDenseFieldBitWidthRange - enum array field', () => {
  const EnumArraySchema = schema(enumArray('colors', enumeration('color', ['red', 'green', 'blue']), 0, 5));
  const field = EnumArraySchema.fields[0];
  const range = getDenseFieldBitWidthRange(field);

  // Length bits: 0-5 = 3 bits
  // Content: 3 options = log2(3) ≈ 1.585 bits per item
  // Min: 3 + 0 = 3, Max: 3 + ceil(5 * 1.585) = 3 + 8 = 11
  expect(range.min).toBe(3);
  expect(range.max).toBe(11);
});

test('calculateDenseFieldBitWidth - enum array field', () => {
  const EnumArraySchema = schema(enumArray('colors', enumeration('color', ['red', 'green', 'blue']), 0, 5));
  const field = EnumArraySchema.fields[0];

  // Empty array: 3 bits for length
  expect(calculateDenseFieldBitWidth(field, [])).toBe(3);

  // 1 item: 3 + ceil(1 * log2(3)) = 3 + 2 = 5
  expect(calculateDenseFieldBitWidth(field, ['red'])).toBe(5);

  // 3 items: 3 + ceil(3 * log2(3)) = 3 + 5 = 8
  expect(calculateDenseFieldBitWidth(field, ['red', 'green', 'blue'])).toBe(8);
});

// ===== Integration Test =====

test('size calculation integration - complex schema', () => {
  const ComplexSchema = schema(
    int('id', 0, 1000),
    bool('enabled'),
    optional('temperature', fixed('temp', -40, 125, 0.1)),
    array('tags', 0, 3, enumeration('tag', ['a', 'b', 'c', 'd'])),
    object('config', int('port', 1024, 65535), bool('secure'))
  );

  const data = {
    id: 500,
    enabled: true,
    temperature: 20.5,
    tags: [{ tag: 'a' }, { tag: 'c' }],
    config: { port: 8080, secure: true },
  };

  const sizeInfo = calculateDenseDataSize(ComplexSchema, data);
  const encoded = densing(ComplexSchema, data, 'binary');

  // Verify calculated size matches actual encoding
  expect(sizeInfo.totalBits).toBe(encoded.length);
  console.log(`Complex schema encodes to ${sizeInfo.base64Length} base64 chars (${sizeInfo.totalBits} bits)`);
});
