import type { mcpConfig as McpConfig } from './mcpConfig';

const ORIGINAL_ENV = { ...process.env };

const MCP_ENV_KEYS = [
  'MCP_OAUTH_ON_AUTH_ERROR',
  'MCP_OAUTH_DETECTION_TIMEOUT',
  'MCP_OAUTH_HANDLING_TIMEOUT',
  'MCP_OAUTH_FLOW_TTL',
  'MCP_CONNECTION_CHECK_TTL',
  'MCP_TOOLS_LIST_MAX_PAGES',
  'MCP_TOOLS_LIST_MAX_TOOLS',
  'MCP_TOOLS_LIST_MAX_BYTES',
  'MCP_TOOLS_LIST_TIMEOUT_MS',
  'MCP_USER_CONNECTION_IDLE_TIMEOUT',
  'MCP_CB_MAX_CYCLES',
  'MCP_CB_CYCLE_WINDOW_MS',
  'MCP_CB_CYCLE_COOLDOWN_MS',
  'MCP_CB_MAX_FAILED_ROUNDS',
  'MCP_CB_FAILED_WINDOW_MS',
  'MCP_CB_BASE_BACKOFF_MS',
  'MCP_CB_MAX_BACKOFF_MS',
];

/**
 * `mcpConfig` reads `process.env` at module load, so each scenario must clear the
 * known MCP keys, apply overrides, then re-`require` the module from scratch.
 */
const loadConfig = (overrides: Record<string, string> = {}): typeof McpConfig => {
  jest.resetModules();

  for (const key of MCP_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('./mcpConfig') as typeof import('./mcpConfig');
  return loaded.mcpConfig;
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('mcpConfig', () => {
  describe('defaults', () => {
    it('applies documented defaults when nothing is configured', () => {
      const config = loadConfig();

      expect(config).toEqual({
        OAUTH_ON_AUTH_ERROR: true,
        OAUTH_DETECTION_TIMEOUT: 5000,
        OAUTH_HANDLING_TIMEOUT: 10 * 60 * 1000,
        OAUTH_FLOW_TTL: 15 * 60 * 1000,
        CONNECTION_CHECK_TTL: 60000,
        TOOLS_LIST_MAX_PAGES: 50,
        TOOLS_LIST_MAX_TOOLS: 1000,
        TOOLS_LIST_MAX_BYTES: 5 * 1024 * 1024,
        TOOLS_LIST_TIMEOUT_MS: 30000,
        USER_CONNECTION_IDLE_TIMEOUT: 15 * 60 * 1000,
        CB_MAX_CYCLES: 7,
        CB_CYCLE_WINDOW_MS: 45_000,
        CB_CYCLE_COOLDOWN_MS: 15_000,
        CB_MAX_FAILED_ROUNDS: 3,
        CB_FAILED_WINDOW_MS: 120_000,
        CB_BASE_BACKOFF_MS: 30_000,
        CB_MAX_BACKOFF_MS: 300_000,
      });
    });
  });

  describe('OAUTH_ON_AUTH_ERROR', () => {
    it('accepts a boolean-like env string case-insensitively', () => {
      expect(loadConfig({ MCP_OAUTH_ON_AUTH_ERROR: 'false' }).OAUTH_ON_AUTH_ERROR).toBe(false);
      expect(loadConfig({ MCP_OAUTH_ON_AUTH_ERROR: 'TRUE' }).OAUTH_ON_AUTH_ERROR).toBe(true);
    });
  });

  describe('numeric overrides', () => {
    it('parses plain numbers from the environment', () => {
      const config = loadConfig({
        MCP_OAUTH_DETECTION_TIMEOUT: '1234',
        MCP_CONNECTION_CHECK_TTL: '9000',
        MCP_USER_CONNECTION_IDLE_TIMEOUT: '45000',
        MCP_CB_MAX_CYCLES: '10',
      });

      expect(config.OAUTH_DETECTION_TIMEOUT).toBe(1234);
      expect(config.CONNECTION_CHECK_TTL).toBe(9000);
      expect(config.USER_CONNECTION_IDLE_TIMEOUT).toBe(45000);
      expect(config.CB_MAX_CYCLES).toBe(10);
    });

    it('evaluates mathematical expressions', () => {
      expect(loadConfig({ MCP_TOOLS_LIST_MAX_PAGES: '2*3' }).TOOLS_LIST_MAX_PAGES).toBe(6);
    });
  });

  describe('pagination clamps', () => {
    it.each(['0', '-5'])('never lets TOOLS_LIST_MAX_PAGES fall below 1 (%s)', (value) => {
      expect(loadConfig({ MCP_TOOLS_LIST_MAX_PAGES: value }).TOOLS_LIST_MAX_PAGES).toBe(1);
    });

    it('clamps TOOLS_LIST_MAX_TOOLS, TOOLS_LIST_MAX_BYTES and TOOLS_LIST_TIMEOUT_MS to >= 1', () => {
      const config = loadConfig({
        MCP_TOOLS_LIST_MAX_TOOLS: '0',
        MCP_TOOLS_LIST_MAX_BYTES: '-1',
        MCP_TOOLS_LIST_TIMEOUT_MS: '0',
      });

      expect(config.TOOLS_LIST_MAX_TOOLS).toBe(1);
      expect(config.TOOLS_LIST_MAX_BYTES).toBe(1);
      expect(config.TOOLS_LIST_TIMEOUT_MS).toBe(1);
    });

    it('keeps configured values that are above the floor', () => {
      const config = loadConfig({
        MCP_TOOLS_LIST_MAX_PAGES: '200',
        MCP_TOOLS_LIST_MAX_TOOLS: '5000',
        MCP_TOOLS_LIST_MAX_BYTES: '1048576',
        MCP_TOOLS_LIST_TIMEOUT_MS: '15000',
      });

      expect(config.TOOLS_LIST_MAX_PAGES).toBe(200);
      expect(config.TOOLS_LIST_MAX_TOOLS).toBe(5000);
      expect(config.TOOLS_LIST_MAX_BYTES).toBe(1048576);
      expect(config.TOOLS_LIST_TIMEOUT_MS).toBe(15000);
    });
  });

  describe('OAUTH_FLOW_TTL clamp', () => {
    it('raises the TTL to outlive the handling timeout plus the grace period', () => {
      const config = loadConfig({
        MCP_OAUTH_HANDLING_TIMEOUT: '1200000',
        MCP_OAUTH_FLOW_TTL: '600000',
      });

      expect(config.OAUTH_HANDLING_TIMEOUT).toBe(1_200_000);
      expect(config.OAUTH_FLOW_TTL).toBe(1_200_000 + 60_000);
    });

    it('applies the floor even when only the handling timeout is raised', () => {
      const config = loadConfig({ MCP_OAUTH_HANDLING_TIMEOUT: '1200000' });

      expect(config.OAUTH_FLOW_TTL).toBe(1_200_000 + 60_000);
    });

    it('honors a configured TTL that already exceeds the floor', () => {
      const config = loadConfig({
        MCP_OAUTH_HANDLING_TIMEOUT: '600000',
        MCP_OAUTH_FLOW_TTL: '1800000',
      });

      expect(config.OAUTH_FLOW_TTL).toBe(1_800_000);
    });
  });
});
