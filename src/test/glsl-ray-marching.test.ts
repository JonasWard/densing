import { expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { getDefaultData } from '../schema';
import { GLSLRayMarchingSchema } from './fixtures/glsl-ray-marching';

export * from './fixtures/glsl-ray-marching';

// Test data
const testData = {
  Viewport: {
    CanvasFullScreen: null, // Fullscreen, no custom dimensions
    Origin: {
      X: 1,
      Y: 1,
      Z: 1
    },
    'Euler Angles': {
      Pitch: 0,
      Roll: 0,
      Yaw: 0
    },
    'Mouse Position': {
      Rotation: 0,
      'Zoom Level': 1,
      'Center Coordinate': {
        'Position X': 0,
        'Position Y': 0
      }
    }
  },
  Methods: {
    'PreProcessing Methods': null,
    'Main Methods': [
      {
        MainMethodEnum: 'Gyroid',
        MethodScale: 1
      }
    ],
    'PostProcessing Methods': null
  },
  Shmuck: {
    'Discrete Gradient': false,
    'Colour Count': [
      { R: 255, G: 0, B: 0 },
      { R: 0, G: 255, B: 0 }
    ]
  }
};

test('GLSL Ray Marching - basic round-trip', () => {
  const encoded = densing(GLSLRayMarchingSchema, testData);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  expect(decoded).toMatchObject(testData);
});

test('GLSL Ray Marching - with preprocessing', () => {
  const dataWithPre = {
    ...testData,
    Methods: {
      ...testData.Methods,
      'PreProcessing Methods': {
        MethodEnumPre: 'Complex',
        'X Spacing': 1,
        'Y Spacing': 1
      }
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, dataWithPre);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  expect(decoded).toMatchObject(dataWithPre);
});

test('GLSL Ray Marching - with postprocessing', () => {
  const dataWithPost = {
    ...testData,
    Methods: {
      ...testData.Methods,
      'PostProcessing Methods': {
        MethodEnumPost: 'Sine',
        MethodScale: 2.5
      }
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, dataWithPost);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  expect(decoded).toMatchObject(dataWithPost);
});

test('GLSL Ray Marching - getDefaultData', () => {
  const defaultData = getDefaultData(GLSLRayMarchingSchema);
  const encoded = densing(GLSLRayMarchingSchema, defaultData);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  console.log('Default data:', JSON.stringify(defaultData, null, 2));
  console.log('Encoded:', JSON.stringify(encoded, null, 2));
  console.log('Decoded:', JSON.stringify(decoded, null, 2));

  expect(decoded).toMatchObject(defaultData);
});

test('GLSL Ray Marching - with custom canvas size', () => {
  const dataWithCanvas = {
    ...testData,
    Viewport: {
      ...testData.Viewport,
      CanvasFullScreen: {
        CanvasWidth: 1920,
        CanvasHeight: 1080
      }
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, dataWithCanvas);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  expect(decoded).toMatchObject(dataWithCanvas);
});

test('GLSL Ray Marching - multiple main methods', () => {
  const dataWithMultipleMethods = {
    ...testData,
    Methods: {
      ...testData.Methods,
      'Main Methods': [
        {
          MainMethodEnum: 'Gyroid',
          MethodScale: 1
        },
        {
          MainMethodEnum: 'SchwarzP',
          MethodScale: 2.5
        },
        {
          MainMethodEnum: 'Perlin',
          MethodScale: 0.5
        }
      ]
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, dataWithMultipleMethods);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  // Check array length
  expect(decoded.Methods['Main Methods'].length).toBe(3);
  // Check enum values
  expect(decoded.Methods['Main Methods'][0].MainMethodEnum).toBe('Gyroid');
  expect(decoded.Methods['Main Methods'][1].MainMethodEnum).toBe('SchwarzP');
  expect(decoded.Methods['Main Methods'][2].MainMethodEnum).toBe('Perlin');
  // Check scale values (allow floating point precision errors)
  expect(decoded.Methods['Main Methods'][0].MethodScale).toBeCloseTo(1, 2);
  expect(decoded.Methods['Main Methods'][1].MethodScale).toBeCloseTo(2.5, 2);
  expect(decoded.Methods['Main Methods'][2].MethodScale).toBeCloseTo(0.5, 2);
});

test('GLSL Ray Marching - complex gradient colors', () => {
  const dataWithGradient = {
    ...testData,
    Shmuck: {
      'Discrete Gradient': true,
      'Colour Count': [
        { R: 255, G: 0, B: 0 },
        { R: 255, G: 128, B: 0 },
        { R: 255, G: 255, B: 0 },
        { R: 0, G: 255, B: 0 },
        { R: 0, G: 255, B: 255 },
        { R: 0, G: 0, B: 255 }
      ]
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, dataWithGradient);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  expect(decoded).toMatchObject(dataWithGradient);
});

test('GLSL Ray Marching - full featured configuration', () => {
  const fullData = {
    Viewport: {
      CanvasFullScreen: {
        CanvasWidth: 2560,
        CanvasHeight: 1440
      },
      Origin: {
        X: 10.5,
        Y: -20.3,
        Z: 15.7
      },
      'Euler Angles': {
        Pitch: 45,
        Roll: -30,
        Yaw: 90
      },
      'Mouse Position': {
        Rotation: 180,
        'Zoom Level': 5.5,
        'Center Coordinate': {
          'Position X': 0.5,
          'Position Y': -0.3
        }
      }
    },
    Methods: {
      'PreProcessing Methods': {
        MethodEnumPre: 'Modulus',
        'X Spacing': 2.5,
        'Y Spacing': 3.7
      },
      'Main Methods': [
        {
          MainMethodEnum: 'Mandelbrot',
          MethodScale: 10.5
        },
        {
          MainMethodEnum: 'Gyroid',
          MethodScale: 0.75
        }
      ],
      'PostProcessing Methods': {
        MethodEnumPost: 'Cosine',
        MethodScale: 1.25
      }
    },
    Shmuck: {
      'Discrete Gradient': true,
      'Colour Count': [
        { R: 25, G: 50, B: 100 },
        { R: 100, G: 150, B: 200 },
        { R: 200, G: 220, B: 255 }
      ]
    }
  };

  const encoded = densing(GLSLRayMarchingSchema, fullData);
  const decoded = undensing(GLSLRayMarchingSchema, encoded);

  // Verify structure and exact values where possible
  expect(decoded.Viewport.CanvasFullScreen!.CanvasWidth).toBe(2560);
  expect(decoded.Viewport.CanvasFullScreen!.CanvasHeight).toBe(1440);

  // Verify floating point values with tolerance
  expect(decoded.Viewport.Origin.X).toBeCloseTo(10.5, 2);
  expect(decoded.Viewport.Origin.Y).toBeCloseTo(-20.3, 2);
  expect(decoded.Viewport.Origin.Z).toBeCloseTo(15.7, 2);

  expect(decoded.Viewport['Euler Angles'].Pitch).toBeCloseTo(45, 1);
  expect(decoded.Viewport['Euler Angles'].Roll).toBeCloseTo(-30, 1);
  expect(decoded.Viewport['Euler Angles'].Yaw).toBeCloseTo(90, 1);

  expect(decoded.Viewport['Mouse Position'].Rotation).toBeCloseTo(180, 1);
  expect(decoded.Viewport['Mouse Position']['Zoom Level']).toBeCloseTo(5.5, 2);
  expect(decoded.Viewport['Mouse Position']['Center Coordinate']['Position X']).toBeCloseTo(0.5, 2);
  expect(decoded.Viewport['Mouse Position']['Center Coordinate']['Position Y']).toBeCloseTo(-0.3, 2);

  // Verify methods
  expect(decoded.Methods['PreProcessing Methods']!.MethodEnumPre).toBe('Modulus');
  expect(decoded.Methods['PreProcessing Methods']!['X Spacing']).toBeCloseTo(2.5, 2);
  expect(decoded.Methods['PreProcessing Methods']!['Y Spacing']).toBeCloseTo(3.7, 2);

  expect(decoded.Methods['Main Methods'].length).toBe(2);
  expect(decoded.Methods['Main Methods'][0].MainMethodEnum).toBe('Mandelbrot');
  expect(decoded.Methods['Main Methods'][0].MethodScale).toBeCloseTo(10.5, 2);
  expect(decoded.Methods['Main Methods'][1].MainMethodEnum).toBe('Gyroid');
  expect(decoded.Methods['Main Methods'][1].MethodScale).toBeCloseTo(0.75, 2);

  expect(decoded.Methods['PostProcessing Methods']!.MethodEnumPost).toBe('Cosine');
  expect(decoded.Methods['PostProcessing Methods']!.MethodScale).toBeCloseTo(1.25, 2);

  // Verify colors
  expect(decoded.Shmuck['Discrete Gradient']).toBe(true);
  expect(decoded.Shmuck['Colour Count'].length).toBe(3);
  expect(decoded.Shmuck['Colour Count'][0]).toEqual({ R: 25, G: 50, B: 100 });
  expect(decoded.Shmuck['Colour Count'][1]).toEqual({ R: 100, G: 150, B: 200 });
  expect(decoded.Shmuck['Colour Count'][2]).toEqual({ R: 200, G: 220, B: 255 });
});

test('GLSL Ray Marching - encoding efficiency', () => {
  const encoded = densing(GLSLRayMarchingSchema, testData);

  // The schema is complex with lots of data, but should still be compact
  expect(encoded.length).toBeGreaterThan(0);
  expect(encoded.length).toBeLessThan(200); // Should be reasonably compact
});
