import { expect, test } from 'bun:test';
import { schema, bool, int, fixed, enumeration, array, optional, object, union } from '../schema';
import { densing, undensing } from '../densing';
import { getDefaultData } from '../schema/default-data';

// IoT Device Configuration Schema
const DeviceConfigSchema = schema(
  // Basic device info
  int('deviceId', 0, 65535),
  enumeration('deviceType', ['sensor', 'actuator', 'gateway']),
  // Optional device name (saves space when not used)
  optional('customName', int('nameId', 0, 1000), undefined),
  // Network settings object
  object('network', bool('dhcp'), optional('staticIp', array('ipAddress', 4, 4, int('ipAddress', 0, 255))), int('port', 1024, 65535)),
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

test('IoT device - temperature sensor with full configuration', () => {
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
      type: 'temperature',
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

  const encoded = densing(DeviceConfigSchema, tempSensorData);
  const decoded = undensing(DeviceConfigSchema, encoded);

  expect(encoded.length).toBeGreaterThan(0);
  expect(decoded.deviceId).toBe(12345);
  expect(decoded.deviceType).toBe('sensor');
  expect(decoded.sensorConfig.type).toBe('temperature');
  expect(decoded.sensorConfig.minTemp).toBeCloseTo(-10.0, 1);
  expect(decoded.sensorConfig.maxTemp).toBeCloseTo(50.0, 1);
  expect(decoded.alerts.length).toBe(2);
});

test('IoT device - motion sensor with minimal configuration', () => {
  const motionSensorData = {
    deviceId: 54321,
    deviceType: 'sensor',
    customName: null,
    network: {
      dhcp: true,
      staticIp: null,
      port: 1883
    },
    sensorConfig: {
      type: 'motion',
      continuousMode: true,
      sensitivity: 75
    },
    calibration: null,
    alerts: []
  };

  const encoded = densing(DeviceConfigSchema, motionSensorData);
  const decoded = undensing(DeviceConfigSchema, encoded);

  expect(decoded.deviceId).toBe(54321);
  expect(decoded.deviceType).toBe('sensor');
  expect(decoded.customName).toBeNull();
  expect(decoded.network.dhcp).toBe(true);
  expect(decoded.network.staticIp).toBeNull();
  expect(decoded.sensorConfig.type).toBe('motion');
  expect(decoded.calibration).toBeNull();
  expect(decoded.alerts).toEqual([]);
});

test('IoT device - default configuration', () => {
  const defaultConfig = getDefaultData(DeviceConfigSchema);

  const encoded = densing(DeviceConfigSchema, defaultConfig);
  const decoded = undensing(DeviceConfigSchema, encoded);

  expect(decoded).toMatchObject(defaultConfig);
  expect(decoded.deviceId).toBe(0);
  expect(decoded.deviceType).toBe('sensor');
});

test('IoT device - space savings vs JSON', () => {
  const fullConfig = {
    deviceId: 12345,
    deviceType: 'sensor',
    customName: 42,
    network: {
      dhcp: false,
      staticIp: [192, 168, 1, 1],
      port: 8080
    },
    sensorConfig: {
      type: 'temperature',
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

  const minimalConfig = {
    deviceId: 54321,
    deviceType: 'sensor',
    customName: null,
    network: {
      dhcp: true,
      staticIp: null,
      port: 1883
    },
    sensorConfig: {
      type: 'motion',
      continuousMode: true,
      sensitivity: 75
    },
    calibration: null,
    alerts: []
  };

  const encodedFull = densing(DeviceConfigSchema, fullConfig);
  const encodedMinimal = densing(DeviceConfigSchema, minimalConfig);

  const jsonFull = JSON.stringify(fullConfig);
  const jsonMinimal = JSON.stringify(minimalConfig);

  // Base64 encoding should be significantly smaller
  expect(encodedFull.length).toBeLessThan(jsonFull.length);
  expect(encodedMinimal.length).toBeLessThan(jsonMinimal.length);

  // Optional fields should save space
  expect(encodedMinimal.length).toBeLessThan(encodedFull.length);
});
