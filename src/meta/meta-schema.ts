// meta schema is a definition that allows you to dense any denseSchema

import { bool, enumArray, enumeration, object, optional, schema } from '@/schema';
import { DenseSchema } from '@/schema-type';

// prettier-ignore
const metaDenseNumberHardcodedContent = enumeration('metaDenseNumberHardcodedContent', ['0','1','2','3','4','5','6','7','8','9']);

// numbers are formatted as a special type
const metaDenseNumberHardcoded = enumArray('metaDenseNumberHardcoded', metaDenseNumberHardcodedContent, 1, 8, ['0']);
const metaDenseNumberExponentHardcoded = enumArray(
  'metaDenseNumberExponentHardcoded',
  metaDenseNumberHardcodedContent,
  1,
  4,
  ['0']
);

const metaNegative = bool('metaNegative', false);

const metaDenseNumber = object(
  'metaDenseNumber',
  metaNegative,
  metaDenseNumberHardcoded, // integer part
  optional('decimalPart', metaDenseNumberHardcoded, null),
  optional('exponentPart', object('exponentContent', metaNegative, metaDenseNumberExponentHardcoded), null)
);

// for text
// collect all unique characters for: 'name' & 'options', store them as UTF-8 encoded string and store the length of its bitwidth
// for all 'name' & 'options', map them to the index of the character in the sorted string, store the length of its character count and store all the indexes in an enum array (options are the collected characters)
