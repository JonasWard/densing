import { expect, test } from 'bun:test';
import { schema, int, enumeration, optional, object, bool, array, union, fixed } from '../schema/builder';
import { encodeDebugWrapper, decodeDebugWrapper } from './test-helper';

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

test('optional field - present value', () => {
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

  const encoded1 = encodeDebugWrapper(DeviceConfigSchema, tempSensorData, 'ipAddress');
  const decoded1 = decodeDebugWrapper(DeviceConfigSchema, encoded1!, 'ipAddress');
  // return;

  console.log('Original:', JSON.stringify(tempSensorData, null, 2));
  console.log('Encoded:', encoded1, `(${encoded1!.length} chars)`);
  console.log('Decoded:', JSON.stringify(decoded1, null, 2));
  console.log('Match:', JSON.stringify(tempSensorData) === JSON.stringify(decoded1) ? '✓' : '✗');

  expect(decoded1).toEqual(tempSensorData); // expect the decoded data to equal the original data
});
