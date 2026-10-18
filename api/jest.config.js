const esModules = [
  'openid-client',
  'oauth4webapi',
  'jose',
  '@langchain/langgraph',
  '@langchain/langgraph-checkpoint',
  '@langchain/langgraph-sdk',
  '@mistralai/mistralai',
  'uuid',
  'sanitize-html',
  'htmlparser2',
  'domhandler',
  'domelementtype',
  'domutils',
  'dom-serializer',
  'entities',
].join('|');

module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  roots: ['<rootDir>'],
  coverageDirectory: 'coverage',
  maxWorkers: '50%',
  testTimeout: 30000, // 30 seconds timeout for all tests
  setupFiles: ['./test/jestSetup.js', './test/__mocks__/logger.js'],
  moduleNameMapper: {
    '~/(.*)': '<rootDir>/$1',
    '~/data/auth.json': '<rootDir>/__mocks__/auth.mock.json',
    '^openid-client/passport$': '<rootDir>/test/__mocks__/openid-client-passport.js',
    '^openid-client$': '<rootDir>/test/__mocks__/openid-client.js',
  },
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
  /**
   * Coverage is on by default and its `coverageThreshold` below is enforced —
   * `scripts/validate.mjs` fails the run when this floor is missed. The root
   * `test:*` scripts delegate through a nested `npm run`, which swallows
   * appended flags, so the harness cannot pass `--coverage=false` down to jest;
   * it sets `VALIDATE_NO_COVERAGE=1` (`validate.mjs --no-coverage`) instead.
   */
  collectCoverage: process.env.VALIDATE_NO_COVERAGE !== '1',
  collectCoverageFrom: [
    'app/**/*.{js,ts}',
    'cache/**/*.{js,ts}',
    'config/**/*.{js,ts}',
    'db/**/*.{js,ts}',
    'models/**/*.{js,ts}',
    'server/**/*.{js,ts}',
    'strategies/**/*.{js,ts}',
    'utils/**/*.{js,ts}',
    '!**/*.spec.{js,ts}',
    '!**/*.test.{js,ts}',
    '!**/*.d.ts',
    '!**/index.{js,ts}',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  // json-summary is what `scripts/validate.mjs` reads back to re-check these
  // floors independently of jest's own exit code.
  coverageReporters: ['text', 'cobertura', 'json-summary'],
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 70.80 / branches 64.77 / functions 65.83 / lines 70.96), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 68,
      branches: 62,
      functions: 63,
      lines: 68,
    },
  },
};
