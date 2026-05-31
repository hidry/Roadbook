/**
 * Jest runs the PURE TypeScript logic of the app (clustering, suggestion,
 * mappers, geocoding parsing) — modules that deliberately do not import React
 * Native, so they can be tested headlessly with ts-jest in a node environment.
 * UI / native-module behaviour is verified on a device, not here.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // The pure modules don't need the app tsconfig's RN/JSX settings.
        // rootDir '.' keeps both src/ and __tests__/ in scope (TS 6 needs it
        // explicit); isolatedModules speeds up per-file transpilation.
        tsconfig: {
          rootDir: '.',
          module: 'commonjs',
          target: 'es2021',
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
