import type { TEvalCase } from 'librechat-data-provider';
import { evaluateAssertion, scoreCase, scoreCaseResults } from './scoring';

function evalCase(overrides: Partial<TEvalCase> = {}): TEvalCase {
  return {
    name: 'greeting',
    input: 'hi',
    expected: 'Hello',
    assertions: [{ type: 'exact', value: 'Hello' }],
    ...overrides,
  };
}

describe('evaluateAssertion', () => {
  it('passes exact matches and fails near-misses', () => {
    expect(evaluateAssertion({ type: 'exact', value: 'Hello' }, 'Hello').passed).toBe(true);
    const miss = evaluateAssertion({ type: 'exact', value: 'Hello' }, 'Hello world');
    expect(miss.passed).toBe(false);
    expect(miss.message).toContain('expected exact');
  });

  it('relaxes exact to case-insensitive when caseSensitive is false', () => {
    expect(
      evaluateAssertion({ type: 'exact', value: 'HELLO', caseSensitive: false }, 'hello').passed,
    ).toBe(true);
    expect(evaluateAssertion({ type: 'exact', value: 'HELLO' }, 'hello').passed).toBe(false);
  });

  it('passes contains matches case-sensitively by default', () => {
    expect(evaluateAssertion({ type: 'contains', value: 'ell' }, 'Hello').passed).toBe(true);
    expect(evaluateAssertion({ type: 'contains', value: 'ELL' }, 'Hello').passed).toBe(false);
    expect(
      evaluateAssertion({ type: 'contains', value: 'ELL', caseSensitive: false }, 'Hello').passed,
    ).toBe(true);
  });

  it('treats the value as a regex, honoring the case flag', () => {
    expect(evaluateAssertion({ type: 'regex', value: '^Hel+o$' }, 'Hello').passed).toBe(true);
    expect(evaluateAssertion({ type: 'regex', value: '^hello$' }, 'Hello').passed).toBe(false);
    expect(
      evaluateAssertion({ type: 'regex', value: '^hello$', caseSensitive: false }, 'Hello').passed,
    ).toBe(true);
  });

  it('fails (not throws) on an invalid regex source', () => {
    const verdict = evaluateAssertion({ type: 'regex', value: '([unclosed' }, 'Hello');
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('invalid regex');
  });

  it('fails unknown assertion kinds and non-string values', () => {
    expect(evaluateAssertion({ type: 'semantic' as never, value: 'Hello' }, 'Hello').passed).toBe(
      false,
    );
    expect(evaluateAssertion({ type: 'exact', value: undefined as never }, 'Hello').passed).toBe(
      false,
    );
  });
});

describe('scoreCase', () => {
  it('passes only when every assertion passes (partial = fail)', () => {
    const multi = evalCase({
      assertions: [
        { type: 'contains', value: 'Hello' },
        { type: 'regex', value: 'world$' },
      ],
    });
    expect(scoreCase(multi, 'Hello world').passed).toBe(true);
    const partial = scoreCase(multi, 'Hello there');
    expect(partial.passed).toBe(false);
    expect(partial.failures).toHaveLength(1);
    expect(partial.failures[0]).toContain('world$');
  });

  it('fails a case with no assertions - nothing is proven', () => {
    const empty = scoreCase(evalCase({ assertions: [] }), 'anything');
    expect(empty.passed).toBe(false);
    expect(empty.failures[0]).toContain('no assertions');
  });

  it('records one failure per failing assertion', () => {
    const multi = scoreCase(
      evalCase({
        assertions: [
          { type: 'exact', value: 'Hello' },
          { type: 'contains', value: 'nope' },
        ],
      }),
      'Goodbye',
    );
    expect(multi.failures).toHaveLength(2);
  });
});

describe('scoreCaseResults', () => {
  it('passes when all cases pass (all-pass matrix)', () => {
    const verdict = scoreCaseResults([
      { evalCase: evalCase({ name: 'a' }), output: 'Hello' },
      { evalCase: evalCase({ name: 'b' }), output: 'Hello' },
    ]);
    expect(verdict.status).toBe('passed');
    expect(verdict.scores.map((score) => score.name)).toEqual(['a', 'b']);
  });

  it('fails when one case fails and keeps both scores', () => {
    const verdict = scoreCaseResults([
      { evalCase: evalCase({ name: 'a' }), output: 'Hello' },
      { evalCase: evalCase({ name: 'b' }), output: 'Goodbye' },
    ]);
    expect(verdict.status).toBe('failed');
    expect(verdict.scores).toHaveLength(2);
    expect(verdict.scores[1].passed).toBe(false);
  });

  it('fails a case whose invocation threw, with the transport error', () => {
    const verdict = scoreCaseResults([
      { evalCase: evalCase({ name: 'a' }), error: 'no transport' },
    ]);
    expect(verdict.status).toBe('failed');
    expect(verdict.scores[0].failures).toEqual(['no transport']);
  });

  it('fails an empty dataset outright (no cases, no proof)', () => {
    const verdict = scoreCaseResults([]);
    expect(verdict.status).toBe('failed');
    expect(verdict.scores).toEqual([]);
  });
});
