// templates.test.ts - reference-only templates and the `reference` fields using them
import { describe, test, expect } from 'bun:test';
import {
  array,
  definition,
  enumeration,
  fixed,
  int,
  object,
  optional,
  pointer,
  reference,
  referenceNumeric,
  schema,
  schemaWithDefinitions,
  template,
  Template,
  union
} from '../schema/builder';
import { densing, undensing } from '../densing';
import { validate } from '../schema/validation';
import { validateSchema } from '../schema/validate-schema';
import { getDefaultData } from '../schema/default-data';
import { generateTypes } from '../schema/type-generator';
import { schemaFromJson } from '../schema/from-json';
import { analyzeDenseSchemaSize, getFieldByPath, getAllDenseSchemaPaths } from '../api';
import { DenseSchema } from '../schema-type';

const vec3 = template(object('vec3', int('x', 0, 7), int('y', 0, 7), int('z', 0, 7)));
const Pose = schema(reference('position', vec3), reference('rotation', vec3));
const pose = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 7 } };

// a template that refers to itself: the reference takes a function, `node` does not exist yet
const node: Template = template(
  union('node', enumeration('kind', ['leaf', 'branch']), {
    leaf: [int('value', 0, 9)],
    branch: [array('children', 0, 3, reference('child', () => node))]
  })
);
const Tree = schema(reference('root', node));

describe('schema shape', () => {
  test('templates are stored once, references point at them by index', () => {
    expect(Pose).toEqual({
      templates: [vec3],
      fields: [
        { type: 'reference', name: 'position', ref: 0 },
        { type: 'reference', name: 'rotation', ref: 0 }
      ]
    });
  });

  test('indices follow first use, also inside templates', () => {
    const color = template(object('color', int('r', 0, 255), int('g', 0, 255), int('b', 0, 255)));
    const light = template(object('light', reference('at', vec3), reference('color', color)));
    const Scene = schema(reference('key', light), reference('fill', light), reference('tint', color));
    expect(Scene.templates!.map((t) => t.name)).toEqual(['light', 'vec3', 'color']);
    expect(Scene.fields.map((f) => (f as { ref: number }).ref)).toEqual([0, 0, 2]);
    expect(Scene.templates![0]).toMatchObject({
      fields: [
        { type: 'reference', name: 'at', ref: 1 },
        { type: 'reference', name: 'color', ref: 2 }
      ]
    });
  });

  test('a self-referencing template refers to its own index', () => {
    expect(Tree.templates).toHaveLength(1);
    expect(JSON.stringify(Tree.templates![0])).toContain('{"type":"reference","name":"child","ref":0}');
  });

  test('the input fields are not changed', () => {
    const position = reference('position', vec3);
    const wrapper = object('wrapper', position);
    schema(wrapper);
    expect(position.ref).toBe(-1);
    expect(wrapper.fields[0]).toBe(position);
  });

  test('schemas without templates or definitions keep their plain shape', () => {
    const plain = int('a', 0, 1);
    expect(schema(plain)).toEqual({ fields: [plain] });
    expect(Object.keys(schema(plain))).toEqual(['fields']);
  });
});

describe('encoding', () => {
  test('round trip, and no template key in the data', () => {
    expect(undensing(Pose, densing(Pose, pose))).toEqual(pose);
    expect(Object.keys(getDefaultData(Pose))).toEqual(['position', 'rotation']);
  });

  test('same bits as the shape written inline', () => {
    const inline = schema(
      object('position', int('x', 0, 7), int('y', 0, 7), int('z', 0, 7)),
      object('rotation', int('x', 0, 7), int('y', 0, 7), int('z', 0, 7))
    );
    expect(densing(Pose, pose, 'binary')).toBe(densing(inline, pose, 'binary'));
  });

  test('recursive template', () => {
    const tree = {
      root: {
        kind: 'branch',
        children: [
          { kind: 'leaf', value: 3 },
          { kind: 'branch', children: [{ kind: 'leaf', value: 9 }] }
        ]
      }
    };
    expect(undensing(Tree, densing(Tree, tree))).toEqual(tree);
    expect(getDefaultData(Tree)).toEqual({ root: { kind: 'leaf', value: 0 } });
    // the smallest tree is an empty branch: discriminator + array length
    expect(analyzeDenseSchemaSize(Tree).staticRange.minBits).toBe(1 + 2);
    expect(analyzeDenseSchemaSize(Tree).staticRange.maxBits).toBe(Infinity);
  });

  test('references in arrays, optionals and unions', () => {
    const S = schema(
      array('points', 0, 3, reference('point', vec3)),
      optional('origin', reference('originValue', vec3)),
      union('shape', enumeration('kind', ['dot', 'line']), {
        dot: [reference('at', vec3)],
        line: [reference('from', vec3), reference('to', vec3)]
      })
    );
    expect(S.templates).toEqual([vec3]);
    const data = {
      points: [pose.position, pose.rotation],
      origin: null,
      shape: { kind: 'line', from: pose.position, to: pose.rotation }
    };
    expect(undensing(S, densing(S, data))).toEqual(data);
  });

  test('validate checks values against the template', () => {
    expect(validate(Pose, pose).valid).toBe(true);
    expect(validate(Pose, { ...pose, rotation: { x: 0, y: 8, z: 0 } }).errors).toEqual([
      { path: 'rotation.y', message: 'value 8 out of range [0, 7]' }
    ]);
    expect(() => densing(Pose, { ...pose, position: { x: 0, y: 0 } })).toThrow('position.z: missing value');
  });
});

