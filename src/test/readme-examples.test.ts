// readme-examples.test.ts - Test all examples from README.md
import { test, expect } from 'bun:test';
import {
  schema,
  int,
  bool,
  fixed,
  enumeration,
  densing,
  undensing,
  optional,
  object,
  array,
  union,
  enumArray,
  validate,
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  getDefaultData,
  generateTypes,
  pointer
} from '../index';

const testResultComparisonMethod = (encoded: string, data: any, bitsInfo: string) =>
  `"${encoded}" (${bitsInfo} bits, ${encoded.length} base64 chars vs JSON ${
    JSON.stringify(data).length
  } chars, -${Math.round((1 - encoded.length / JSON.stringify(data).length) * 100)}%)`;

// ===== Quick Start Example =====
test('Quick Start - DeviceSchema', () => {
  const DeviceSchema = schema(
    int('deviceId', 0, 1000), // 10 bits (0-1000)
    bool('enabled'), // 1 bit
    fixed('temperature', -40, 125, 0.1), // 11 bits (-40 to 125, precision 0.1)
    enumeration('mode', ['eco', 'normal', 'performance']) // 2 bits (3 options)
  );
  // total of 24 bits

  const data = {
    deviceId: 42,
    enabled: true,
    temperature: 23.5,
    mode: 'performance'
  };

  const encoded = densing(DeviceSchema, data);

  // Verify it's 24 bits (4 base64 chars)
  const sizeInfo = calculateDenseDataSize(DeviceSchema, data);
  console.log(`Quick Start: ${testResultComparisonMethod(encoded, data, sizeInfo.totalBits.toString())}`);

  const decoded = undensing(DeviceSchema, encoded);
  expect(decoded).toEqual(data);

  expect(sizeInfo.totalBits).toBe(24);
  expect(encoded.length).toBe(4); // 24 bits = 4 base64 chars

  expect(encoded).toBe('Cqnu');
  expect(undensing(DeviceSchema, 'Cqnu')).toEqual(data);
});

// ===== Schema Definition Examples =====
test('Schema Definition - MySchema', () => {
  const MySchema = schema(
    int('id', 0, 1000), // 10 bits for 1001 possible values
    fixed('price', 0, 100, 0.01), // 14 bits for $0.00 to $100.00
    bool('active'),
    enumeration('status', ['pending', 'active', 'done']) // 2 bits for 3 options
  );

  const data = { id: 500, price: 49.99, active: true, status: 'active' };
  const encoded = densing(MySchema, data);
  const decoded = undensing(MySchema, encoded);

  expect(decoded).toEqual(data);
  const sizeInfo = calculateDenseDataSize(MySchema, data);
  console.log(`Schema Definition: ${testResultComparisonMethod(encoded, data, sizeInfo.totalBits.toString())}`);
});

// ===== Optional Fields Example =====
test('Optional Fields', () => {
  const UserSchema = schema(int('id', 0, 10000), optional('age', int('ageValue', 0, 120)));

  // With age
  const dataWithAge = { id: 100, age: 25 };
  const encodedWithAge = densing(UserSchema, dataWithAge);
  const decodedWithAge = undensing(UserSchema, encodedWithAge);
  expect(decodedWithAge).toEqual(dataWithAge);

  const sizeWithAge = calculateDenseDataSize(UserSchema, dataWithAge);
  expect(sizeWithAge.totalBits).toBe(14 + 1 + 7); // 14 bits id + 1 presence + 7 bits age
  console.log(
    `Optional with age: ${testResultComparisonMethod(encodedWithAge, dataWithAge, sizeWithAge.totalBits.toString())}`
  );

  // Without age
  const dataWithoutAge = { id: 100, age: null };
  const encodedWithoutAge = densing(UserSchema, dataWithoutAge);
  const decodedWithoutAge = undensing(UserSchema, encodedWithoutAge);
  expect(decodedWithoutAge).toEqual(dataWithoutAge);

  const sizeWithoutAge = calculateDenseDataSize(UserSchema, dataWithoutAge);
  expect(sizeWithoutAge.totalBits).toBe(14 + 1); // 14 bits id + 1 presence bit
  console.log(
    `Optional without age: ${testResultComparisonMethod(
      encodedWithoutAge,
      dataWithoutAge,
      sizeWithoutAge.totalBits.toString()
    )}`
  );
});

