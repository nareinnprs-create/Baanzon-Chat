import type { TEvalAssertion, TEvalCase, TEvalCaseScore } from 'librechat-data-provider';

/** One dataset case paired with what the invoker returned for it. */
export interface EvalCaseResult {
  evalCase: TEvalCase;
  output?: string;
  /** Set when the invoker itself threw; the case fails on this alone. */
  error?: string;
}

export interface EvalDatasetVerdict {
  status: 'passed' | 'failed';
  scores: TEvalCaseScore[];
}

/**
 * Pure per-assertion evaluation. `exact` and `contains` compare literally
 * (case-insensitively when `caseSensitive` is false); `regex` compiles the
 * value with the `i` flag when case-insensitivity is asked for, and an invalid
 * source fails the assertion instead of throwing.
 */
export function evaluateAssertion(
  assertion: TEvalAssertion,
  output: string,
): { passed: boolean; message?: string } {
  if (typeof assertion?.value !== 'string') {
    return { passed: false, message: 'assertion is missing a string value' };
  }
  const insensitive = assertion.caseSensitive === false;

  if (assertion.type === 'exact') {
    const actual = insensitive ? output.toLowerCase() : output;
    const expected = insensitive ? assertion.value.toLowerCase() : assertion.value;
    if (actual === expected) {
      return { passed: true };
    }
    return {
      passed: false,
      message: `expected exact ${JSON.stringify(assertion.value)} but got ${JSON.stringify(output)}`,
    };
  }

  if (assertion.type === 'contains') {
    const actual = insensitive ? output.toLowerCase() : output;
    const expected = insensitive ? assertion.value.toLowerCase() : assertion.value;
    if (actual.includes(expected)) {
      return { passed: true };
    }
    return {
      passed: false,
      message: `expected output to contain ${JSON.stringify(assertion.value)} but got ${JSON.stringify(output)}`,
    };
  }

  if (assertion.type === 'regex') {
    let matcher: RegExp;
    try {
      matcher = new RegExp(assertion.value, insensitive ? 'i' : '');
    } catch (error) {
      return {
        passed: false,
        message: `invalid regex ${JSON.stringify(assertion.value)}: ${(error as Error).message}`,
      };
    }
    if (matcher.test(output)) {
      return { passed: true };
    }
    return {
      passed: false,
      message: `expected output to match /${assertion.value}/${insensitive ? 'i' : ''} but got ${JSON.stringify(output)}`,
    };
  }

  return { passed: false, message: `unknown assertion type: ${String(assertion.type)}` };
}

/**
 * Scores one case: every assertion must pass. A case with no assertions fails
 * honestly - it cannot demonstrate the target's behavior.
 */
export function scoreCase(evalCase: TEvalCase, output: string): TEvalCaseScore {
  const failures: string[] = [];
  if (!Array.isArray(evalCase.assertions) || evalCase.assertions.length === 0) {
    failures.push('case has no assertions to evaluate');
  } else {
    for (const assertion of evalCase.assertions) {
      const verdict = evaluateAssertion(assertion, output);
      if (!verdict.passed && verdict.message) {
        failures.push(verdict.message);
      }
    }
  }
  return { name: evalCase.name, passed: failures.length === 0, failures };
}

/**
 * Pure scoring over collected case results. An invocation error fails its case
 * with the transport message; the dataset passes only when every case passes.
 * Empty results (an empty dataset) fail the whole run - an eval with no cases
 * proves nothing.
 */
export function scoreCaseResults(results: EvalCaseResult[]): EvalDatasetVerdict {
  if (results.length === 0) {
    return {
      status: 'failed',
      scores: [],
    };
  }
  const scores = results.map((result) => {
    if (result.error !== undefined) {
      return {
        name: result.evalCase.name,
        passed: false,
        failures: [result.error],
      };
    }
    return scoreCase(result.evalCase, result.output ?? '');
  });
  return {
    status: scores.every((score) => score.passed) ? 'passed' : 'failed',
    scores,
  };
}
