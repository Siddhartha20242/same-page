// Kept in its own file with no imports so the panel (a browser-side bundle) can use it without pulling in modules that need Node.
/** What kind of drift a project has: items with contradictions, counted by the rule of their most serious finding. Biggest group first. */
export function byRule(rows: { verdict: string; ruleName?: string }[]): { rule: string; items: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) if ((r.verdict === 'Blocked' || r.verdict === 'Warning') && r.ruleName) n.set(r.ruleName, (n.get(r.ruleName) ?? 0) + 1);
  return [...n].map(([rule, items]) => ({ rule, items })).sort((a, b) => b.items - a.items || a.rule.localeCompare(b.rule));
}
