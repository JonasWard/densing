// meta-schema.test.ts - Test meta-schema utilities
import { test, expect } from 'bun:test';
import { schema } from '../schema/builder';
import { int, fixed, bool, enumeration, optional, object, array, union, enumArray, pointer } from '../schema/builder';
import { getAllUniqueNamesAndOptions } from '../meta/meta-schema';
import { ZstdCodec } from 'zstd-codec';

// Import complex real-world schema for testing
import { mainMethods, preProcessingMethods, postProcessingMethods } from './glsl-ray-marching.test';

// ===== getAllUniqueNamesAndOptions Tests =====

test('getAllUniqueNamesAndOptions - simple schema with no enums', () => {
  const SimpleSchema = schema(bool('enabled'), int('count', 0, 100), fixed('temperature', -40, 125, 0.1));

  const names = getAllUniqueNamesAndOptions(SimpleSchema);

  // Should only collect field names (no enum options)
  expect(names.has('enabled')).toBe(true);
  expect(names.has('count')).toBe(true);
  expect(names.has('temperature')).toBe(true);
  expect(names.size).toBe(3);
});

test('getAllUniqueNamesAndOptions - schema with enum field', () => {
  const EnumSchema = schema(int('id', 0, 100), enumeration('color', ['red', 'green', 'blue']));

  const names = getAllUniqueNamesAndOptions(EnumSchema);

  // Should collect field name AND all enum options
  expect(names.has('id')).toBe(true);
  expect(names.has('color')).toBe(true);
  expect(names.has('red')).toBe(true);
  expect(names.has('green')).toBe(true);
  expect(names.has('blue')).toBe(true);
  expect(names.size).toBe(5);
});

test('getAllUniqueNamesAndOptions - schema with enum array', () => {
  const EnumArraySchema = schema(enumArray('tags', enumeration('tag', ['urgent', 'low', 'medium', 'high']), 0, 5));

  const names = getAllUniqueNamesAndOptions(EnumArraySchema);

  // Should collect array field name, enum name, AND all enum options
  expect(names.has('tags')).toBe(true);
  expect(names.has('tag')).toBe(true); // enum name
  expect(names.has('urgent')).toBe(true);
  expect(names.has('low')).toBe(true);
  expect(names.has('medium')).toBe(true);
  expect(names.has('high')).toBe(true);
  expect(names.size).toBe(6); // tags, tag, urgent, low, medium, high
});

test('getAllUniqueNamesAndOptions - nested object schema', () => {
  const NestedSchema = schema(
    int('id', 0, 1000),
    object('settings', bool('enabled'), int('timeout', 0, 60), enumeration('priority', ['low', 'medium', 'high']))
  );

  const names = getAllUniqueNamesAndOptions(NestedSchema);

  // Should collect all nested field names and enum options
  expect(names.has('id')).toBe(true);
  expect(names.has('settings')).toBe(true);
  expect(names.has('enabled')).toBe(true);
  expect(names.has('timeout')).toBe(true);
  expect(names.has('priority')).toBe(true);
  expect(names.has('low')).toBe(true);
  expect(names.has('medium')).toBe(true);
  expect(names.has('high')).toBe(true);
  expect(names.size).toBe(8);
});

test('getAllUniqueNamesAndOptions - array schema', () => {
  const ArraySchema = schema(
    array('items', 0, 5, object('item', int('value', 0, 10), enumeration('status', ['active', 'inactive'])))
  );

  const names = getAllUniqueNamesAndOptions(ArraySchema);

  // Should collect array name, item field names, and enum options
  expect(names.has('items')).toBe(true);
  expect(names.has('item')).toBe(true);
  expect(names.has('value')).toBe(true);
  expect(names.has('status')).toBe(true);
  expect(names.has('active')).toBe(true);
  expect(names.has('inactive')).toBe(true);
  expect(names.size).toBe(6);
});