// ===== Nested Objects Example =====
test('Nested Objects', () => {
  const ConfigSchema = schema(int('version', 1, 10), object('settings', bool('darkMode'), int('fontSize', 8, 24)));

  const data = {
    version: 2,
    settings: {
      darkMode: true,
      fontSize: 14
    }
  };

  const encoded = densing(ConfigSchema, data);
  const decoded = undensing(ConfigSchema, encoded);
  expect(decoded).toEqual(data);
  const sizeInfo = calculateDenseDataSize(ConfigSchema, data);
  console.log(`Nested objects: ${testResultComparisonMethod(encoded, data, sizeInfo.totalBits.toString())}`);
});

// ===== Arrays Example =====
test('Arrays', () => {
  const ListSchema = schema(array('scores', 0, 10, int('score', 0, 100)));

  const data1 = { scores: [95] }; // 4 + 7 bits -> 11 bits -> 2 characters vs 13 (-85%) => "G-"
  const data2 = { scores: [95, 87, 92, 88] }; // 4 + 4 * 7 bits -> 32 bits -> 6 characters vs 22 (-73%) => "S_XuWA"
  const data3 = { scores: [95, 87, 92, 88, 10, 12, 13, 15, 16, 99] }; // 4 + 10 * 7 bits -> 74 bits -> 13 characters vs 40 (-83%) => "q_XuWBQwaPIYw"

  const encoded1 = densing(ListSchema, data1);
  const encoded2 = densing(ListSchema, data2);
  const encoded3 = densing(ListSchema, data3);

  const decoded1 = undensing(ListSchema, encoded1);
  const decoded2 = undensing(ListSchema, encoded2);
  const decoded3 = undensing(ListSchema, encoded3);

  expect(decoded1).toEqual(data1);
  expect(decoded2).toEqual(data2);
  expect(decoded3).toEqual(data3);

  expect(encoded1).toBe('G-');
  expect(encoded2).toBe('S_XuWA');
  expect(encoded3).toBe('q_XuWBQwaPIYw');

  expect(undensing(ListSchema, 'G-')).toEqual(data1);
  expect(undensing(ListSchema, 'S_XuWA')).toEqual(data2);
  expect(undensing(ListSchema, 'q_XuWBQwaPIYw')).toEqual(data3);

  const sizeInfo1 = calculateDenseDataSize(ListSchema, data1);
  const sizeInfo2 = calculateDenseDataSize(ListSchema, data2);
  const sizeInfo3 = calculateDenseDataSize(ListSchema, data3);

  console.log(`Array [95]: ${testResultComparisonMethod(encoded1, data1, sizeInfo1.totalBits.toString())}`);
  console.log(`Array [95,87,92,88]: ${testResultComparisonMethod(encoded2, data2, sizeInfo2.totalBits.toString())}`);
  console.log(
    `Array [95,87,92,88,10,12,13,15,16,99]: ${testResultComparisonMethod(
      encoded3,
      data3,
      sizeInfo3.totalBits.toString()
    )}`
  );
});

