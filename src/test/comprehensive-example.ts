import { schema, bool, int, fixed, enumeration, array, optional, object, union } from '../schema';
import { densing, undensing } from '../densing';
import { getDefaultData } from '../schema/default-data';

// Example: IoT Device Configuration Schema
const DeviceConfigSchema = schema(
  // Basic device info
  int('deviceId', 0, 65535),
  enumeration('deviceType', ['sensor', 'actuator', 'gateway']),
  // Optional device name (saves space when not used)
  optional('customName', int('nameId', 0, 1000), undefined),
  // Network settings object
  object(
    'network',
    bool('dhcp'),
    optional('staticIp', array('ipAddress', 4, 4, int('ipAddress', 0, 255))),
    int('port', 1024, 65535)
  ),
  // Sensor configuration (union type)
  union('sensorConfig', enumeration('type', ['temperature', 'humidity', 'motion']), {
    temperature: [fixed('minTemp', -40, 125, 0.1), fixed('maxTemp', -40, 125, 0.1), int('sampleRate', 1, 3600)],
    humidity: [int('minHumidity', 0, 100), int('maxHumidity', 0, 100), int('sampleRate', 1, 3600)],
    motion: [bool('continuousMode'), int('sensitivity', 0, 100)]
  }),
  // Optional calibration data
  optional('calibration', object('cal', fixed('offset', -10, 10, 0.01), fixed('scale', 0.5, 2.0, 0.001)), undefined),
  // Array of alert thresholds
  array('alerts', 0, 5, object('alert', int('threshold', 0, 1000), bool('enabled')))
);

// Example 1: Temperature sensor with full configuration
console.log('\n=== Example 1: Temperature Sensor (Full Config) ===');
const tempSensorData = {
  deviceId: 12345,
  deviceType: 'sensor',
  customName: 42,
  network: {
    dhcp: false,
    staticIp: [192, 168, 1, 1],
    port: 8080
  },
  sensorConfig: {
    type: 'temperature', // Union discriminator uses string literal
    minTemp: -10.0,
    maxTemp: 50.0,
    sampleRate: 60
  },
  calibration: {
    offset: 0.5,
    scale: 1.02
  },
  alerts: [
    { threshold: 30, enabled: true },
    { threshold: 40, enabled: true }
  ]
};

const encoded1 = densing(DeviceConfigSchema, tempSensorData);
const decoded1 = undensing(DeviceConfigSchema, encoded1);

console.log('Original:', JSON.stringify(tempSensorData, null, 2));
console.log('Encoded:', encoded1, `(${encoded1.length} chars)`);
console.log('Decoded:', JSON.stringify(decoded1, null, 2));
console.log('Match:', JSON.stringify(tempSensorData) === JSON.stringify(decoded1) ? '✓' : '✗');

// Example 2: Motion sensor with minimal configuration
console.log('\n=== Example 2: Motion Sensor (Minimal Config) ===');
const motionSensorData = {
  deviceId: 54321,
  deviceType: 'sensor',
  customName: null, // Not set
  network: {
    dhcp: true,
    staticIp: null, // Using DHCP
    port: 1883
  },
  sensorConfig: {
    type: 'motion', // Union discriminator uses string
    continuousMode: true,
    sensitivity: 75
  },
  calibration: null, // No calibration needed
  alerts: [] // No alerts
};

const encoded2 = densing(DeviceConfigSchema, motionSensorData);
const decoded2 = undensing(DeviceConfigSchema, encoded2);

console.log('Original:', JSON.stringify(motionSensorData, null, 2));
console.log('Encoded:', encoded2, `(${encoded2.length} chars)`);
console.log('Decoded:', JSON.stringify(decoded2, null, 2));
console.log('Match:', JSON.stringify(motionSensorData) === JSON.stringify(decoded2) ? '✓' : '✗');

// Example 3: Default configuration
console.log('\n=== Example 3: Default Configuration ===');
const defaultConfig = getDefaultData(DeviceConfigSchema);

console.log('Default:', JSON.stringify(defaultConfig, null, 2));

const encoded3 = densing(DeviceConfigSchema, defaultConfig);
const decoded3 = undensing(DeviceConfigSchema, encoded3);

console.log('Encoded:', encoded3, `(${encoded3.length} chars)`);
console.log('Decoded:', JSON.stringify(decoded3, null, 2));
console.log('Match:', JSON.stringify(defaultConfig) === JSON.stringify(decoded3) ? '✓' : '✗');

// Example 4: Space savings comparison
console.log('\n=== Space Savings Comparison ===');
console.log(`Full config JSON:     ${JSON.stringify(tempSensorData).length} bytes`);
console.log(`Full config Base64:   ${encoded1.length} chars`);
console.log(`Minimal config JSON:  ${JSON.stringify(motionSensorData).length} bytes`);
console.log(`Minimal config Base64: ${encoded2.length} chars`);
console.log(
  `\nBase64 encoding provides ~${Math.round(
    (1 - encoded1.length / JSON.stringify(tempSensorData).length) * 100
  )}% size reduction`
);
console.log(`Optional fields save additional ${encoded1.length - encoded2.length} chars when not used`);

export { DeviceConfigSchema };