test('getAllUniqueNamesAndOptions - optional field schema', () => {
  const OptionalSchema = schema(
    int('required', 0, 100),
    optional('optional', object('data', int('value', 0, 255), enumeration('type', ['A', 'B', 'C'])))
  );

  const names = getAllUniqueNamesAndOptions(OptionalSchema);

  // Should collect optional field name and nested content
  expect(names.has('required')).toBe(true);
  expect(names.has('optional')).toBe(true);
  expect(names.has('data')).toBe(true);
  expect(names.has('value')).toBe(true);
  expect(names.has('type')).toBe(true);
  expect(names.has('A')).toBe(true);
  expect(names.has('B')).toBe(true);
  expect(names.has('C')).toBe(true);
  expect(names.size).toBe(8);
});

test('getAllUniqueNamesAndOptions - union schema', () => {
  const UnionSchema = schema(
    union('action', enumeration('actionType', ['start', 'stop', 'pause']), {
      start: [int('delay', 0, 60)],
      stop: [bool('force')],
      pause: [int('duration', 0, 3600)]
    })
  );

  const names = getAllUniqueNamesAndOptions(UnionSchema);

  // Should collect union name, discriminator name, discriminator options, and all variant fields
  expect(names.has('action')).toBe(true);
  expect(names.has('actionType')).toBe(true);
  expect(names.has('start')).toBe(true);
  expect(names.has('stop')).toBe(true);
  expect(names.has('pause')).toBe(true);
  expect(names.has('delay')).toBe(true);
  expect(names.has('force')).toBe(true);
  expect(names.has('duration')).toBe(true);
  expect(names.size).toBe(8);
});

test('getAllUniqueNamesAndOptions - pointer field schema', () => {
  const PointerSchema = schema(object('node', int('value', 0, 100), optional('next', pointer('nodeRef', 'node'))));

  const names = getAllUniqueNamesAndOptions(PointerSchema);

  // Should collect field name, targetName, and nested fields
  expect(names.has('node')).toBe(true);
  expect(names.has('value')).toBe(true);
  expect(names.has('next')).toBe(true);
  expect(names.has('nodeRef')).toBe(true);
  expect(names.has('node')).toBe(true); // targetName
  expect(names.size).toBe(4); // node, value, next, nodeRef (node is duplicate)
});

test('getAllUniqueNamesAndOptions - complex nested schema', () => {
  const ComplexSchema = schema(
    int('id', 0, 1000),
    enumeration('status', ['pending', 'active', 'completed']),
    object(
      'config',
      bool('enabled'),
      array('tags', 0, 5, enumeration('tag', ['important', 'urgent', 'normal'])),
      optional('metadata', object('meta', int('version', 0, 10), enumeration('type', ['alpha', 'beta', 'gamma'])))
    ),
    union('action', enumeration('actionType', ['create', 'update', 'delete']), {
      create: [int('initialValue', 0, 100)],
      update: [int('newValue', 0, 100), enumeration('updateMode', ['replace', 'merge'])],
      delete: [bool('cascade')]
    })
  );

  const names = getAllUniqueNamesAndOptions(ComplexSchema);

  // Top level
  expect(names.has('id')).toBe(true);
  expect(names.has('status')).toBe(true);
  expect(names.has('pending')).toBe(true);
  expect(names.has('active')).toBe(true);
  expect(names.has('completed')).toBe(true);

  // Config object
  expect(names.has('config')).toBe(true);
  expect(names.has('enabled')).toBe(true);
  expect(names.has('tags')).toBe(true);
  expect(names.has('tag')).toBe(true);
  expect(names.has('important')).toBe(true);
  expect(names.has('urgent')).toBe(true);
  expect(names.has('normal')).toBe(true);

  // Optional metadata
  expect(names.has('metadata')).toBe(true);
  expect(names.has('meta')).toBe(true);
  expect(names.has('version')).toBe(true);
  expect(names.has('type')).toBe(true);
  expect(names.has('alpha')).toBe(true);
  expect(names.has('beta')).toBe(true);
  expect(names.has('gamma')).toBe(true);

  // Union action
  expect(names.has('action')).toBe(true);
  expect(names.has('actionType')).toBe(true);
  expect(names.has('create')).toBe(true);
  expect(names.has('update')).toBe(true);
  expect(names.has('delete')).toBe(true);
  expect(names.has('initialValue')).toBe(true);
  expect(names.has('newValue')).toBe(true);
  expect(names.has('updateMode')).toBe(true);
  expect(names.has('replace')).toBe(true);
  expect(names.has('merge')).toBe(true);
  expect(names.has('cascade')).toBe(true);

  // Total unique names and options
  expect(names.size).toBeGreaterThan(25); // At least 31 unique entries
});