// ===== Unions Example =====
test('Unions (Polymorphic Types)', () => {
  const ActionSchema = schema(
    union('action', enumeration('type', ['start', 'stop', 'pause']), {
      start: [int('delay', 0, 60)],
      stop: [bool('force')],
      pause: [int('duration', 0, 3600)]
    })
  );

  // Start action
  const startData = { action: { type: 'start', delay: 5 } };
  const startEncoded = densing(ActionSchema, startData);
  const startDecoded = undensing(ActionSchema, startEncoded);
  expect(startDecoded).toEqual(startData);
  const startSize = calculateDenseDataSize(ActionSchema, startData);
  console.log(`Union (start): ${testResultComparisonMethod(startEncoded, startData, startSize.totalBits.toString())}`);

  // Stop action
  const stopData = { action: { type: 'stop', force: true } };
  const stopEncoded = densing(ActionSchema, stopData);
  const stopDecoded = undensing(ActionSchema, stopEncoded);
  expect(stopDecoded).toEqual(stopData);
  const stopSize = calculateDenseDataSize(ActionSchema, stopData);
  console.log(`Union (stop): ${testResultComparisonMethod(stopEncoded, stopData, stopSize.totalBits.toString())}`);

  // Pause action
  const pauseData = { action: { type: 'pause', duration: 1234 } };
  const pauseEncoded = densing(ActionSchema, pauseData);
  const pauseDecoded = undensing(ActionSchema, pauseEncoded);
  expect(pauseDecoded).toEqual(pauseData);
  const pauseSize = calculateDenseDataSize(ActionSchema, pauseData);
  console.log(`Union (pause): ${testResultComparisonMethod(pauseEncoded, pauseData, pauseSize.totalBits.toString())}`);

  // Additional union examples from README
  const pause0Data = { action: { type: 'pause', duration: 0 } };
  const pause0Encoded = densing(ActionSchema, pause0Data);
  expect(undensing(ActionSchema, pause0Encoded)).toEqual(pause0Data);
  const pause0Size = calculateDenseDataSize(ActionSchema, pause0Data);
  console.log(
    `Union (pause 0): ${testResultComparisonMethod(pause0Encoded, pause0Data, pause0Size.totalBits.toString())}`
  );

  const start60Data = { action: { type: 'start', delay: 60 } };
  const start60Encoded = densing(ActionSchema, start60Data);
  expect(undensing(ActionSchema, start60Encoded)).toEqual(start60Data);
  const start60Size = calculateDenseDataSize(ActionSchema, start60Data);
  console.log(
    `Union (start 60): ${testResultComparisonMethod(start60Encoded, start60Data, start60Size.totalBits.toString())}`
  );

  const stopFalseData = { action: { type: 'stop', force: false } };
  const stopFalseEncoded = densing(ActionSchema, stopFalseData);
  expect(undensing(ActionSchema, stopFalseEncoded)).toEqual(stopFalseData);
  const stopFalseSize = calculateDenseDataSize(ActionSchema, stopFalseData);
  console.log(
    `Union (stop false): ${testResultComparisonMethod(
      stopFalseEncoded,
      stopFalseData,
      stopFalseSize.totalBits.toString()
    )}`
  );
});

// ===== Enum Arrays Example =====
test('Enum Arrays (Packed)', () => {
  const ColorSchema = schema(enumArray('palette', enumeration('color', ['R', 'G', 'B']), 0, 10));

  const data = { palette: ['R', 'G', 'B', 'R', 'R'] };
  const encoded = densing(ColorSchema, data);
  const decoded = undensing(ColorSchema, encoded);
  expect(decoded).toEqual(data);

  const sizeInfo = calculateDenseDataSize(ColorSchema, data);
  console.log(`Enum array: ${testResultComparisonMethod(encoded, data, sizeInfo.totalBits.toString())}`);
  // Verify packed encoding
  expect(sizeInfo.totalBits).toBeLessThanOrEqual(4 + 8); // 4 bits length + ~8 bits content
});

// ===== Validation Example =====
test('Validation', () => {
  const MySchema = schema(int('age', 0, 120), bool('active'));

  // Valid data
  const validData = { age: 25, active: true };
  const validResult = validate(MySchema, validData);
  expect(validResult.valid).toBe(true);
  expect(validResult.errors).toEqual([]);

  // Invalid data
  const invalidData = { age: 150, active: true };
  const invalidResult = validate(MySchema, invalidData);
  expect(invalidResult.valid).toBe(false);
  expect(invalidResult.errors.length).toBeGreaterThan(0);
  expect(invalidResult.errors[0].path).toBe('age');
  console.log(`Validation error: ${invalidResult.errors[0].message}`);
});

