const path = require('path');
const apiConfig = require('../api/jest.config');

const apiDir = path.resolve(__dirname, '..', 'api');

const resolvedMapper = Object.fromEntries(
  Object.entries(apiConfig.moduleNameMapper).map(([key, value]) => [
    key,
    value.replace('<rootDir>', apiDir),
  ]),
);

module.exports = {
  ...apiConfig,
  roots: ['<rootDir>'],
  setupFiles: apiConfig.setupFiles.map((f) => path.resolve(apiDir, f)),
  moduleNameMapper: resolvedMapper,
  /** collectCoverage is inherited from apiConfig; the source set is this
   * directory's maintenance scripts only. */
  collectCoverageFrom: ['*.js', '!jest.config.js'],
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 20.11 / branches 14.72 / functions 23.20 / lines 19.72), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 18,
      branches: 12,
      functions: 21,
      lines: 17,
    },
  },
};
