export default {
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura'],
  /**
   * Floors sit two points below the measured suite coverage
   * (statements 57.17 / branches 50.98 / functions 49.67 / lines 56.77), so a
   * normal run passes while CI still fails on a silent regression.
   */
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 48,
      functions: 47,
      lines: 54,
    },
  },
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  maxWorkers: '50%',
  restoreMocks: true,
  testTimeout: 15000,
  // React component testing requires jsdom environment
  testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'http://localhost:3080' },
  resolver: '<rootDir>/jest.resolver.cjs',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@tanstack|lucide-react|lucide|morphicons|@dicebear|@ariakit/react-components|@ariakit/react-utils|@ariakit/react-store|@ariakit/components|@ariakit/store|@ariakit/utils)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
