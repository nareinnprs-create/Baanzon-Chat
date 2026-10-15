export default {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/misc/'],
  transformIgnorePatterns: [
    '/node_modules/(?!mdast-util-|micromark|decode-named-character-reference|devlop|longest-streak|unist-util-|zwitch|character-(?:entities|reference)|parse-entities|stringify-entities|is-(?:alphanumerical|alphabetical|decimal|hexadecimal)|ccount|markdown-table|escape-string-regexp)',
  ],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
  },
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 80.17 / branches 75.95 / functions 85.31 / lines 80.39), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 78,
      branches: 73,
      functions: 83,
      lines: 78,
    },
  },
  // Download the in-memory MongoDB binary once, before workers fork: on a cold
  // cache the parallel downloads race their final rename and fail whole suites.
  globalSetup: '<rootDir>/jest.globalSetup.mjs',
  setupFiles: ['<rootDir>/../../config/jest.setup.logging.cjs'],
  maxWorkers: '50%',
  restoreMocks: true,
  testTimeout: 15000,
};
