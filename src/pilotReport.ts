import type { Impact } from './impact.ts';
import type { ReviewCounts } from './review.ts';
import { RULE_CATALOG } from './ruleCatalog.ts';

// A plain-text report a pilot team can paste into a message: what Same Page found on their site and what they said about it.
// Counts only. No page text, titles, work item keys or names. It repeats the caveats so the numbers cannot be quoted without them.

export interface PilotInput { impact: Impact; reviews: ReviewCounts; gateMode: 'enforce' | 'watch'; customRules: number; on: string }

export function buildPilotReport({ impact, reviews, gateMode, customRules, on }: PilotInput): string {
  const c = impact.counts;
  const perRule = RULE_CATALOG.map((r) => ({ r, v: reviews[r.ruleId] })).filter((x) => x.v && x.v.real + x.v.false > 0)
    .map(({ r, v }) => `  ${r.short} ${r.name}: ${v!.real} real, ${v!.false} false alarm`);
  const lines = [
    `Same Page pilot report (${on})`,
    '',
    `Contradictions found: ${c.seen}`,
    `Fixed on the page: ${c.applied}   Sent to a page owner: ${c.reviewTasks}   Dismissed: ${c.dismissed}   Snoozed: ${c.snoozed}`,
    `Gate: ${gateMode === 'watch' ? 'watch only' : 'enforcing'}; transitions refused: ${c.gateBlocks}; would have been refused in watch-only mode: ${c.gateWouldBlock}`,
    `Team rules written: ${customRules}`,
    '',
    `Reviewed by the team: ${impact.review.line}`,
    ...(perRule.length ? ['By rule:', ...perRule] : []),
    '',
    impact.estimatedHoursSaved === null ? 'Time saved: not stated.' : `Time saved: ${impact.estimatedHoursSaved} hours, the administrator's own estimate of ${impact.minutesPerFix} minutes per applied fix (not measured by Same Page).`,
    '',
    'How to read this: these are counts from one site. Under 10 reviewed findings is too few to say anything about accuracy. A "false alarm" mark means the team judged the finding wrong; it does not show how many real contradictions were missed.',
  ];
  return lines.join('\n');
}
