import { expect, test } from 'bun:test';
import { schema, bool, int, fixed, enumeration, array, optional, object, union } from '../schema/builder';
import { generateTypes, printTypes } from '../schema/type-generator';

test('type generator - simple schema', () => {
  const SimpleSchema = schema(int('id', 0, 10000), bool('active', true), fixed('score', 0, 100, 0.1));

  const types = generateTypes(SimpleSchema, 'SimpleData');

  expect(types).toContain('export interface SimpleData');
  expect(types).toContain('id: number');
  expect(types).toContain('active: boolean');
  expect(types).toContain('score: number');
});

test('type generator - schema with optional fields', () => {
  const OptionalSchema = schema(int('userId', 0, 10000), optional('nickname', int('value', 0, 1000)), bool('verified', false));

  const types = generateTypes(OptionalSchema, 'UserData');

  expect(types).toContain('export interface UserData');
  expect(types).toContain('userId: number');
  expect(types).toContain('nickname: number | null');
  expect(types).toContain('verified: boolean');
});

test('type generator - schema with nested objects', () => {
  const NestedSchema = schema(
    int('version', 1, 100),
    object('settings', bool('enabled', true), int('timeout', 0, 5000), optional('retries', int('value', 0, 10))),
    object('metadata', int('created', 0, 2147483647), int('updated', 0, 2147483647))
  );

  const types = generateTypes(NestedSchema, 'ConfigData');

  expect(types).toContain('export interface ConfigData');
  expect(types).toContain('version: number');
  expect(types).toContain('settings:');
  expect(types).toContain('metadata:');
  expect(types).toContain('enabled: boolean');
  expect(types).toContain('timeout: number');
  expect(types).toContain('retries: number | null');
});

test('type generator - schema with unions', () => {
  const UnionSchema = schema(
    union('message', enumeration('type', ['text', 'image', 'video']), {
      text: [int('length', 0, 1000)],
      image: [int('width', 0, 4096), int('height', 0, 4096)],
      video: [int('duration', 0, 3600), int('bitrate', 0, 100)]
    })
  );

  const types = generateTypes(UnionSchema, 'MessageData');

  expect(types).toContain('export interface MessageData');
  expect(types).toContain('message:');
  expect(types).toContain("type: 'text'");
  expect(types).toContain("type: 'image'");
  expect(types).toContain("type: 'video'");
  expect(types).toContain('length: number');
  expect(types).toContain('width: number');
  expect(types).toContain('height: number');
  expect(types).toContain('duration: number');
  expect(types).toContain('bitrate: number');
});

test('type generator - complex nested schema', () => {
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

  const types = generateTypes(ComplexSchema, 'DeviceConfig');

  expect(types).toContain('export interface DeviceConfig');
  expect(types).toContain('deviceId: number');
  expect(types).toContain("deviceType: 'sensor' | 'actuator' | 'gateway'");
  expect(types).toContain('customName: number | null');
  expect(types).toContain('network:');
  expect(types).toContain('dhcp: boolean');
  expect(types).toContain('sensorConfig:');
  expect(types).toContain("type: 'temperature'");
  expect(types).toContain("type: 'humidity'");
  expect(types).toContain("type: 'motion'");
  expect(types).toContain('alerts:');
});

test('type generator - printTypes does not throw', () => {
  const SimpleSchema = schema(int('id', 0, 100));

  // Should not throw when printing
  expect(() => printTypes(SimpleSchema, 'TestData')).not.toThrow();
});

test('type generator - generates valid TypeScript', () => {
  const Schema = schema(
    int('count', 0, 100),
    bool('active'),
    enumeration('status', ['pending', 'active', 'complete']),
    array('tags', 0, 10, int('tag', 0, 255))
  );

  const types = generateTypes(Schema, 'TestType');

  // Should contain proper TypeScript syntax
  expect(types).toContain('export interface TestType {');
  expect(types).toContain('count: number;');
  expect(types).toContain('active: boolean;');
  expect(types).toContain("status: 'pending' | 'active' | 'complete';");
  expect(types).toContain('tags: number[];');
  expect(types).toContain('}');
});
