// glsl-ray-marching.ts - the GLSL ray marching schema, shared by tests and the benchmark
import { schema, int, fixed, bool, enumeration, object, array, optional } from '../../schema/builder';

export enum AttributeNames {
  Version = 'version',
  Viewport = 'Viewport',
  Canvas = 'Canvas',
  CanvasFullScreen = 'Canvas Full Screen',
  CanvasWidth = 'Canvas Width',
  CanvasHeight = 'Canvas Height',
  Rotation = 'Rotation',
  WorldOrigin = 'Origin',
  WorldEulerAngles = 'Euler Angles',
  ZoomLevel = 'Zoom Level',
  MousePosition = 'Mouse Position',
  CenterCoordinate = 'Center Coordinate',
  PositionX = 'Position X',
  PositionY = 'Position Y',
  Methods = 'Methods',
  PreProcessingMethods = 'PreProcessing Methods',
  PostProcessingMethods = 'PostProcessing Methods',
  MainMethods = 'Main Methods',
  MethodEnumMain = 'MainMethodEnum',
  MethodEnumPost = 'MethodEnumPost',
  MethodEnumPre = 'MethodEnumPre',
  MethodScale = 'MethodScale',
  Shmuck = 'Shmuck',
  DiscreteGradient = 'Discrete Gradient',
  ColorCount = 'Colour Count',
  R = 'R',
  G = 'G',
  B = 'B',
  H = 'H',
  S = 'S',
  V = 'V',
  XSpacing = 'X Spacing',
  YSpacing = 'Y Spacing',
  X = 'X',
  Y = 'Y',
  Z = 'Z',
  Pitch = 'Pitch',
  Roll = 'Roll',
  Yaw = 'Yaw'
}

export enum MethodNames {
  Gyroid = 'Gyroid',
  SchwarzD = 'SchwarzD',
  SchwarzP = 'SchwarzP',
  Perlin = 'Perlin',
  Neovius = 'Neovius',
  Mandelbrot = 'Mandelbrot',
  Sin = 'Sine',
  Cos = 'Cosine',
  Complex = 'Complex',
  Modulus = 'Modulus',
  AlternatingMoldus = 'AlternatingMoldus',
  None = 'None'
}

export const mainMethods = [
  MethodNames.Gyroid,
  MethodNames.SchwarzD,
  MethodNames.SchwarzP,
  MethodNames.Perlin,
  MethodNames.Neovius,
  MethodNames.Mandelbrot
];
export const preProcessingMethods = [MethodNames.Complex, MethodNames.Modulus, MethodNames.AlternatingMoldus];
export const postProcessingMethods = [MethodNames.Sin, MethodNames.Cos];

export const MainMethodLabels = mainMethods.map((value, index) => ({ value: index, label: value }));
export const PreProcessingMethodLabels = preProcessingMethods.map((value, index) => ({ value: index, label: value }));
export const PostProcessingMethodLabels = postProcessingMethods.map((value, index) => ({ value: index, label: value }));

// Build the GLSL Ray Marching Schema
export const GLSLRayMarchingSchema = schema(
  object(
    'Viewport',
    optional('CanvasFullScreen', object('Canvas', int('CanvasWidth', 200, 4200), int('CanvasHeight', 200, 4200))),
    object('Origin', fixed('X', -500, 500, 0.001), fixed('Y', -500, 500, 0.001), fixed('Z', -500, 500, 0.001)),
    object('Euler Angles', fixed('Pitch', -180, 180, 0.1), fixed('Roll', -180, 180, 0.1), fixed('Yaw', -180, 180, 0.1)),
    object(
      'Mouse Position',
      fixed('Rotation', 0, 360, 0.1),
      fixed('Zoom Level', 0.001, 1000, 0.001),
      object('Center Coordinate', fixed('Position X', -1, 1, 0.001), fixed('Position Y', -1, 1, 0.001))
    )
  ),
  object(
    'Methods',
    optional(
      'PreProcessing Methods',
      object(
        'PreMethod',
        enumeration('MethodEnumPre', preProcessingMethods),
        fixed('X Spacing', 0.1, 100, 0.001),
        fixed('Y Spacing', 0.1, 100, 0.001)
      )
    ),
    array(
      'Main Methods',
      1,
      3,
      object('MainMethod', enumeration('MainMethodEnum', mainMethods), fixed('MethodScale', 0.001, 1000, 0.001))
    ),
    optional(
      'PostProcessing Methods',
      object(
        'PostMethod',
        enumeration('MethodEnumPost', postProcessingMethods),
        fixed('MethodScale', 0.001, 1000, 0.001)
      )
    )
  ),
  object(
    'Shmuck',
    bool('Discrete Gradient'),
    array('Colour Count', 2, 10, object('Color', int('R', 0, 255), int('G', 0, 255), int('B', 0, 255)))
  )
);
