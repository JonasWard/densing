import { describe, test, expect } from 'bun:test';
import { createRecursiveUnion } from '../schema/recursive-builder-helper';
import { schema, int, fixed, enumeration } from '../schema/builder';
import { densing, undensing } from '../densing';
import { validate } from '../schema/validation';

/**
 * Example: Mathematical Expression Schema
 * Define the structure ONCE, reuse it recursively
 */
export const ExpressionSchema = schema(
  createRecursiveUnion(
    'expr',
    ['number', 'add', 'multiply', 'divide'],
    (recurse) => ({
      number: [int('value', 0, 1000)],
      add: [recurse('left'), recurse('right')],
      multiply: [recurse('left'), recurse('right')],
      divide: [recurse('left'), recurse('right')]
    }),
    3 // Max depth of 3 levels
  )
);

/**
 * Example: Binary Tree Schema
 */
export const BinaryTreeSchema = schema(
  createRecursiveUnion(
    'node',
    ['leaf', 'branch'],
    (recurse) => ({
      leaf: [int('value', 0, 255)],
      branch: [int('value', 0, 255), recurse('left'), recurse('right')]
    }),
    3
  )
);

describe('createRecursiveUnion', () => {
  test('creates a valid union field', () => {
    const testSchema = schema(
      createRecursiveUnion(
        'test',
        ['value', 'operation'],
        (recurse) => ({
          value: [int('val', 0, 10)],
          operation: [recurse('left'), recurse('right')]
        }),
        2
      )
    );

    expect(testSchema.fields).toHaveLength(1);
    expect(testSchema.fields[0].type).toBe('union');
  });

  test('respects max depth limit', () => {
    const schema1 = createRecursiveUnion(
      'test',
      ['leaf', 'branch'],
      (recurse) => ({
        leaf: [int('value', 0, 100)],
        branch: [recurse('left'), recurse('right')]
      }),
      2
    );

    // At depth 2, should have created terminal variants
    expect(schema1.type).toBe('union');
  });
});

