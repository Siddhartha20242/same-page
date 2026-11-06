// Which side is probably stale? A plain statement of the dates we know, never a probability. The rules decide that a contradiction exists;
// this only helps a person choose which side to look at first. It makes no claim when the dates are close or missing.

const DAY = 86400_000;
export interface AgeInput { pageEditedAt?: string; itemChangedAt?: string; now?: number }

export function ageHint({ pageEditedAt, itemChangedAt, now = Date.now() }: AgeInput): string | null {
  const page = Date.parse(pageEditedAt ?? '');
  const item = Date.parse(itemChangedAt ?? '');
  if (!Number.isFinite(page)) return null;
  const pageDays = Math.floor((now - page) / DAY);
  const pageAge = pageDays <= 0 ? 'today' : pageDays === 1 ? 'yesterday' : `${pageDays} days ago`;
  if (!Number.isFinite(item)) return `The page was last edited ${pageAge}.`;
  const itemDays = Math.floor((now - item) / DAY);
  const itemAge = itemDays <= 0 ? 'today' : itemDays === 1 ? 'yesterday' : `${itemDays} days ago`;
  const gap = Math.floor((item - page) / DAY);
  if (gap >= 30) return `The page was last edited ${pageAge}; the work item last changed ${itemAge}. The page is ${gap} days older, so it is the more likely side to be out of date.`;
  if (gap <= -30) return `The page was last edited ${pageAge}; the work item last changed ${itemAge}. The work item is ${-gap} days older, so check whether the work item still reflects the latest decision.`;
  return `The page was last edited ${pageAge}; the work item last changed ${itemAge}. Both changed around the same time, so this may be a real conflict between two sources: ask who owns each.`;
}
