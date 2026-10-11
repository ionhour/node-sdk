export default {
  displayName: 'sdk-nestjs',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Resolve the workspace dependency to source so tests run without a prior build.
  moduleNameMapper: {
    '^@ionhour/core$': '<rootDir>/../sdk-core/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/sdk-nestjs',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
