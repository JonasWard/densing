import { schema, bool, int, fixed, enumeration, array, optional, object, union } from '../schema/builder';
import { generateTypes, printTypes } from '../schema/type-generator';

console.log('=== Type Generator Demo ===\n');

// Example 1: Simple schema
console.log('1. Simple Schema:');
const SimpleSchema = schema(int('id', 0, 10000), bool('active', true), fixed('score', 0, 100, 0.1));

printTypes(SimpleSchema, 'SimpleData');

// Example 2: Schema with optional fields
console.log('\n2. Schema with Optional Fields:');
const OptionalSchema = schema(
  int('userId', 0, 10000),
  optional('nickname', int('value', 0, 1000)),
  bool('verified', false)
);

printTypes(OptionalSchema, 'UserData');

// Example 3: Schema with nested objects
console.log('\n3. Schema with Nested Objects:');
const NestedSchema = schema(
  int('version', 1, 100),
  object('settings', bool('enabled', true), int('timeout', 0, 5000), optional('retries', int('value', 0, 10))),
  object('metadata', int('created', 0, 2147483647), int('updated', 0, 2147483647))
);

printTypes(NestedSchema, 'ConfigData');

// Example 4: Schema with unions
console.log('\n4. Schema with Union Types:');
const UnionSchema = schema(
  union('message', enumeration('type', ['text', 'image', 'video']), {
    text: [int('length', 0, 1000)],
    image: [int('width', 0, 4096), int('height', 0, 4096)],
    video: [int('duration', 0, 3600), int('bitrate', 0, 100)]
  })
);

printTypes(UnionSchema, 'MessageData');

// Example 5: Complex nested schema
console.log('\n5. Complex Nested Schema:');
const ComplexSchema = schema(
  int('deviceId', 0, 65535),
  enumeration('deviceType', ['sensor', 'actuator', 'gateway']),
  optional('customName', int('nameId', 0, 1000)),
  object('network', bool('dhcp'), optional('staticIp', int('ipAddress', 0, 4294967295)), int('port', 1024, 65535)),
  union('sensorConfig', enumeration('type', ['temperature', 'humidity', 'motion']), {
    temperature: [fixed('minTemp', -40, 125, 0.1), fixed('maxTemp', -40, 125, 0.1)],
    humidity: [int('minHumidity', 0, 100), int('maxHumidity', 0, 100)],
    motion: [bool('continuousMode'), int('sensitivity', 0, 100)]
  }),
  array('alerts', 0, 5, object('alert', int('threshold', 0, 1000), bool('enabled')))
);

printTypes(ComplexSchema, 'DeviceConfig');

// Example 6: Save to variable
console.log('\n6. Generated Types as String:');
const typeDefinitions = generateTypes(ComplexSchema, 'DeviceConfig');
console.log('Type definitions length:', typeDefinitions.length, 'characters');
console.log('Can be saved to a .d.ts file!');
