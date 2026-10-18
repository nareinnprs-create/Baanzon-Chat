module.exports = {
  /**
   * Coverage is on by default and enforced by the `coverageThreshold` below;
   * `scripts/validate.mjs` re-checks the floor from
   * `coverage/coverage-summary.json` and fails the run on a miss.
   * `VALIDATE_NO_COVERAGE=1` (`validate.mjs --no-coverage`) turns it off — the
   * root `test:*` script delegates through a nested `npm run` that swallows
   * appended flags, so `--coverage=false` cannot be forwarded to jest.
   */
  collectCoverage: process.env.VALIDATE_NO_COVERAGE !== '1',
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura', 'json-summary'],
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
