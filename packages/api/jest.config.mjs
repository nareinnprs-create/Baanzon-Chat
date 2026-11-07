const esModules = [
  '@langchain/langgraph',
  '@langchain/langgraph-checkpoint',
  '@langchain/langgraph-sdk',
  '@mistralai/mistralai',
  'domelementtype',
  'domhandler',
  'dom-serializer',
  'domutils',
  'entities',
  'htmlparser2',
  'sanitize-html',
  'uuid',
].join('|');

export default {
  /**
   * Coverage is on by default and enforced by the `coverageThreshold` below.
   * `scripts/validate.mjs` reads `coverage/coverage-summary.json` back after the
   * suite and fails the run on a missed floor. `VALIDATE_NO_COVERAGE=1`
   * (`validate.mjs --no-coverage`) is the only way to turn it off, because the
   * root `test:*` script delegates through a nested `npm run` that swallows
   * appended flags.
   */
  collectCoverage: process.env.VALIDATE_NO_COVERAGE !== '1',
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '\\.dev\\.ts$',
    '\\.helper\\.ts$',
    '\\.helper\\.d\\.ts$',
    '/__tests__/helpers/',
    '\\.manual\\.spec\\.[jt]sx?$',
  ],
  coverageReporters: ['text', 'cobertura', 'json-summary'],
  testResultsProcessor: 'jest-junit',
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esModules})/).*/`],
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '~/(.*)': '<rootDir>/src/$1',
  },
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 67.74 / branches 74.29 / functions 67.69 / lines 68.28), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 72,
      functions: 65,
      lines: 66,
    },
  },
  setupFiles: ['<rootDir>/jest.setup.cjs', '<rootDir>/../../config/jest.setup.logging.cjs'],
  maxWorkers: '50%',
  restoreMocks: true,
  testTimeout: 15000,
};
