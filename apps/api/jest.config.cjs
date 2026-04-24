/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@bim-quantify/ifc-parser$': '<rootDir>/../../packages/ifc-parser/src/index.ts',
    '^@bim-quantify/bcf-parser$': '<rootDir>/../../packages/bcf-parser/src/index.ts',
    '^@bim-quantify/ai-takeoff$': '<rootDir>/../../packages/ai-takeoff/src/index.ts',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts'],
};
