import { undensing, densing } from '../densing';
import { schema, bool, int, fixed, enumeration, union, array, enumArray } from '../schema/builder';

const Command = union('command', enumeration('type', ['start', 'setSpeed']), {
  start: [int('delay', 0, 60)],
  setSpeed: [int('rpm', 0, 10000)]
});

const DeviceSchema = schema(
  bool('enabled'),
  fixed('temperature', -40, 125, 0.1),
  array('samples', 0, 16, int('value', 0, 1023)),
  Command
);

const OtherSchema = schema(
  bool('enabled'),
  union('command', enumeration('type', ['start', 'setSpeed']), {
    start: [int('delay', 0, 60)],
    setSpeed: [int('rpm', 0, 10000)]
  })
);

const data = {
  enabled: true,
  command: { type: 'setSpeed', rpm: 100 }
};

const b64 = undensing(OtherSchema, data);
const decoded = densing(OtherSchema, b64);

console.log(b64);
console.log(decoded);

const Color = enumeration('color', ['R', 'G', 'B']);
const Pixels = enumArray('pixels', Color, 0, 511);
const PixelsSchema = schema(Pixels);

const validData = {
  pixels: [
    0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0,
    2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 2, 0, 2
  ]
};

const b64Bis = undensing(PixelsSchema, validData);
console.log(b64Bis);

const validDecoded = densing(PixelsSchema, b64Bis);
console.log(validDecoded);
