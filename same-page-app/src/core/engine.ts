import { BUILT_IN_RULES } from './rules';
import type { CheckResult, Pair, Rule, Verdict } from './types';

// Runs every rule over a pair. Verdict: block > warn > pass. Info findings are notes and never raise it.
export function check(pair: Pair, rules: Rule[] = BUILT_IN_RULES): CheckResult {
  const findings = rules.flatMap((r) => r.run(pair));
  const real = findings.filter((f) => f.severity !== 'info');
  const verdict: Verdict = real.some((f) => f.severity === 'block')
    ? 'BLOCKED'
    : real.length
      ? 'WARN'
      : 'PASS';
  return { verdict, findings };
}