// ===== Size Analysis Example =====
test('Size Analysis', () => {
  const MySchema = schema(int('deviceId', 0, 1000), bool('enabled'), optional('metadata', int('version', 0, 10)));

  // Static analysis
  const schemaSize = analyzeDenseSchemaSize(MySchema);
  console.log('Static size range:', schemaSize.staticRange);
  expect(schemaSize.staticRange.minBits).toBeGreaterThan(0);
  expect(schemaSize.staticRange.maxBits).toBeGreaterThanOrEqual(schemaSize.staticRange.minBits);

  // Actual size for specific data
  const myData = { deviceId: 42, enabled: true, metadata: 5 };
  const dataSize = calculateDenseDataSize(MySchema, myData);
  console.log('Data size:', dataSize);
  expect(dataSize.totalBits).toBeGreaterThan(0);
  expect(dataSize.fieldSizes.deviceId).toBe(10); // log2(1001) ≈ 10 bits
  expect(dataSize.fieldSizes.enabled).toBe(1);
  expect(dataSize.fieldSizes.metadata).toBeGreaterThan(1); // 1 presence + bits for value
});

// ===== Default Values Example =====
test('Default Values', () => {
  const MySchema = schema(
    int('deviceId', 0, 1000),
    bool('enabled'),
    fixed('temperature', -40, 125, 0.1),
    enumeration('mode', ['eco', 'normal', 'performance'])
  );

  const defaultData = getDefaultData(MySchema);
  expect(defaultData.deviceId).toBe(0);
  expect(defaultData.enabled).toBe(false);
  expect(defaultData.temperature).toBe(-40);
  expect(defaultData.mode).toBe('eco');
  console.log('Default data:', defaultData);
});

// ===== Type Generation Example =====
test('Type Generation', () => {
  const MySchema = schema(
    int('deviceId', 0, 1000),
    bool('enabled'),
    enumeration('mode', ['eco', 'normal', 'performance'])
  );

  const types = generateTypes(MySchema, 'MyData');
  expect(types).toContain('export interface MyData');
  expect(types).toContain('deviceId: number;');
  expect(types).toContain('enabled: boolean;');
  expect(types).toContain("mode: 'eco' | 'normal' | 'performance';");
  console.log('Generated types:\n', types);
});

// ===== Custom Bases Example =====
test('Custom Bases', () => {
  const TestSchema = schema(int('value', 0, 100));
  const data = { value: 42 };

  // Default: base64url
  const base64 = densing(TestSchema, data);
  console.log(`Base64url: "${base64}"`);

  // Binary string
  const binary = densing(TestSchema, data, 'binary');
  console.log(`Binary: "${binary}"`);
  expect(binary).toMatch(/^[01]+$/);

  // Decode with same base
  const decodedBinary = undensing(TestSchema, binary, 'binary');
  expect(decodedBinary).toEqual(data);

  // Custom base (hexadecimal)
  const hex = densing(TestSchema, data, '0123456789ABCDEF');
  console.log(`Hex: "${hex}"`);
  const decodedHex = undensing(TestSchema, hex, '0123456789ABCDEF');
  expect(decodedHex).toEqual(data);
});

