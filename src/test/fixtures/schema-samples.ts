// schema-samples.ts - schemas with names in several languages and scripts, for the schema encoding
// tests and the benchmark. The "room booking" schema has the same structure in every language.
import { DenseSchema } from '../../schema-type';
import {
  array,
  bool,
  definition,
  enumeration,
  fixed,
  int,
  object,
  optional,
  reference,
  referenceNumeric,
  schema,
  template
} from '../../schema/builder';
import { GLSLRayMarchingSchema } from './glsl-ray-marching';

interface BookingNames {
  room: string;
  roomNumber: string;
  floor: string;
  hasProjector: string;
  seating: string;
  seatings: string[];
  temperature: string;
  mode: string;
  modes: string[];
  bookings: string;
  booking: string;
  start: string;
  end: string;
  role: string;
  roles: string[];
}

const booking = (n: BookingNames): DenseSchema =>
  schema(
    object(n.room, int(n.roomNumber, 0, 999), int(n.floor, -2, 40), bool(n.hasProjector), enumeration(n.seating, n.seatings)),
    fixed(n.temperature, 10, 30, 0.5),
    enumeration(n.mode, n.modes),
    array(n.bookings, 0, 10, object(n.booking, int(n.start, 0, 1439), int(n.end, 0, 1439), enumeration(n.role, n.roles)))
  );

const length = definition('length', { mm: { min: 0, max: 1000 }, m: { min: 0, max: 100, precision: 0.01 } });
const vec3 = template(object('vec3', fixed('x', -10, 10, 0.01), fixed('y', -10, 10, 0.01), fixed('z', -10, 10, 0.01)));

/** Sample name -> schema; `script` says which compaction threshold applies */
export const schemaSamples: Record<string, { schema: DenseSchema; script: 'latin' | 'other' }> = {
  English: {
    script: 'latin',
    schema: booking({
      room: 'room', roomNumber: 'roomNumber', floor: 'floor', hasProjector: 'hasProjector', seating: 'seating',
      seatings: ['theatre', 'classroom', 'boardroom', 'uShape'], temperature: 'temperature', mode: 'mode',
      modes: ['eco', 'normal', 'performance'], bookings: 'bookings', booking: 'booking', start: 'startTime',
      end: 'endTime', role: 'organiserRole', roles: ['student', 'teacher', 'guest']
    })
  },
  German: {
    script: 'latin',
    schema: booking({
      room: 'Raum', roomNumber: 'Raumnummer', floor: 'Stockwerk', hasProjector: 'hatBeamer', seating: 'Bestuhlung',
      seatings: ['Theater', 'Klassenzimmer', 'Konferenz', 'UForm'], temperature: 'Temperatur', mode: 'Betriebsmodus',
      modes: ['Sparmodus', 'Normalbetrieb', 'Höchstleistung'], bookings: 'Buchungen', booking: 'Buchung', start: 'Beginn',
      end: 'Ende', role: 'RolleDesVeranstalters', roles: ['Schüler', 'Lehrkraft', 'Gast']
    })
  },
  French: {
    script: 'latin',
    schema: booking({
      room: 'salle', roomNumber: 'numéroDeSalle', floor: 'étage', hasProjector: 'aUnProjecteur', seating: 'disposition',
      seatings: ['théâtre', 'salleDeClasse', 'conseil', 'enU'], temperature: 'température', mode: 'mode',
      modes: ['économie', 'normal', 'performance'], bookings: 'réservations', booking: 'réservation', start: 'heureDeDébut',
      end: 'heureDeFin', role: 'rôleOrganisateur', roles: ['élève', 'enseignant', 'invité']
    })
  },
  Dutch: {
    script: 'latin',
    schema: booking({
      room: 'ruimte', roomNumber: 'kamernummer', floor: 'verdieping', hasProjector: 'heeftProjector', seating: 'opstelling',
      seatings: ['theater', 'klaslokaal', 'vergaderzaal', 'hoefijzer'], temperature: 'temperatuur', mode: 'modus',
      modes: ['zuinig', 'normaal', 'prestatie'], bookings: 'boekingen', booking: 'boeking', start: 'begintijd',
      end: 'eindtijd', role: 'rolOrganisator', roles: ['leerling', 'docent', 'gast']
    })
  },
  'Greek / math': {
    script: 'other',
    schema: schema(
      object('pendulum', fixed('θ₀', -3.14, 3.14, 0.01), fixed('ω', 0, 10, 0.01), fixed('ℓ (m)', 0.1, 10, 0.1), fixed('g', 9, 10, 0.01)),
      fixed('Δt', 0.001, 1, 0.001),
      enumeration('integrator', ['Euler', 'Runge–Kutta 4', 'Verlet']),
      fixed('μ', 0, 1, 0.01),
      fixed('ε₀', 0, 10, 0.1),
      enumeration('∇·E', ['= ρ/ε₀', '= 0']),
      int('∑n', 0, 100),
      optional('σ²', fixed('σ² value', 0, 5, 0.01)),
      fixed('ℏω', 0, 1, 0.001),
      fixed('∂f/∂x', -1, 1, 0.01)
    )
  },
  'Emoji / CJK / Arabic': {
    script: 'other',
    schema: schema(
      object('设备', int('编号', 0, 9999), enumeration('模式', ['节能', '正常', '高性能'])),
      fixed('🌡️ temperature', -40, 125, 0.1),
      enumeration('状态 status', ['✅ ok', '⚠️ warning', '❌ error']),
      bool('👩‍💻 developerMode'),
      object('موقع', fixed('خط العرض', -90, 90, 0.0001), fixed('خط الطول', -180, 180, 0.0001)),
      enumeration('🇳🇱 provincie', ['Noord-Holland', 'Zuid-Holland', 'Utrecht'])
    )
  },
  GLSL: { script: 'latin', schema: GLSLRayMarchingSchema },
  'README device': {
    script: 'latin',
    schema: schema(
      int('deviceId', 0, 1000),
      bool('enabled'),
      fixed('temperature', -40, 125, 0.1),
      enumeration('mode', ['eco', 'normal', 'performance'])
    )
  },
  'README templates + definitions': {
    script: 'latin',
    schema: schema(
      reference('position', vec3),
      reference('rotation', vec3),
      referenceNumeric('width', length),
      referenceNumeric('height', length)
    )
  }
};
