import { storageToText } from './adapters.ts';
import { verifyFix } from './propose.ts';

// "Apply suggested edit": a human clicks, the app writes AS THAT USER (their Confluence permissions apply),
// and the result is a new page version with a traceable message, so page history is the undo.
// The app never applies anything on its own. Applying is refused unless the edit lands exactly where proposed.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Replace the proposed line inside Confluence storage HTML. Exactly one match, or refuse.
export type Edit = { ok: true; html: string } | { ok: false; reason: string };

export function applyToStorage(html: string, before: string, after: string): Edit {
  const needle = esc(before);
  const count = html.split(needle).length - 1;
  if (count > 1) return { ok: false, reason: 'the line appears more than once; refusing to guess which one to change' };
  if (count === 1) return { ok: true, html: html.replace(needle, () => esc(after)) };
  return applyToToken(html, before, after);
}

// The whole line is not one contiguous piece of the source (the line is split by <strong>, <code>, a table cell...). Edit only the part that
// changes, with the smallest surrounding context that occurs EXACTLY ONCE in the source. A context that would cross a tag cannot match, so
// the search stops there. Never guesses: two candidates, or none, means refuse. applyProposal still proves the visible text changed on that line only.
function applyToToken(html: string, before: string, after: string): Edit {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const x = before.slice(p, before.length - s);
  const y = after.slice(p, after.length - s);
  if (!x && !y) return { ok: false, reason: 'edit changed nothing' };
  for (let k = 0; k <= 48; k += 4) {
    const left = before.slice(Math.max(0, p - k), p);
    const right = before.slice(before.length - s, Math.min(before.length, before.length - s + k));
    const needle = esc(left + x + right);
    const n = html.split(needle).length - 1;
    if (n === 1) return { ok: true, html: html.replace(needle, () => esc(left + y + right)) };
    if (n === 0) break;    // a wider context only crosses more markup
  }
  return { ok: false, reason: 'could not find the line in the page source (inline formatting may split it, or it appears more than once); copy the suggestion manually' };
}

// Edit the page source, then prove the visible text changed on that line only and still passes the rule.
export interface ApplicableProposal { ok: boolean; before: string; after: string; line: number }

export function applyProposal({ html, proposal, target }: { html: string; proposal?: ApplicableProposal | null; target: string }): Edit {
  if (!proposal?.ok) return { ok: false, reason: 'no verified proposal to apply' };
  const edit = applyToStorage(html, proposal.before, proposal.after);
  if (!edit.ok) return edit;
  const check = verifyFix(storageToText(html), storageToText(edit.html), proposal.line, target);
  return check.ok ? { ok: true, html: edit.html } : { ok: false, reason: `applied edit failed verification: ${check.reason}` };
}

// Body for PUT /wiki/api/v2/pages/{id}. The version message makes the change traceable and revertible.
export interface PageUpdateInput { page: { id: string | number; title: string }; newHtml: string; currentVersion: number; issueKey: string; approver: string }

export function buildPageUpdate({ page, newHtml, currentVersion, issueKey, approver }: PageUpdateInput) {
  return {
    id: String(page.id),
    status: 'current' as const,
    title: page.title,
    body: { representation: 'storage' as const, value: newHtml },
    version: { number: currentVersion + 1, message: `Same Page: version fix for ${issueKey}, approved by ${approver}` },
  };
}
