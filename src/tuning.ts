// Tuning hints: what the review marks and dismissals suggest about a rule's severity. Suggestions only. Nothing here changes a setting, hides a
// finding or demotes a rule; a Jira administrator decides, from the Rules list.

export interface TuningInput { severity: 'block' | 'warn'; real: number; falseAlarm: number; dismissed: number; acted: number }
const MIN_MARKS = 5;

export function tuningHint({ severity, real, falseAlarm, dismissed, acted }: TuningInput): string | null {
  const marks = real + falseAlarm;
  if (marks >= MIN_MARKS && falseAlarm / marks >= 0.5) {
    return severity === 'block'
      ? `People marked ${falseAlarm} of ${marks} findings from this rule as false alarms. Consider making it a Warning so it cannot stop a transition.`
      : `People marked ${falseAlarm} of ${marks} findings from this rule as false alarms. Keep it a Warning, and consider a narrower team rule for the case you care about.`;
  }
  if (marks >= MIN_MARKS && severity === 'warn' && real / marks >= 0.8) {
    return `People marked ${real} of ${marks} findings from this rule as real. If you want it to stop a transition, consider making it a Blocker.`;
  }
  const handled = dismissed + acted;
  if (handled >= MIN_MARKS && dismissed / handled >= 0.5 && marks < MIN_MARKS) {
    return `This rule was dismissed ${dismissed} of ${handled} times, but few findings are marked real or false alarm yet. Marking them would show whether it is wrong or just not needed.`;
  }
  return null;
}
