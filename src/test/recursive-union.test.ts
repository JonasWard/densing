import { describe, test, expect } from 'bun:test';
import { schema, int, enumeration, union, reference, fixed, template, Template } from '../schema';
import { densing, undensing } from '../densing';

describe('Recursive Union Tests (with templates)', () => {
  /**
   * Example 1: Mathematical Expression
   * A template that refers to itself
   */
  test('recursive expression schema', () => {
    const exprT: Template = template(
      union('expr', enumeration('type', ['number', 'add', 'multiply', 'divide']), {
        number: [int('value', 0, 1000)],
        add: [reference('left', () => exprT), reference('right', () => exprT)],
        multiply: [reference('left', () => exprT), reference('right', () => exprT)],
        divide: [reference('left', () => exprT), reference('right', () => exprT)]
      })
    );
    const ExpressionSchema = schema(reference('expr', exprT));

    // Test data: ((5 + 3) * 2) / 4 = 4
    const expressionData = {
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

    const encoded = densing(ExpressionSchema, expressionData);
    const decoded = undensing(ExpressionSchema, encoded);

    expect(decoded).toEqual(expressionData);

    console.log('\n=== Example 1: Recursive Expression ===');
    console.log('Expression:', JSON.stringify(expressionData, null, 2));
    console.log('Encoded:', encoded, `(${encoded.length} chars)`);
    console.log('JSON size:', JSON.stringify(expressionData).length, 'chars');
    console.log('Space saved:', Math.round((1 - encoded.length / JSON.stringify(expressionData).length) * 100), '%');
  });

  /**
   * Example 2: Binary Tree with Any Value Type
   * A template for naturally recursive tree structures
   */
  test('recursive binary tree schema', () => {
    const nodeT: Template = template(
      union('node', enumeration('type', ['leaf', 'branch']), {
        leaf: [int('value', 0, 100)],
        branch: [int('value', 0, 100), reference('left', () => nodeT), reference('right', () => nodeT)]
      })
    );
    const BinaryTreeSchema = schema(reference('node', nodeT));

    const treeData = {
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

    const encoded = densing(BinaryTreeSchema, treeData);
    const decoded = undensing(BinaryTreeSchema, encoded);

    expect(decoded).toEqual(treeData);

    console.log('\n=== Example 2: Recursive Binary Tree ===');
    console.log('Tree:', JSON.stringify(treeData, null, 2));
    console.log('Encoded:', encoded, `(${encoded.length} chars)`);
    console.log('JSON size:', JSON.stringify(treeData).length, 'chars');
    console.log('Space saved:', Math.round((1 - encoded.length / JSON.stringify(treeData).length) * 100), '%');
  });

  /**
   * Example 3: Method with Inputs (User's Use Case)
   * Demonstrates mixed value types with recursive operations
   */
  test('method schema with recursive operations', () => {
    const methodT: Template = template(
      union('method', enumeration('type', ['int_value', 'fixed_value', 'operation']), {
        int_value: [int('value', 0, 1000)],
        fixed_value: [fixed('value', -100, 100, 0.1)],
        operation: [
          enumeration('op', ['add', 'multiply', 'subtract']),
          reference('left', () => methodT),
          reference('right', () => methodT)
        ]
      })
    );
    const MethodSchema = schema(reference('method', methodT));

    // Usage: (5 * 3.5) + 10 = 27.5
    const methodData = {
      method: {
        type: 'operation',
        op: 'add',
        left: {
          type: 'operation',
          op: 'multiply',
          left: { type: 'int_value', value: 5 },
          right: { type: 'fixed_value', value: 3.5 }
        },
        right: { type: 'int_value', value: 10 }
      }
    };

    const encoded = densing(MethodSchema, methodData);
    const decoded = undensing(MethodSchema, encoded);

    expect(decoded).toEqual(methodData);

    console.log('\n=== Example 3: Method with Inputs ===');
    console.log('Method:', JSON.stringify(methodData, null, 2));
    console.log('Encoded:', encoded, `(${encoded.length} chars)`);
    console.log('JSON size:', JSON.stringify(methodData).length, 'chars');
    console.log('Space saved:', Math.round((1 - encoded.length / JSON.stringify(methodData).length) * 100), '%');
  });

  test('deep recursion (linked list)', () => {
    const listT: Template = template(
      union('list', enumeration('type', ['empty', 'cons']), {
        empty: [],
        cons: [int('head', 0, 255), reference('tail', () => listT)]
      })
    );
    const ListSchema = schema(reference('list', listT));

    // List: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const buildList = (values: number[]): any => {
      if (values.length === 0) {
        return { type: 'empty' };
      }
      return {
        type: 'cons',
        head: values[0],
        tail: buildList(values.slice(1))
      };
    };

    const listData = {
      list: buildList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    };

    const encoded = densing(ListSchema, listData);
    const decoded = undensing(ListSchema, encoded);

    expect(decoded).toEqual(listData);

    console.log('\n=== Example 4: Deep Recursion (List) ===');
    console.log('List length: 10 elements');
    console.log('Encoded:', encoded, `(${encoded.length} chars)`);
    console.log('JSON size:', JSON.stringify(listData).length, 'chars');
    console.log('Space saved:', Math.round((1 - encoded.length / JSON.stringify(listData).length) * 100), '%');
  });
});

console.log('\n=== Key Benefits of Template-Based Recursion ===');
console.log('✓ Define the recursive structure ONCE with template() and reference()');
console.log('✓ Unlimited depth - no artificial limits!');
console.log('✓ No manual nesting required');
console.log('✓ Clean, maintainable code');
console.log('✓ Easy to change - just modify the union definition');
console.log('✓ Natural TypeScript types generated automatically');
