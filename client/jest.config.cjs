/** v0.8.8-rc2 */
module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:3080',
  },
  /**
   * Coverage is on by default and its `coverageThreshold` below is enforced —
   * `scripts/validate.mjs` re-checks the floor from
   * `coverage/coverage-summary.json` and fails the run on a miss. The root
   * `test:*` script delegates through a nested `npm run` that rejects forwarded
   * flags, so the harness cannot pass `--coverage=false` down to jest; it sets
   * `VALIDATE_NO_COVERAGE=1` (`validate.mjs --no-coverage`) instead.
   */
  collectCoverage: process.env.VALIDATE_NO_COVERAGE !== '1',
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!<rootDir>/node_modules/',
    '!src/**/*.css.d.ts',
    '!src/**/*.d.ts',
  ],
  coveragePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test/setupTests.js'],
  //  Note: eventually we want to have these values set to 80%.
  //  Floors sit two points below the measured suite coverage
  //  (statements 59.82 / branches 53.82 / functions 53.40 / lines 59.98), so a
  //  normal run passes while CI still fails on a silent regression.
  coverageThreshold: {
    global: {
      statements: 57,
      branches: 51,
      functions: 51,
      lines: 57,
    },
  },
  moduleNameMapper: {
    '\\.(css)$': 'identity-obj-proxy',
    /** Mirror the vite resolve.alias so tests parse math with the same tokenizer as production. */
    '^micromark-extension-math$': 'micromark-extension-llm-math',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      'jest-file-loader',
    '^test/(.*)$': '<rootDir>/test/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    '^librechat-data-provider/react-query$':
      '<rootDir>/../node_modules/librechat-data-provider/src/react-query',
  },
  maxWorkers: '50%',
  /** Coverage maps accumulate for the life of a worker, so a long run can push
   * a worker past a gigabyte and get it killed by the OS, which fails whatever
   * suite it was holding. Recycling bloated workers also avoids swap thrash. */
  workerIdleMemoryLimit: '800MB',
  restoreMocks: true,
  testResultsProcessor: 'jest-junit',
  coverageReporters: ['text', 'cobertura', 'lcov', 'json-summary'],
  resolver: '<rootDir>/jest.resolver.cjs',
  transform: {
    '\\.[jt]sx?$': 'babel-jest',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      'jest-file-loader',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@ariakit/react-components|@ariakit/react-utils|@ariakit/react-store|@ariakit/components|@ariakit/store|@ariakit/utils|@zattoo/use-double-click|@dicebear|@react-dnd|react-dnd.*|dnd-core|filenamify|filename-reserved-regex|heic-to|lowlight|highlight\\.js|fault|lucide-react|lucide|morphicons|react-markdown|unified|bail|trough|devlop|is-.*|parse-entities|stringify-entities|character-.*|trim-lines|style-to-object|inline-style-parser|html-url-attributes|escape-string-regexp|longest-streak|zwitch|ccount|markdown-table|comma-separated-tokens|space-separated-tokens|web-namespaces|property-information|remark-.*|rehype-.*|recma-.*|hast.*|mdast-.*|unist-.*|vfile.*|micromark.*|estree-util-.*|decode-named-character-reference)/)/',
  ],
  setupFiles: ['<rootDir>/test/polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setupTests.js'],
  clearMocks: true,
};