test('getAllUniqueNamesAndOptions - deduplicates shared names', () => {
  const DuplicateSchema = schema(
    enumeration('status', ['active', 'inactive']),
    object('data', enumeration('status', ['active', 'inactive', 'pending']))
  );

  const names = getAllUniqueNamesAndOptions(DuplicateSchema);

  // Should deduplicate 'status', 'active', and 'inactive'
  expect(names.has('status')).toBe(true);
  expect(names.has('active')).toBe(true);
  expect(names.has('inactive')).toBe(true);
  expect(names.has('pending')).toBe(true);
  expect(names.has('data')).toBe(true);
  expect(names.size).toBe(5); // status, active, inactive, pending, data (not 7)
});

test('getAllUniqueNamesAndOptions - empty schema', () => {
  const EmptySchema = schema();

  const names = getAllUniqueNamesAndOptions(EmptySchema);

  expect(names.size).toBe(0);
});

test('getAllUniqueNamesAndOptions - returns Set instance', () => {
  const SimpleSchema = schema(int('value', 0, 100));

  const names = getAllUniqueNamesAndOptions(SimpleSchema);

  expect(names).toBeInstanceOf(Set);
  expect(typeof names.has).toBe('function');
  expect(typeof names.add).toBe('function');
});

test('getAllUniqueNamesAndOptions - deeply nested structure', () => {
  const DeeplyNestedSchema = schema(
    object(
      'level1',
      object(
        'level2',
        object('level3', object('level4', int('deepValue', 0, 10), enumeration('deepEnum', ['x', 'y', 'z'])))
      )
    )
  );

  const names = getAllUniqueNamesAndOptions(DeeplyNestedSchema);

  expect(names.has('level1')).toBe(true);
  expect(names.has('level2')).toBe(true);
  expect(names.has('level3')).toBe(true);
  expect(names.has('level4')).toBe(true);
  expect(names.has('deepValue')).toBe(true);
  expect(names.has('deepEnum')).toBe(true);
  expect(names.has('x')).toBe(true);
  expect(names.has('y')).toBe(true);
  expect(names.has('z')).toBe(true);
  expect(names.size).toBe(9);
});

test('getAllUniqueNamesAndOptions - recursive schema with pointer', () => {
  const RecursiveSchema = schema(
    object(
      'tree',
      int('value', 0, 100),
      optional('left', pointer('leftChild', 'tree')),
      optional('right', pointer('rightChild', 'tree'))
    )
  );

  const names = getAllUniqueNamesAndOptions(RecursiveSchema);

  expect(names.has('tree')).toBe(true);
  expect(names.has('value')).toBe(true);
  expect(names.has('left')).toBe(true);
  expect(names.has('leftChild')).toBe(true);
  expect(names.has('right')).toBe(true);
  expect(names.has('rightChild')).toBe(true);
  // 'tree' appears as both field name and targetName, but Set deduplicates
  expect(names.size).toBe(6);
});

