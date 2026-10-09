import { RAG_API_URL, RAG_DEFAULTS, loadRagConfig, isRagApiConfigured, usesRagApi } from './config';

const URL = 'https://rag.example.com';

describe('rag config', () => {
  const original = process.env[RAG_API_URL];

  beforeEach(() => {
    delete process.env[RAG_API_URL];
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env[RAG_API_URL];
    } else {
      process.env[RAG_API_URL] = original;
    }
  });

  describe('loadRagConfig', () => {
    it('returns the defaults with an empty apiUrl when the env is unset', () => {
      expect(loadRagConfig()).toEqual({ ...RAG_DEFAULTS, apiUrl: '' });
    });

    it('regression: reads a real URL out of the env instead of discarding it', () => {
      process.env[RAG_API_URL] = URL;

      expect(loadRagConfig().apiUrl).toBe(URL);
    });

    it('trims surrounding whitespace off the env value', () => {
      process.env[RAG_API_URL] = `  ${URL}  `;

      expect(loadRagConfig().apiUrl).toBe(URL);
    });

    it('treats a whitespace-only env value as unset', () => {
      process.env[RAG_API_URL] = '   ';

      expect(loadRagConfig().apiUrl).toBe('');
    });

    it('does not mistake a bare scheme-less host for a boolean flag', () => {
      process.env[RAG_API_URL] = 'rag.example.com';

      expect(loadRagConfig().apiUrl).toBe('rag.example.com');
    });
  });

  describe('isRagApiConfigured', () => {
    it('regression: reports a real URL as configured', () => {
      expect(isRagApiConfigured({ apiUrl: URL })).toBe(true);
    });

    it('reports a padded real URL as configured', () => {
      expect(isRagApiConfigured({ apiUrl: `\t${URL}\n` })).toBe(true);
    });

    it('reports an empty apiUrl as not configured', () => {
      expect(isRagApiConfigured({ apiUrl: '' })).toBe(false);
    });

    it('reports a whitespace-only apiUrl as not configured', () => {
      expect(isRagApiConfigured({ apiUrl: '  \t ' })).toBe(false);
    });

    it('does not require a URL scheme', () => {
      expect(isRagApiConfigured({ apiUrl: 'rag.internal:8080' })).toBe(true);
    });
  });

  describe('usesRagApi', () => {
    it('is true when an apiUrl is configured', () => {
      expect(usesRagApi({ apiUrl: URL })).toBe(true);
    });

    it('is false when no apiUrl is configured', () => {
      expect(usesRagApi({ apiUrl: '' })).toBe(false);
    });

    it('is false for a whitespace-only apiUrl', () => {
      expect(usesRagApi({ apiUrl: '  ' })).toBe(false);
    });

    it('agrees with isRagApiConfigured', () => {
      for (const apiUrl of ['', '   ', URL, 'rag.internal']) {
        expect(usesRagApi({ apiUrl })).toBe(isRagApiConfigured({ apiUrl }));
      }
    });
  });
});
