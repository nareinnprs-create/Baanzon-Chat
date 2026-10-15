module.exports = {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
  },
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 67.58 / branches 71.06 / functions 38.37 / lines 69.71), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 69,
      functions: 36,
      lines: 67,
    },
  },
  maxWorkers: '50%',
  restoreMocks: true,
};
