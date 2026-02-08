import { describe, test, expect } from 'bun:test';
import { schema, bool, int, fixed, optional, object, union, enumeration, array } from '../schema/builder';
import { generateTypes } from '../schema/type-generator';

describe('Type Generator', () => {
  test('generates simple types', () => {
    const TestSchema = schema(
      int('id', 0, 100),
      bool('active', true)
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('export interface TestData');
    expect(types).toContain('id: number;');
    expect(types).toContain('active: boolean;');
  });

  test('generates optional types', () => {
    const TestSchema = schema(
      int('id', 0, 100),
      optional('nickname', int('value', 0, 1000))
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('nickname: number | null;');
  });

  test('generates nested object types', () => {
    const TestSchema = schema(
      object('settings',
        bool('enabled', true),
        int('timeout', 0, 1000)
      )
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('export interface Settings');
    expect(types).toContain('enabled: boolean;');
    expect(types).toContain('timeout: number;');
    expect(types).toContain('settings: Settings;');
  });

  test('generates union types', () => {
    const TestSchema = schema(
      union('data', enumeration('type', ['text', 'number']), {
        text: [int('length', 0, 100)],
        number: [int('value', 0, 1000)]
      })
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('export interface Data_Text');
    expect(types).toContain('export interface Data_Number');
    expect(types).toContain('export type Data = Data_Text | Data_Number;');
    expect(types).toContain("type: 'text';");
    expect(types).toContain("type: 'number';");
    expect(types).toContain('length: number;');
    expect(types).toContain('value: number;');
  });

  test('generates array types', () => {
    const TestSchema = schema(
      array('items', 0, 10, int('item', 0, 100))
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('items: number[];');
  });

  test('generates array of objects', () => {
    const TestSchema = schema(
      array('alerts', 0, 5, object('alert', int('threshold', 0, 100), bool('enabled', true)))
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('export interface Alert');
    expect(types).toContain('threshold: number;');
    expect(types).toContain('enabled: boolean;');
    expect(types).toContain('alerts: Alert[];');
  });

  test('handles complex nested structures', () => {
    const TestSchema = schema(
      int('id', 0, 100),
      object('config',
        bool('enabled', true),
        optional('timeout', int('value', 0, 1000))
      ),
      union('data', enumeration('type', ['a', 'b']), {
        a: [int('x', 0, 10)],
        b: [bool('y', true)]
      })
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    // Check all types are generated
    expect(types).toContain('export interface Config');
    expect(types).toContain('export interface Data_A');
    expect(types).toContain('export interface Data_B');
    expect(types).toContain('export type Data = Data_A | Data_B;');
    expect(types).toContain('export interface TestData');
    
    // Check field types
    expect(types).toContain('id: number;');
    expect(types).toContain('config: Config;');
    expect(types).toContain('data: Data;');
    expect(types).toContain('timeout: number | null;');
  });

  test('capitalizes type names correctly', () => {
    const TestSchema = schema(
      object('mySettings',
        bool('flag', true)
      )
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('export interface MySettings');
    expect(types).toContain('mySettings: MySettings;');
  });

  test('handles enum field type', () => {
    const TestSchema = schema(
      enumeration('status', ['active', 'inactive', 'pending'])
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain("status: 'active' | 'inactive' | 'pending';");
  });

  test('handles fixed point field type', () => {
    const TestSchema = schema(
      fixed('temperature', -40, 125, 0.1)
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    expect(types).toContain('temperature: number;');
  });

  test('avoids duplicate type definitions', () => {
    const TestSchema = schema(
      object('settings1',
        bool('enabled', true)
      ),
      object('settings2',
        bool('enabled', true)
      )
    );

    const types = generateTypes(TestSchema, 'TestData');
    
    // Should generate Settings1 and Settings2, not duplicate Settings
    expect(types).toContain('export interface Settings1');
    expect(types).toContain('export interface Settings2');
  });

  test('generates valid TypeScript syntax', () => {
    const TestSchema = schema(
      int('id', 0, 100),
      bool('active', true),
      optional('nickname', int('value', 0, 1000)),
      object('settings',
        bool('enabled', true),
        int('timeout', 0, 1000)
      ),
      union('data', enumeration('type', ['text', 'number']), {
        text: [int('length', 0, 100)],
        number: [int('value', 0, 1000)]
      })
    );

    const types = generateTypes(TestSchema, 'ComplexData');
    
    // Check that it's valid TypeScript-like syntax
    expect(types).toMatch(/export interface \w+/);
    expect(types).toMatch(/export type \w+ = \w+/);
    expect(types).toContain('{');
    expect(types).toContain('}');
    expect(types).toContain(';');
  });
});