describe('numeric definitions are collected too', () => {
  const length = definition('length', { mm: { min: 0, max: 1000 }, m: { min: 0, max: 100, precision: 0.01 } });

  test('schema() collects definitions passed as objects', () => {
    const Box = schema(referenceNumeric('width', length), referenceNumeric('height', length));
    expect(Box).toEqual(schemaWithDefinitions([length], referenceNumeric('width', 'length'), referenceNumeric('height', 'length')));
    const data = { $presets: { length: 'm' }, width: 1.5, height: 2 };
    expect(undensing(Box, densing(Box, data))).toEqual(data);
  });

  test('inside templates, with the payload preset applying to every use', () => {
    const size = template(object('size', referenceNumeric('w', length), referenceNumeric('h', length)));
    const S = schema(reference('a', size), reference('b', size));
    expect(S.definitions).toEqual([length]);
    const data = { $presets: { length: 'm' }, a: { w: 0.5, h: 1 }, b: { w: 99.99, h: 0 } };
    expect(undensing(S, densing(S, data))).toEqual(data);
  });

  test('a name still needs schemaWithDefinitions', () => {
    expect(() => schema(referenceNumeric('w', 'length'))).toThrow('definition "length" does not exist');
  });

  test('two different definitions with one name', () => {
    const other = definition('length', { only: { min: 0, max: 1 } });
    expect(() => schema(referenceNumeric('a', length), referenceNumeric('b', other))).toThrow(
      'two different definitions are called "length"'
    );
  });
});

describe('errors', () => {
  test('reference() needs a template', () => {
    expect(() => reference('p', object('plain', int('x', 0, 1)) as Template)).toThrow('is not a template');
    expect(() => schema(reference('p', () => object('plain', int('x', 0, 1)) as Template))).toThrow('is not a template');
  });

  test('a template must have a finite value', () => {
    const loop: Template = template(object('loop', int('v', 0, 1), reference('next', () => loop)));
    expect(() => schema(reference('start', loop))).toThrow('templates[0]: template "loop" has no finite value');
  });

  test('pointers do not reach into templates', () => {
    expect(() => schema(reference('position', vec3), pointer('again', 'vec3'))).toThrow(
      'again: pointer target "vec3" does not exist'
    );
  });

  test('hand-built schemas', () => {
    const hand: DenseSchema = {
      templates: [object('a', int('v', 0, 1)), object('a', int('w', 0, 1)), object('unused', int('u', 0, 1))],
      fields: [
        { type: 'reference', name: 'x', ref: 0 },
        { type: 'reference', name: 'y', ref: 1 }
      ]
    };
    expect(validateSchema(hand).errors).toEqual([
      { path: 'templates[1]', message: 'duplicate template name "a"' },
      { path: 'templates[2]', message: 'template "unused" is never referenced' }
    ]);
    expect(validateSchema({ templates: [], fields: [{ type: 'reference', name: 'x', ref: 3 }] }).errors).toEqual([
      { path: 'x', message: 'template 3 does not exist' }
    ]);
  });
});

describe('introspection', () => {
  test('generateTypes names every template', () => {
    expect(generateTypes(Pose)).toBe(
      [
        'export interface Vec3 {',
        '  x: number;',
        '  y: number;',
        '  z: number;',
        '}',
        '',
        'export interface SchemaData {',
        '  position: Vec3;',
        '  rotation: Vec3;',
        '}'
      ].join('\n')
    );
    const list: Template = template(array('list', 0, 2, reference('item', () => list)));
    expect(generateTypes(schema(reference('nested', list)))).toBe(
      ['export type List = List[];', '', 'export interface SchemaData {', '  nested: List;', '}'].join('\n')
    );
  });

  test('paths continue into templates, the walk does not', () => {
    expect(getFieldByPath(Pose, 'position.y')).toEqual(int('y', 0, 7));
    expect(getAllDenseSchemaPaths(Pose)).toEqual(['position', 'rotation']);
  });
});

describe('JSON', () => {
  test('round trip', () => {
    for (const S of [Pose, Tree]) {
      const loaded = schemaFromJson(JSON.stringify(S));
      expect(loaded).toEqual(S);
    }
    expect(densing(schemaFromJson(JSON.stringify(Pose)), pose)).toBe(densing(Pose, pose));
  });

  test('hand-written JSON', () => {
    const loaded = schemaFromJson({
      templates: [{ type: 'object', name: 'vec3', fields: ['x', 'y', 'z'].map((name) => ({ type: 'int', name, min: 0, max: 7 })) }],
      fields: [
        { type: 'reference', name: 'position', ref: 0 },
        { type: 'reference', name: 'rotation', ref: 0 }
      ]
    });
    expect(loaded).toEqual(Pose);
  });

  test('errors carry the path', () => {
    const vec = { type: 'object', name: 'vec', fields: [{ type: 'int', name: 'x', min: 0, max: 1 }] };
    expect(() => schemaFromJson({ templates: [vec], fields: [{ type: 'reference', name: 'p', ref: 'vec' }] })).toThrow(
      'Invalid schema at fields[0]: "ref" must be a finite number'
    );
    expect(() => schemaFromJson({ templates: [vec], fields: [{ type: 'reference', name: 'p', ref: 0.5 }] })).toThrow(
      'Invalid schema at fields[0]: "ref" must be the index of a template'
    );
    expect(() => schemaFromJson({ templates: [vec], fields: [{ type: 'reference', name: 'p', ref: 1 }] })).toThrow(
      'Invalid schema: p: template 1 does not exist'
    );
    expect(() => schemaFromJson({ templates: [vec], fields: [] })).toThrow('templates[0]: template "vec" is never referenced');
    expect(() =>
      schemaFromJson({ templates: [{ ...vec, fields: [{ type: 'int', name: 'x', min: 1, max: 0 }] }], fields: [] })
    ).toThrow('Invalid schema at templates[0].fields[0]: int "x": max < min');
  });
});
