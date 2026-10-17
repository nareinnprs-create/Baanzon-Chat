import { logger } from '@librechat/data-schemas';
import { isFalsyEnvValue, normalizeEnvValue, parseEnvSwitch } from './env';

describe('normalizeEnvValue', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEnvValue('  On ')).toBe('on');
    expect(normalizeEnvValue('FALSE')).toBe('false');
  });

  it('normalizes nullish values to an empty string', () => {
    expect(normalizeEnvValue(undefined)).toBe('');
    expect(normalizeEnvValue(null as unknown as string)).toBe('');
  });

  it('leaves an empty string untouched', () => {
    expect(normalizeEnvValue('')).toBe('');
  });
});

describe('isFalsyEnvValue', () => {
  it.each(['false', '0', 'no', 'off', 'disabled', 'none'])('treats "%s" as falsy', (value) => {
    expect(isFalsyEnvValue(value)).toBe(true);
  });

  it('does not treat truthy tokens or raw input as falsy', () => {
    expect(isFalsyEnvValue('true')).toBe(false);
    expect(isFalsyEnvValue('')).toBe(false);
    expect(isFalsyEnvValue(' FALSE ')).toBe(false);
  });
});

describe('parseEnvSwitch', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  it.each(['true', '1', 'yes', 'on', 'enabled'])('resolves the truthy token "%s"', (value) => {
    expect(parseEnvSwitch('FEATURE', value, false)).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'disabled', 'none'])(
    'resolves the falsy token "%s"',
    (value) => {
      expect(parseEnvSwitch('FEATURE', value, true)).toBe(false);
    },
  );

  it('is case and whitespace insensitive', () => {
    expect(parseEnvSwitch('FEATURE', '  YeS  ', false)).toBe(true);
    expect(parseEnvSwitch('FEATURE', '\tOFF\n', true)).toBe(false);
  });

  it('falls back to the provided default when unset, without warning', () => {
    expect(parseEnvSwitch('FEATURE', undefined, true)).toBe(true);
    expect(parseEnvSwitch('FEATURE', undefined, false)).toBe(false);
    expect(parseEnvSwitch('FEATURE', '', true)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and falls back to the default for an unrecognized value', () => {
    const result = parseEnvSwitch('SECURITY_TOGGLE', 'maybe', true);

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('SECURITY_TOGGLE');
    expect(message).toContain('maybe');
    expect(message).toContain('true');
  });

  it('does not flip a toggle to the opposite of the default on a typo', () => {
    expect(parseEnvSwitch('SECURE_DEFAULTS_ON', 'tru', false)).toBe(false);
    expect(parseEnvSwitch('SECURE_DEFAULTS_OFF', 'fals', true)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
