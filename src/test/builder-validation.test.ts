import { expect, test } from 'bun:test';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, schema, union } from '../schema/builder';
import { densing } from '../densing';
import { getDefaultData } from '../schema/default-data';

test('default values must be valid for their field', () => {
  expect(() => int('x', 0, 10, 99)).toThrow('int "x": invalid default value (value 99 out of range [0, 10])');
  expect(() => int('x', 0, 10, 2.5)).toThrow('int "x": invalid default value (expected integer)');
  expect(() => enumeration('e', ['a', 'b'], 'zzz')).toThrow('enum "e": invalid default value');
  expect(() => fixed('f', 0, 1, 0.1, 0.55)).toThrow('fixed "f": invalid default value (value 0.55 does not align');
  expect(() => bool('b', 'yes' as unknown as boolean)).toThrow('bool "b": invalid default value (expected boolean)');
  expect(() => enumArray('ea', enumeration('d', ['x', 'y']), 0, 2, ['x', 'z'])).toThrow('enum_array "ea": invalid default value');
  expect(() => enumArray('ea', enumeration('d', ['x', 'y']), 0, 2, ['x', 'x', 'x'])).toThrow('exceeds maxLength 2');
  expect(() => optional('o', int('v', 0, 3), 7)).toThrow('optional "o": invalid default value (value 7 out of range [0, 3])');
});

test('valid defaults are accepted', () => {
  expect(int('x', -5, 5, -5).defaultValue).toBe(-5);
  expect(fixed('f', -40, 125, 0.1, 23.5).defaultValue).toBe(23.5);
  expect(optional('o', int('v', 0, 3), 2).defaultValue).toBe(2);
  expect(optional('o', int('v', 0, 3), null).defaultValue).toBeNull();
});

test('enum_array without a default uses the shortest valid array', () => {
  const ea = enumArray('ea', enumeration('d', ['x', 'y'], 'y'), 2, 4);
  expect(ea.defaultValue).toEqual(['y', 'y']);
  const S = schema(ea);
  expect(() => densing(S, getDefaultData(S))).not.toThrow();
});

test('int bounds must be safe integers, fixed bounds finite', () => {
  expect(() => int('x', 0.5, 3.5)).toThrow('int "x": min and max must be safe integers');
  expect(() => int('x', 0, Infinity)).toThrow('int "x": min and max must be safe integers');
  expect(() => fixed('f', 0, NaN, 0.1)).toThrow('fixed "f": min and max must be finite numbers');
});

test('enum options must be strings', () => {
  expect(() => enumeration('e', ['a', 1 as unknown as string])).toThrow('enum "e": options must be strings');
});

test('fields that share a data object must have distinct names', () => {
  expect(() => schema(int('a', 0, 1), bool('a'))).toThrow('schema: duplicate field name "a"');
  expect(() => object('o', int('a', 0, 1), int('a', 0, 2))).toThrow('object "o": duplicate field name "a"');
  expect(() => union('u', enumeration('type', ['x', 'y']), { x: [int('type', 0, 3)], y: [] })).toThrow(
    'union "u" variant "x": duplicate field name "type"'
  );
  expect(() => union('u', enumeration('t', ['x', 'y']), { x: [bool('v'), bool('v')], y: [] })).toThrow(
    'union "u" variant "x": duplicate field name "v"'
  );
});

test('the same name in different scopes is fine', () => {
  expect(() =>
    schema(
      object('a', int('v', 0, 1)),
      object('b', int('v', 0, 1)),
      union('u', enumeration('t', ['x', 'y']), { x: [int('v', 0, 1)], y: [int('v', 0, 1)] }),
      array('list', 0, 2, int('v', 0, 1)),
      pointer('p', 'a')
    )
  ).not.toThrow();
});

test('union variants must match the discriminator options', () => {
  expect(() => union('u', enumeration('t', ['x', 'y']), { x: [], y: [], z: [] })).toThrow(
    'union "u": variant "z" is not an option of discriminator "t"'
  );
});