test('getAllUniqueNamesAndOptions - GLSL Ray Marching schema (real-world complex example)', () => {
  // Build the same complex schema from glsl-ray-marching.test.ts
  const GLSLRayMarchingSchema = schema(
    object(
      'Viewport',
      optional('CanvasFullScreen', object('Canvas', int('CanvasWidth', 200, 4200), int('CanvasHeight', 200, 4200))),
      object('Origin', fixed('X', -500, 500, 0.001), fixed('Y', -500, 500, 0.001), fixed('Z', -500, 500, 0.001)),
      object(
        'Euler Angles',
        fixed('Pitch', -180, 180, 0.1),
        fixed('Roll', -180, 180, 0.1),
        fixed('Yaw', -180, 180, 0.1)
      ),
      object(
        'Mouse Position',
        fixed('Rotation', 0, 360, 0.1),
        fixed('Zoom Level', 0.001, 1000, 0.001),
        object('Center Coordinate', fixed('Position X', -1, 1, 0.001), fixed('Position Y', -1, 1, 0.001))
      )
    ),
    object(
      'Methods',
      optional(
        'PreProcessing Methods',
        object(
          'PreMethod',
          enumeration('MethodEnumPre', preProcessingMethods),
          fixed('X Spacing', 0.1, 100, 0.001),
          fixed('Y Spacing', 0.1, 100, 0.001)
        )
      ),
      array(
        'Main Methods',
        1,
        3,
        object('MainMethod', enumeration('MainMethodEnum', mainMethods), fixed('MethodScale', 0.001, 1000, 0.001))
      ),
      optional(
        'PostProcessing Methods',
        object(
          'PostMethod',
          enumeration('MethodEnumPost', postProcessingMethods),
          fixed('MethodScale', 0.001, 1000, 0.001)
        )
      )
    ),
    object(
      'Shmuck',
      bool('Discrete Gradient'),
      array('Colour Count', 2, 10, object('Color', int('R', 0, 255), int('G', 0, 255), int('B', 0, 255)))
    )
  );

  const names = getAllUniqueNamesAndOptions(GLSLRayMarchingSchema);

  // Viewport object and fields
  expect(names.has('Viewport')).toBe(true);
  expect(names.has('CanvasFullScreen')).toBe(true);
  expect(names.has('Canvas')).toBe(true);
  expect(names.has('CanvasWidth')).toBe(true);
  expect(names.has('CanvasHeight')).toBe(true);
  expect(names.has('Origin')).toBe(true);
  expect(names.has('X')).toBe(true);
  expect(names.has('Y')).toBe(true);
  expect(names.has('Z')).toBe(true);
  expect(names.has('Euler Angles')).toBe(true);
  expect(names.has('Pitch')).toBe(true);
  expect(names.has('Roll')).toBe(true);
  expect(names.has('Yaw')).toBe(true);
  expect(names.has('Mouse Position')).toBe(true);
  expect(names.has('Rotation')).toBe(true);
  expect(names.has('Zoom Level')).toBe(true);
  expect(names.has('Center Coordinate')).toBe(true);
  expect(names.has('Position X')).toBe(true);
  expect(names.has('Position Y')).toBe(true);

  // Methods object
  expect(names.has('Methods')).toBe(true);
  expect(names.has('PreProcessing Methods')).toBe(true);
  expect(names.has('PreMethod')).toBe(true);
  expect(names.has('MethodEnumPre')).toBe(true);
  expect(names.has('Complex')).toBe(true);
  expect(names.has('Modulus')).toBe(true);
  expect(names.has('AlternatingMoldus')).toBe(true);
  expect(names.has('X Spacing')).toBe(true);
  expect(names.has('Y Spacing')).toBe(true);

  expect(names.has('Main Methods')).toBe(true);
  expect(names.has('MainMethod')).toBe(true);
  expect(names.has('MainMethodEnum')).toBe(true);
  expect(names.has('Gyroid')).toBe(true);
  expect(names.has('SchwarzD')).toBe(true);
  expect(names.has('SchwarzP')).toBe(true);
  expect(names.has('Perlin')).toBe(true);
  expect(names.has('Neovius')).toBe(true);
  expect(names.has('Mandelbrot')).toBe(true);
  expect(names.has('MethodScale')).toBe(true);

  expect(names.has('PostProcessing Methods')).toBe(true);
  expect(names.has('PostMethod')).toBe(true);
  expect(names.has('MethodEnumPost')).toBe(true);
  expect(names.has('Sine')).toBe(true);
  expect(names.has('Cosine')).toBe(true);

  // Shmuck object
  expect(names.has('Shmuck')).toBe(true);
  expect(names.has('Discrete Gradient')).toBe(true);
  expect(names.has('Colour Count')).toBe(true);
  expect(names.has('Color')).toBe(true);
  expect(names.has('R')).toBe(true);
  expect(names.has('G')).toBe(true);
  expect(names.has('B')).toBe(true);

  // Total count - verify we've collected a large number of unique names
  expect(names.size).toBeGreaterThan(45); // Should have 50+ unique field names and enum options

  // Log for debugging/documentation
  console.log(`GLSL Ray Marching schema collected ${names.size} unique names and options`);
  console.log('Sample names:', names);
});