describe('ExpressionSchema', () => {
  test('encodes and decodes simple number', () => {
    const data = {
      expr: { type: 'number', value: 42 }
    };

    const encoded = densing(ExpressionSchema, data);
    const decoded = undensing(ExpressionSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes simple addition', () => {
    const data = {
      expr: {
        type: 'add',
        left: { type: 'number', value: 5 },
        right: { type: 'number', value: 3 }
      }
    };

    const encoded = densing(ExpressionSchema, data);
    const decoded = undensing(ExpressionSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes nested operations', () => {
    const data = {
      expr: {
        type: 'multiply',
        left: {
          type: 'add',
          left: { type: 'number', value: 2 },
          right: { type: 'number', value: 3 }
        },
        right: { type: 'number', value: 4 }
      }
    };

    const encoded = densing(ExpressionSchema, data);
    const decoded = undensing(ExpressionSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes complex expression tree', () => {
    // ((5 + 3) * 2) / 4 = 4
    const data = {
      expr: {
        type: 'divide',
        left: {
          type: 'multiply',
          left: {
            type: 'add',
            left: { type: 'number', value: 5 },
            right: { type: 'number', value: 3 }
          },
          right: { type: 'number', value: 2 }
        },
        right: { type: 'number', value: 4 }
      }
    };

    const encoded = densing(ExpressionSchema, data);
    const decoded = undensing(ExpressionSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('validates correct expression data', () => {
    const data = {
      expr: {
        type: 'add',
        left: { type: 'number', value: 10 },
        right: { type: 'number', value: 20 }
      }
    };

    const result = validate(ExpressionSchema, data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('produces compact encoding', () => {
    const data = {
      expr: {
        type: 'add',
        left: { type: 'number', value: 5 },
        right: { type: 'number', value: 3 }
      }
    };

    const encoded = densing(ExpressionSchema, data);
    const jsonSize = JSON.stringify(data).length;

    // Base64 should be much smaller than JSON
    expect(encoded.length).toBeLessThan(jsonSize / 2);
  });
});

describe('BinaryTreeSchema', () => {
  test('encodes and decodes single leaf', () => {
    const data = {
      node: { type: 'leaf', value: 42 }
    };

    const encoded = densing(BinaryTreeSchema, data);
    const decoded = undensing(BinaryTreeSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes simple branch', () => {
    const data = {
      node: {
        type: 'branch',
        value: 10,
        left: { type: 'leaf', value: 5 },
        right: { type: 'leaf', value: 15 }
      }
    };

    const encoded = densing(BinaryTreeSchema, data);
    const decoded = undensing(BinaryTreeSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes full tree', () => {
    const data = {
      node: {
        type: 'branch',
        value: 10,
        left: {
          type: 'branch',
          value: 5,
          left: { type: 'leaf', value: 2 },
          right: { type: 'leaf', value: 7 }
        },
        right: {
          type: 'branch',
          value: 15,
          left: { type: 'leaf', value: 12 },
          right: { type: 'leaf', value: 20 }
        }
      }
    };

    const encoded = densing(BinaryTreeSchema, data);
    const decoded = undensing(BinaryTreeSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('validates correct tree data', () => {
    const data = {
      node: {
        type: 'branch',
        value: 10,
        left: { type: 'leaf', value: 5 },
        right: { type: 'leaf', value: 15 }
      }
    };

    const result = validate(BinaryTreeSchema, data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('Method with recursive inputs', () => {
  const MethodSchema = schema(
    createRecursiveUnion(
      'method',
      ['int_value', 'operation'],
      (recurse) => ({
        int_value: [int('value', 0, 1000)],
        operation: [enumeration('op', ['add', 'multiply', 'subtract', 'divide']), recurse('left'), recurse('right')]
      }),
      4
    )
  );

  test('encodes and decodes int value', () => {
    const data = {
      method: { type: 'int_value', value: 42 }
    };

    const encoded = densing(MethodSchema, data);
    const decoded = undensing(MethodSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes simple operation', () => {
    const data = {
      method: {
        type: 'operation',
        op: 'add',
        left: { type: 'int_value', value: 5 },
        right: { type: 'int_value', value: 3 }
      }
    };

    const encoded = densing(MethodSchema, data);
    const decoded = undensing(MethodSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes nested operations', () => {
    // add(multiply(5, 3), 10)
    const data = {
      method: {
        type: 'operation',
        op: 'add',
        left: {
          type: 'operation',
          op: 'multiply',
          left: { type: 'int_value', value: 5 },
          right: { type: 'int_value', value: 3 }
        },
        right: { type: 'int_value', value: 10 }
      }
    };

    const encoded = densing(MethodSchema, data);
    const decoded = undensing(MethodSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('encodes and decodes deeply nested operations', () => {
    // divide(add(multiply(5, 3), 10), subtract(20, 8))
    const data = {
      method: {
        type: 'operation',
        op: 'divide',
        left: {
          type: 'operation',
          op: 'add',
          left: {
            type: 'operation',
            op: 'multiply',
            left: { type: 'int_value', value: 5 },
            right: { type: 'int_value', value: 3 }
          },
          right: { type: 'int_value', value: 10 }
        },
        right: {
          type: 'operation',
          op: 'subtract',
          left: { type: 'int_value', value: 20 },
          right: { type: 'int_value', value: 8 }
        }
      }
    };

    const encoded = densing(MethodSchema, data);
    const decoded = undensing(MethodSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('validates correct method data', () => {
    const data = {
      method: {
        type: 'operation',
        op: 'add',
        left: { type: 'int_value', value: 5 },
        right: { type: 'int_value', value: 3 }
      }
    };

    const result = validate(MethodSchema, data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('Mixed type operations', () => {
  const MixedSchema = schema(
    createRecursiveUnion(
      'expr',
      ['int_val', 'fixed_val', 'operation'],
      (recurse) => ({
        int_val: [int('value', 0, 100)],
        fixed_val: [fixed('value', -10, 10, 0.1)],
        operation: [enumeration('op', ['add', 'multiply']), recurse('left'), recurse('right')]
      }),
      3
    )
  );

  test('handles mixed int and fixed values', () => {
    const data = {
      expr: {
        type: 'operation',
        op: 'multiply',
        left: { type: 'int_val', value: 5 },
        right: { type: 'fixed_val', value: 2.5 }
      }
    };

    const encoded = densing(MixedSchema, data);
    const decoded = undensing(MixedSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('handles all fixed values in nested operations', () => {
    const data = {
      expr: {
        type: 'operation',
        op: 'add',
        left: {
          type: 'operation',
          op: 'multiply',
          left: { type: 'fixed_val', value: 1.5 },
          right: { type: 'fixed_val', value: 2.0 }
        },
        right: { type: 'fixed_val', value: 0.5 }
      }
    };

    const encoded = densing(MixedSchema, data);
    const decoded = undensing(MixedSchema, encoded);

    expect(decoded).toEqual(data);
  });
});

describe('Space efficiency', () => {
  test('ExpressionSchema provides significant compression', () => {
    const data = {
      expr: {
        type: 'divide',
        left: {
          type: 'multiply',
          left: {
            type: 'add',
            left: { type: 'number', value: 5 },
            right: { type: 'number', value: 3 }
          },
          right: { type: 'number', value: 2 }
        },
        right: { type: 'number', value: 4 }
      }
    };

    const jsonSize = JSON.stringify(data).length;
    const encoded = densing(ExpressionSchema, data);

    // Should achieve at least 90% compression
    expect(encoded.length).toBeLessThan(jsonSize * 0.1);
  });

  test('BinaryTreeSchema provides significant compression', () => {
    const data = {
      node: {
        type: 'branch',
        value: 10,
        left: {
          type: 'branch',
          value: 5,
          left: { type: 'leaf', value: 2 },
          right: { type: 'leaf', value: 7 }
        },
        right: {
          type: 'branch',
          value: 15,
          left: { type: 'leaf', value: 12 },
          right: { type: 'leaf', value: 20 }
        }
      }
    };

    const jsonSize = JSON.stringify(data).length;
    const encoded = densing(BinaryTreeSchema, data);

    // Should achieve at least 90% compression
    expect(encoded.length).toBeLessThan(jsonSize * 0.1);
  });
});

describe('Edge cases', () => {
  test('handles minimal depth of 1', () => {
    const MinimalSchema = schema(
      createRecursiveUnion(
        'node',
        ['value', 'pair'],
        (recurse) => ({
          value: [int('val', 0, 10)],
          pair: [recurse('left'), recurse('right')]
        }),
        1
      )
    );

    const data = {
      node: { type: 'value', val: 5 }
    };

    const encoded = densing(MinimalSchema, data);
    const decoded = undensing(MinimalSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('handles large depth', () => {
    const DeepSchema = schema(
      createRecursiveUnion(
        'node',
        ['leaf', 'branch'],
        (recurse) => ({
          leaf: [int('value', 0, 100)],
          branch: [recurse('child')]
        }),
        5
      )
    );

    const data = {
      node: {
        type: 'branch',
        child: {
          type: 'branch',
          child: {
            type: 'branch',
            child: {
              type: 'branch',
              child: { type: 'leaf', value: 42 }
            }
          }
        }
      }
    };

    const encoded = densing(DeepSchema, data);
    const decoded = undensing(DeepSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('handles single variant type', () => {
    const SingleSchema = schema(
      createRecursiveUnion(
        'node',
        ['value', 'wrap'],
        (recurse) => ({
          value: [int('val', 0, 100)],
          wrap: [recurse('inner')]
        }),
        2
      )
    );

    const data = {
      node: {
        type: 'wrap',
        inner: { type: 'value', val: 42 }
      }
    };

    const encoded = densing(SingleSchema, data);
    const decoded = undensing(SingleSchema, encoded);

    expect(decoded).toEqual(data);
  });

  test('handles multiple recursive fields', () => {
    const TernarySchema = schema(
      createRecursiveUnion(
        'node',
        ['leaf', 'branch'],
        (recurse) => ({
          leaf: [int('value', 0, 100)],
          branch: [int('value', 0, 100), recurse('left'), recurse('middle'), recurse('right')]
        }),
        2
      )
    );

    const data = {
      node: {
        type: 'branch',
        value: 10,
        left: { type: 'leaf', value: 1 },
        middle: { type: 'leaf', value: 2 },
        right: { type: 'leaf', value: 3 }
      }
    };

    const encoded = densing(TernarySchema, data);
    const decoded = undensing(TernarySchema, encoded);

    expect(decoded).toEqual(data);
  });
});
