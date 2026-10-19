import { describe, test, expect } from 'bun:test';
import { schema, bool, int, fixed, optional, object, union, enumeration, array, enumArray, pointer } from '../schema/builder';
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

  test('escapes quotes and backslashes in string literals', () => {
    const types = generateTypes(
      schema(
        enumeration('quote', ["it's", 'back\\slash', 'line\nbreak']),
        enumArray('chars', enumeration('char', ["'", '\\']), 0, 4)
      )
    );
    expect(types).toContain("quote: 'it\\'s' | 'back\\\\slash' | 'line\\nbreak';");
    expect(types).toContain("chars: ('\\'' | '\\\\')[];");
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
  });

  test('names that are not identifiers become valid type names and quoted keys', () => {
    const types = generateTypes(
      schema(
        union('my value', enumeration('kind', ['Vec2.x', 'number call', '[a, b]', '']), {
          'Vec2.x': [int('the x', 0, 1)],
          'number call': [],
          '[a, b]': [],
          '': []
        })
      )
    );
    expect(types).toContain('export type MyValue = MyValue_Vec2X | MyValue_NumberCall | MyValue_AB | MyValue_Type;');
    expect(types).toContain("  kind: 'number call';");
    expect(types).toContain("  'the x': number;");
    expect(types).toContain("  'my value': MyValue;");
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
  });

  test('fields with the same name and a different shape get distinct types', () => {
    const types = generateTypes(
      schema(
        object('a', object('fields', int('x', 0, 1))),
        object('b', object('fields', bool('y'))),
        object('c', object('fields', int('x', 0, 1)))
      )
    );
    expect(types).toContain('export interface Fields {\n  x: number;\n}');
    expect(types).toContain('export interface Fields2 {\n  y: boolean;\n}');
    // the same shape again reuses its type
    expect(types).toContain('export interface C {\n  fields: Fields;\n}');
    expect(types).not.toContain('Fields3');
  });

  test('a type name never shadows a global type or the root type', () => {
    const types = generateTypes(
      schema(object('record', int('x', 0, 1)), object('number', int('y', 0, 1)), object('testData', bool('z'))),
      'TestData'
    );
    expect(types).toContain('export interface RecordType {');
    expect(types).toContain('export interface NumberType {');
    expect(types).toContain('export interface TestData2 {');
    expect(types).toContain('export interface TestData {');
  });

  test('a pointer to a field that is not an object or union gets a named alias', () => {
    const types = generateTypes(
      schema(
        int('count', 0, 9),
        array('list', 1, 3, union('node', enumeration('type', ['leaf', 'more']), {
          leaf: [pointer('n', 'count')],
          more: [pointer('rest', 'list')]
        }))
      )
    );
    expect(types).toContain('export type Count = number;');
    expect(types).toContain('export type List = Node[];');
    expect(types).toContain('  rest: List;');
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
  });
});