test('GLSL Ray Marching schema - zstd compression comparison', async () => {
  // Build the GLSL Ray Marching schema
  const GLSLRayMarchingSchema = schema(
    object(
      'Viewport',
      optional('CanvasFullScreen', object('Canvas', int('CanvasWidth', 200, 4200), int('CanvasHeight', 200, 4200))),
      object('Origin', fixed('X', -500, 500, 0.001), fixed('Y', -500, 500, 0.001), fixed('Z', -500, 500, 0.001)),
      object(
        'Euler Angles',
        fixed('Pitch', -180, 180, 0.1),
        fixed('Roll', -180, 180, 0.1),
        fixed('Yaw', -180, 180, 0.1)
      ),
      object(
        'Mouse Position',
        fixed('Rotation', 0, 360, 0.1),
        fixed('Zoom Level', 0.001, 1000, 0.001),
        object('Center Coordinate', fixed('Position X', -1, 1, 0.001), fixed('Position Y', -1, 1, 0.001))
      )
    ),
    object(
      'Methods',
      optional(
        'PreProcessing Methods',
        object(
          'PreMethod',
          enumeration('MethodEnumPre', preProcessingMethods),
          fixed('X Spacing', 0.1, 100, 0.001),
          fixed('Y Spacing', 0.1, 100, 0.001)
        )
      ),
      array(
        'Main Methods',
        1,
        3,
        object('MainMethod', enumeration('MainMethodEnum', mainMethods), fixed('MethodScale', 0.001, 1000, 0.001))
      ),
      optional(
        'PostProcessing Methods',
        object(
          'PostMethod',
          enumeration('MethodEnumPost', postProcessingMethods),
          fixed('MethodScale', 0.001, 1000, 0.001)
        )
      )
    ),
    object(
      'Shmuck',
      bool('Discrete Gradient'),
      array('Colour Count', 2, 10, object('Color', int('R', 0, 255), int('G', 0, 255), int('B', 0, 255)))
    )
  );

  // Serialize schema to JSON
  const schemaJson = JSON.stringify(GLSLRayMarchingSchema);
  const schemaBytes = new TextEncoder().encode(schemaJson);

  // Initialize zstd
  const zstd = await new Promise<any>((resolve) => {
    ZstdCodec.run((zstdInstance: any) => {
      resolve(zstdInstance);
    });
  });

  // Compress with zstd using Simple API (instantiate the class)
  const simple = new zstd.Simple();
  const compressedBytes = simple.compress(schemaBytes);

  // Calculate compression stats
  const originalSize = schemaBytes.length;
  const compressedSize = compressedBytes.length;
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

  console.log('\n=== GLSL Ray Marching Schema Compression Stats ===');
  console.log(`Original JSON size: ${originalSize} bytes`);
  console.log(`Compressed (zstd): ${compressedSize} bytes`);
  console.log(`Compression ratio: ${compressionRatio}% reduction`);
  console.log(`Size factor: ${(originalSize / compressedSize).toFixed(2)}x smaller`);

  // Verify decompression works
  const decompressedBytes = simple.decompress(compressedBytes);
  const decompressedJson = new TextDecoder().decode(decompressedBytes);
  const decompressedSchema = JSON.parse(decompressedJson);

  // Verify round-trip integrity
  expect(decompressedSchema).toEqual(GLSLRayMarchingSchema);
  expect(decompressedJson).toBe(schemaJson);

  // Verify compression is significant
  expect(compressedSize).toBeLessThan(originalSize);
  expect(compressedSize).toBeLessThan(originalSize * 0.5); // At least 50% compression
});