// ===== Recursive Structures Example =====
test('Recursive Structures', () => {
  const ExpressionSchema = schema(
    union('expr', enumeration('type', ['number', 'add', 'multiply']), {
      number: [int('value', 0, 1000)],
      add: [pointer('left', 'expr'), pointer('right', 'expr')],
      multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
    })
  );

  // Encode: (5 + 3) * 2
  const data = {
    expr: {
      type: 'multiply',
      left: {
        type: 'add',
        left: { type: 'number', value: 5 },
        right: { type: 'number', value: 3 }
      },
      right: { type: 'number', value: 2 }
    }
  };

  const encoded = densing(ExpressionSchema, data);
  const decoded = undensing(ExpressionSchema, encoded);
  expect(decoded).toEqual(data);
  const sizeInfo = calculateDenseDataSize(ExpressionSchema, data);
  console.log(`Recursive structure: ${testResultComparisonMethod(encoded, data, sizeInfo.totalBits.toString())}`);
});

// ===== Use Case: URL Parameters =====
test('Use Case - URL Parameters', () => {
  const StateSchema = schema(
    int('page', 1, 100),
    enumeration('sortBy', ['date', 'name', 'size']),
    array('filters', 0, 5, int('filterId', 0, 10))
  );

  const state = {
    page: 5,
    sortBy: 'date',
    filters: [1, 3]
  };

  const encoded = densing(StateSchema, state);
  const url = `https://app.com/search?state=${encoded}`;
  const sizeInfo = calculateDenseDataSize(StateSchema, state);
  console.log(`URL state: ${testResultComparisonMethod(encoded, state, sizeInfo.totalBits.toString())}`);
  console.log(`URL: ${url}`);
  expect(url.length).toBeLessThan(100); // Should be compact

  // Decode from URL
  const params = new URLSearchParams(`state=${encoded}`);
  const decoded = undensing(StateSchema, params.get('state')!);
  expect(decoded).toEqual(state);
});

// ===== Use Case: IoT Sensor Data =====
test('Use Case - IoT Sensor Data', () => {
  const SensorSchema = schema(fixed('temp', -40, 125, 0.1), fixed('humidity', 0, 100, 0.1), int('battery', 0, 100));

  const sensorData = { temp: 23.5, humidity: 65.2, battery: 87 };
  const payload = densing(SensorSchema, sensorData);

  const sizeInfo = calculateDenseDataSize(SensorSchema, sensorData);
  console.log(`IoT payload: ${testResultComparisonMethod(payload, sensorData, sizeInfo.totalBits.toString())}`);

  const decoded = undensing(SensorSchema, payload);
  expect(decoded.temp).toBeCloseTo(sensorData.temp, 1);
  expect(decoded.humidity).toBeCloseTo(sensorData.humidity, 1);
  expect(decoded.battery).toBe(sensorData.battery);
});

// ===== Comprehensive Real-World Example =====
test('Real-World - Complex Config Schema', () => {
  const ComplexConfigSchema = schema(
    int('version', 1, 100),
    object('network', int('port', 1024, 65535), bool('secure'), optional('timeout', int('timeoutValue', 0, 300))),
    array('users', 0, 10, object('user', int('id', 0, 10000), enumeration('role', ['admin', 'user', 'guest']))),
    union('storage', enumeration('type', ['local', 'cloud', 's3']), {
      local: [int('maxSize', 0, 1000)],
      cloud: [bool('encrypted')],
      s3: [int('bucket', 0, 100), bool('versioning')]
    })
  );

  const config = {
    version: 2,
    network: {
      port: 8080,
      secure: true,
      timeout: 30
    },
    users: [
      { id: 1, role: 'admin' },
      { id: 2, role: 'user' }
    ],
    storage: {
      type: 's3',
      bucket: 5,
      versioning: true
    }
  };

  const encoded = densing(ComplexConfigSchema, config);
  const sizeInfo = calculateDenseDataSize(ComplexConfigSchema, config);
  console.log(`Complex config: ${testResultComparisonMethod(encoded, config, sizeInfo.totalBits.toString())}`);

  const decoded = undensing(ComplexConfigSchema, encoded);
  expect(decoded).toEqual(config);

  // Verify it's actually compact - at least 50% smaller than JSON
  const jsonSize = JSON.stringify(config).length;
  expect(encoded.length).toBeLessThan(jsonSize / 2);
});
