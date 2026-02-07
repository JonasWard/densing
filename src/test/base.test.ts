import { expect, test } from 'bun:test';
import { undensing, densing } from '../densing';
import { schema, bool, int, fixed, enumeration, union, array, enumArray } from '../schema/builder';
import { getBase64FromBigInt, getBigIntFromBase64 } from '../helpers';

test('base64 back and forward bigint conversion', () => {
  const BigIntData = 12345678901234567890133254348586883996588395981234n ** 100n;
  const BigIntB64 = getBase64FromBigInt(BigIntData);
  const BigIntDecoded = getBigIntFromBase64(BigIntB64);
  expect(BigIntDecoded).toEqual(BigIntData);
});

test('testing base64 and back conversion for simple types', () => {
  const BoolSchema = schema(bool('enabled'));
  const IntSchema = schema(int('value', 0, 1023));
  const FixedSchema = schema(fixed('value', -40, 125, 0.1));
  const EnumSchema = schema(enumeration('value', ['R', 'G', 'B']));

  const BoolData = { enabled: true };
  const IntData0 = { value: 0 };
  const IntData = { value: 100 };
  const FixedData = { value: 100.1 };
  const EnumData = { value: 'R' };

  const BoolB64 = undensing(BoolSchema, BoolData);
  const IntB640 = undensing(IntSchema, IntData0);
  const IntB64 = undensing(IntSchema, IntData);
  const FixedB64 = undensing(FixedSchema, FixedData);
  const EnumB64 = undensing(EnumSchema, EnumData);

  const BoolDecoded = densing(BoolSchema, BoolB64);
  const IntDecoded0 = densing(IntSchema, IntB640);
  const IntDecoded = densing(IntSchema, IntB64);
  const FixedDecoded = densing(FixedSchema, FixedB64);
  const EnumDecoded = densing(EnumSchema, EnumB64);

  console.log({ BoolB64, IntB640, IntB64, FixedB64, EnumB64 });
  console.log({ BoolDecoded, IntDecoded0, IntDecoded, FixedDecoded, EnumDecoded });

  expect(IntDecoded0).toEqual(IntData0);
  expect(IntDecoded).toEqual(IntData);
  expect(FixedDecoded).toEqual(FixedData);
  expect(BoolDecoded).toEqual(BoolData);
  expect(EnumDecoded).toEqual(EnumData);
});

test('testing base64 and back conversion for complex types', () => {
  const UnionSchema = schema(
    union('value', enumeration('type', ['start', 'setSpeed']), {
      start: [int('delay', 0, 60)],
      setSpeed: [int('rpm', 0, 10000)]
    })
  );
  const ArraySchema = schema(array('value', 0, 16, int('value', 0, 1023)));
  const EnumArraySchema = schema(enumArray('value', enumeration('color', ['R', 'G', 'B']), 0, 511));

  const UnionData = { value: { type: 'start', delay: 10 } };
  const ArrayData = { value: [1, 2, 3] };
  const EnumArrayData = { value: ['R', 'G', 'B'] };

  const UnionB64 = undensing(UnionSchema, UnionData);
  const VarArrayB64 = undensing(ArraySchema, ArrayData);
  const EnumArrayB64 = undensing(EnumArraySchema, EnumArrayData);

  const ArrayDecoded = densing(ArraySchema, VarArrayB64);
  const EnumArrayDecoded = densing(EnumArraySchema, EnumArrayB64);
  const UnionDecoded = densing(UnionSchema, UnionB64);

  expect(ArrayDecoded).toEqual(ArrayData);
  expect(EnumArrayDecoded).toEqual(EnumArrayData);
  expect(UnionDecoded).toEqual(UnionData);
});

test('complex schema testing', () => {
  const UnionSchema = schema(
    union('value', enumeration('type', ['start', 'setSpeed']), {
      start: [int('delay', 0, 60)],
      setSpeed: [int('rpm', 0, 10000)]
    })
  );
  const ArraySchema = schema(array('value', 0, 16, int('value', 0, 1023)));
  const EnumArraySchema = schema(enumArray('value', enumeration('color', ['R', 'G', 'B']), 0, 511));

  const UnionData = { value: { type: 'start', delay: 10 } };
  const ArrayData = { value: [1, 2, 3] };
  const EnumArrayData = { value: ['R', 'G', 'B'] };

  const UnionB64 = undensing(UnionSchema, UnionData);
  const VarArrayB64 = undensing(ArraySchema, ArrayData);
  const EnumArrayB64 = undensing(EnumArraySchema, EnumArrayData);

  const ArrayDecoded = densing(ArraySchema, VarArrayB64);
  const EnumArrayDecoded = densing(EnumArraySchema, EnumArrayB64);
  const UnionDecoded = densing(UnionSchema, UnionB64);

  console.log({ UnionB64, VarArrayB64, EnumArrayB64 });
  console.log({ ArrayDecoded, EnumArrayDecoded, UnionDecoded });

  expect(ArrayDecoded).toEqual(ArrayData);
  expect(EnumArrayDecoded).toEqual(EnumArrayData);
  expect(UnionDecoded).toEqual(UnionData);
});