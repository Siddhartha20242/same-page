// Deterministic hard-fact rules. No LLM in the detection path.
// A pair is { workItem, page }; each rule returns an array of findings with evidence.
// Severities: block and warn raise the verdict; info is a note (listed, never raises the verdict).

// A trailing file extension (v1.patch, v2.zip) means a filename, not a version reference.
const FILE_EXT = '(?:patch|diff|zip|jar|tar|gz|tgz|txt|md|png|jpe?g|gif|pdf|json|ya?ml|xml|csv|log|sh|py|js|ts|java)';
const VTOKEN_RE = new RegExp(`\\bv(\\d+)(?:\\.\\d+)*\\b(?!\\.${FILE_EXT}\\b)`, 'gi');
const PHRASE_RE = /\bversion\s+(\d+)(?:\.\d+)*\b/gi;           // "version 2", only on lines that are about an API/service
const PHRASE_CONTEXT_RE = /\b(api|endpoint|service|sdk|client|release|protocol)\b/i;
// Historical wording means the page may be describing the past on purpose. It counts only on the SAME line,
// or on a heading-like line directly above (one with no version of its own), so a historical sentence
// never silences a live instruction below it.

import type { Finding, Page, Pair, Rule, VersionHit, VersionRef } from './types.ts';
import { DATED_BEFORE, HISTORICAL_RE } from './lineGuards.ts';
import { durationDiffers, limitDiffers, dateDiffers } from './factRules.ts';
import { extractOpenApi, judgeOperation, operationsInLine } from './spec.ts';

// "v1" as a delivery phase ("v1 implementation", "V1 is done | 100%"), not an API version. Bare numbers only (v1, not v1.2), and only when
// the line has phase wording and nothing that makes it about an API, a path, a service or a migration.
const PHASE_WORDS = /\b(phase|iteration|milestone|stage|prototype|mvp|implementation|\d+\s*%)/i;
const API_WORDS = /(\bapi\b|endpoint|\/v\d|\bsdk\b|protocol|\bservice\b|\bclient\b|migrat|\bupgrade)/i;
const PACKAGE_PART = /[A-Za-z0-9_]\.$/;
const isPhaseLine = (line: string) => PHASE_WORDS.test(line) && !API_WORDS.test(line);

// Every version reference in one line, as { version: 'v2', index, text, kind }.
export function refsInLine(line: string): VersionRef[] {
  const refs: VersionRef[] = [];
  const phase = isPhaseLine(line);
  for (const m of line.matchAll(VTOKEN_RE)) {
    if (phase && !m[0].includes('.')) continue;
    if (PACKAGE_PART.test(line.slice(Math.max(0, (m.index ?? 0) - 2), m.index))) continue;     // io.swagger.core.v3: a package name
    if (m[0].split('.').length >= 3) continue;      // v0.8.0: another product's release number, not an API version. Trade-off: an SDK written as v1.2.3 is not compared with the target either (see README limits).
    refs.push({ version: `v${m[1]}`, index: m.index ?? 0, text: m[0], kind: 'token' });
  }
  if (PHRASE_CONTEXT_RE.test(line)) {
    for (const m of line.matchAll(PHRASE_RE)) refs.push({ version: `v${m[1]}`, index: m.index ?? 0, text: m[0], kind: 'phrase' });
  }
  return refs.sort((a, b) => a.index - b.index);
}

export const mentionsVersion = (line: string, target: string) => refsInLine(line).some((r) => r.version === target);

// The line with every version reference replaced by "V", used to prove an edit changed nothing else.
export function normalizeRefs(line: string): string {
  let out = line;
  for (const r of refsInLine(line).sort((a, b) => b.index - a.index)) out = out.slice(0, r.index) + 'V' + out.slice(r.index + r.text.length);
  return out;
}

function versionsIn(text: string): VersionHit[] {
  const found: VersionHit[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const headingAbove = prev !== undefined && refsInLine(prev).length === 0 && HISTORICAL_RE.test(prev);
    const historical = HISTORICAL_RE.test(line) || headingAbove;
    for (const r of refsInLine(line)) found.push({ version: r.version, line: i + 1, snippet: line.trim(), historical });
  });
  return found;
}

// Content half of R1: does the page document only a version other than `target`?
// Returns the first live reference, or the first one flagged historical if EVERY reference sits near historical
// wording (those become notes, not silent misses). Null when there is no conflict. Shared with the fix verifier.
export function contentConflict(text: string, target: string): VersionHit | null {
  const refs = versionsIn(text);
  if (refs.length === 0) return null;
  if (refs.some((r) => r.version === target)) return null; // page mentions the target version
  const live = refs.find((r) => !r.historical);
  return live ? { ...live, historical: false } : { ...refs[0], historical: true };
}

// R1: page documents only a different version than the work item targets,
// and the page predates the work item's last status change.
export const versionMismatch: Rule = {
  id: 'R1_VERSION_MISMATCH',
  severity: 'block',
  why: 'Anyone following this page would use a version the team has already moved away from.',
  run({ workItem, page }: Pair): Finding[] {
    const target = workItem.apiVersion;
    if (!target || !workItem.statusChangedAt) return [];
    if (new Date(page.modifiedAt) >= new Date(workItem.statusChangedAt)) return [];
    const stale = contentConflict(page.text, target);
    if (!stale) return [];
    return [{
      ruleId: this.id,
      severity: stale.historical ? 'info' : this.severity,
      why: stale.historical ? 'Wording nearby suggests this describes the past, but a stale rollback or legacy section can still mislead someone under pressure.' : this.why,
      summary: `Page documents ${stale.version} but ${workItem.key} targets ${target}${stale.historical ? ' (historical wording nearby; may be intentional)' : ''}`,
      evidence: {
        // moreStale: other lines on this page that also name a different version. After a person fixes one line the page counts as edited,
        // so the rest would stop being flagged; the panel says how many remain instead of letting that pass silently.
        page: { id: page.id, modifiedAt: page.modifiedAt, line: stale.line, snippet: stale.snippet, moreStale: new Set(versionsIn(page.text).filter((r) => r.version !== target && !r.historical && r.line !== stale.line).map((r) => r.line)).size },
        workItem: { key: workItem.key, apiVersion: target, statusChangedAt: workItem.statusChangedAt, statusChangedBy: workItem.statusChangedBy },
      },
    }];
  },
};

// R2: linked decision/runbook page is marked deprecated or superseded while work is still active.
export const deprecatedDecision: Rule = {
  id: 'R2_DEPRECATED_DECISION_ACTIVE_WORK',
  severity: 'block',
  why: 'Work is proceeding on a decision the team has already retired.',
  run({ workItem, page }: Pair): Finding[] {
    const marked = (page.labels || []).find((l) => ['deprecated', 'superseded'].includes(l.toLowerCase()));
    if (!marked) return [];
    if (!['In Progress', 'In Review'].includes(workItem.status)) return [];
    return [{
      ruleId: this.id,
      severity: this.severity,
      why: this.why,
      summary: `Page "${page.title}" is marked ${marked} but ${workItem.key} is ${workItem.status}`,
      evidence: {
        page: { id: page.id, labels: page.labels, modifiedAt: page.modifiedAt },
        workItem: { key: workItem.key, status: workItem.status },
      },
    }];
  },
};

// R3: work item is Done (release-ready) but a required field is empty.
export const missingRequiredField: Rule = {
  id: 'R3_MISSING_REQUIRED_FIELD',
  severity: 'warn',
  why: 'A finished item is missing a field your process requires, which can fail an audit.',
  run({ workItem }: Pair): Finding[] {
    if (workItem.status !== 'Done') return [];
    return (workItem.requiredFields || [])
      .filter((f) => !workItem.fields || !workItem.fields[f])
      .map((f) => ({
        ruleId: this.id,
        severity: this.severity,
        why: this.why,
        summary: `${workItem.key} is Done but required field "${f}" is empty`,
        evidence: { workItem: { key: workItem.key, status: workItem.status, missingField: f } },
      }));
  },
};

// R4: a page says a work item is in a state it has already left ("PAY-7 is planned", "PAY-7 shipped") and the page predates the move.
const NOT_STARTED = /\b(planned|not started|to do|todo|backlog|upcoming|yet to start)\b/i;
const FINISHED = /\b(done|completed|shipped|released|resolved)\b/i;
const FINISHED_BEFORE = /\b(shipped|released|completed|delivered|resolved)\s+(?:the\s+)?$/i;
const NOT_STARTED_STATUSES = ['to do', 'todo', 'backlog', 'open', 'selected for development'];
// A line that carries a date before the key is a log entry, true when it was written ("2017-10-31: waiting on HDFS-1"). Found on public data.
const WAS_WORDING = /\b(was|were|originally|previously|formerly|used to|had been)\b/i;
export const statusClaim: Rule = {
  id: 'R4_STATUS_CLAIM_STALE',
  severity: 'warn',
  why: 'A page tells readers a work item is in a state it has already left, so they plan around something that is no longer true.',
  run({ workItem, page }: Pair): Finding[] {
    const key = workItem.key;
    if (!key || !workItem.status || !workItem.statusChangedAt) return [];
    if (new Date(page.modifiedAt) >= new Date(workItem.statusChangedAt)) return [];
    const status = workItem.status.toLowerCase();
    const out: Finding[] = [];
    const keyRe = new RegExp(`(?<![A-Za-z0-9-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`);   // PAY-1 must not match PAY-12
    page.text.split('\n').forEach((line, i) => {
      const at = keyRe.exec(line)?.index ?? -1;
      if (at < 0 || DATED_BEFORE.test(line.slice(0, at))) return;
      const claim = line.slice(at + key.length, at + key.length + 70);          // the claim must sit right after THIS key, on the same line
      const justBefore = line.slice(Math.max(0, at - 25), at);                  // ...or be a completion verb directly before it ("we shipped PAY-1")
      const says = NOT_STARTED.test(claim) && !NOT_STARTED_STATUSES.includes(status) ? 'not started'
        : (FINISHED.test(claim) || FINISHED_BEFORE.test(justBefore)) && status !== 'done' ? 'finished' : null;
      if (!says || WAS_WORDING.test(line.slice(Math.max(0, at - 40), at + key.length + 70))) return;   // "was planned" describes the past
      out.push({
        ruleId: this.id,
        severity: this.severity,
        why: this.why,
        summary: `Page says ${key} is ${says}, but Jira says it is ${workItem.status}`,
        evidence: { page: { id: page.id, modifiedAt: page.modifiedAt, line: i + 1, snippet: line.trim() }, workItem: { key, status: workItem.status, statusChangedAt: workItem.statusChangedAt, statusChangedBy: workItem.statusChangedBy } },
      });
    });
    return out;
  },
};

// R6: a doc line like "POST /api/v1/charge" disagrees with an OpenAPI spec held in another linked page: the spec marks the operation
// deprecated (blocks), or has no such operation in the same API (warns). The doc is checked against the artifact itself, not a ticket.
// The spec in a page is read once per page object, because every rule run asks about every sibling (a YAML parse is not free).
const specs = new WeakMap<Page, ReturnType<typeof extractOpenApi>>();
const specOf = (p: Page): ReturnType<typeof extractOpenApi> => { if (!specs.has(p)) specs.set(p, extractOpenApi(p.text)); return specs.get(p) ?? null; };

export const specDisagrees: Rule = {
  id: 'R5_SPEC_DISAGREES',
  severity: 'block',
  why: 'The documented call does not match the API spec, so anyone following the page may call something that is retired or does not exist.',
  run({ workItem, page, siblings }: Pair): Finding[] {
    if (!siblings?.length || specOf(page)) return [];                              // nothing to compare with, or this page IS the spec
    let spec: ReturnType<typeof extractOpenApi> = null; let specTitle = '';
    for (const s of siblings) { if (s.id === page.id) continue; const found = specOf(s); if (found) { spec = found; specTitle = s.title; break; } }
    if (!spec) return [];
    const out: Finding[] = [];
    page.text.split('\n').forEach((line, i) => {
      for (const op of operationsInLine(line)) {
        const verdict = judgeOperation(spec!, op);
        if (!verdict) continue;
        const staleVersion = workItem.apiVersion ? refsInLine(line).some((r) => r.version !== workItem.apiVersion) : false;
        if (verdict.kind === 'missing' && staleVersion) continue;                    // R1 already reports the stale version on this line
        const detail = verdict.kind === 'deprecated'
          ? `marks ${verdict.spec.method} ${verdict.spec.path} as deprecated`
          : `has no ${op.method} ${op.path}${verdict.near.length ? ` (it has ${verdict.near.map((o) => `${o.method} ${o.path}`).join(', ')})` : ''}`;
        out.push({
          ruleId: this.id,
          severity: verdict.kind === 'deprecated' ? 'block' : 'warn',
          why: this.why,
          summary: `Page documents ${op.method} ${op.path}, but the API spec ${detail}`,
          evidence: { page: { id: page.id, modifiedAt: page.modifiedAt, line: i + 1, snippet: line.trim() }, spec: { title: specTitle, detail, opText: op.text }, workItem: { key: workItem.key } },
        });
      }
    });
    return out;
  },
};

// R6: a page says a ticket it mentions is still open ("blocked by PAY-9", "PAY-9 is in progress") but Jira says that ticket is closed.
// Warn only, so it never blocks a transition. The mentioned ticket's status arrives in `cited`; with no data the rule stays silent.
const CLOSED_STATUSES = ['done', 'closed', 'resolved', 'released', 'cancelled', 'canceled', 'complete', 'completed', "won't do", 'wont do'];
/** True for a status R6 treats as closed. Only those tickets need their closing time read. */
export const isClosedStatus = (status: unknown): boolean => CLOSED_STATUSES.includes(String(status ?? '').toLowerCase());
const OPEN_AFTER = /\b(is|are|still|currently)\s+(open|pending|in progress|blocked|not\s+(?:yet\s+)?(?:done|merged|released|shipped|finished))\b/i;
const OPEN_BEFORE = /\b(waiting\s+(?:on|for)|blocked\s+by|pending)\s+$/i;
export const citedTicketClosed: Rule = {
  id: 'R6_CITED_TICKET_CLOSED',
  severity: 'warn',
  why: 'A page tells readers that a ticket it relies on is still open, but Jira says it is closed, so the page is out of date and the work it waits for is already done.',
  run({ workItem, page, cited }: Pair): Finding[] {
    if (!cited) return [];
    const out: Finding[] = [];
    const keys = Object.keys(cited).filter((k) => k !== workItem.key && isClosedStatus(cited[k]?.status));
    if (!keys.length) return [];
    // A page edited after the ticket closed was written with the answer available, so a leftover "waiting on" line is history, not news (R4 applies the same test to the work item).
    const closedAfterEdit = (k: string) => { const at = cited[k]?.changedAt; return Boolean(at) && new Date(page.modifiedAt) >= new Date(String(at)); };
    page.text.split('\n').forEach((line, i) => {
      for (const key of keys) {
        if (closedAfterEdit(key)) continue;
        const re = new RegExp(`(?<![A-Za-z0-9-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`);
        const at = re.exec(line)?.index ?? -1;
        if (at < 0 || DATED_BEFORE.test(line.slice(0, at))) continue;
        const after = line.slice(at + key.length, at + key.length + 60);
        const before = line.slice(Math.max(0, at - 25), at);
        if (!(OPEN_AFTER.test(after) || OPEN_BEFORE.test(before))) continue;
        if (WAS_WORDING.test(line.slice(Math.max(0, at - 40), at + key.length + 60))) continue;
        const status = String(cited[key].status);
        out.push({
          ruleId: this.id,
          severity: this.severity,
          why: this.why,
          summary: `Page treats ${key} as still open, but Jira says it is ${status}`,
          evidence: { page: { id: page.id, modifiedAt: page.modifiedAt, line: i + 1, snippet: line.trim() }, cited: { key, status }, workItem: { key: workItem.key } },
        });
      }
    });
    return out;
  },
};

// R7: two pages loaded for the same work item document the same endpoint or API at different versions ("POST /api/v1/charge" on one,
// "POST /api/v2/charge" on the other; "Payments API v1" vs "Payments API v2"). R1 compares each page with the ticket; this compares the
// pages with EACH OTHER, so it adds information only where R1 cannot decide: the work item has no target version, or its target matches
// neither page's version. If the target matches one of them, R1 already reports the other page, so R7 stays silent.
// Silent when unsure: historical lines are ignored, and a page that itself names two versions of the same thing (a migration guide) is skipped.
// Warn only. It reports a disagreement between documents, not a fact about the ticket, so it must never block a transition.
// Work is bounded: each page is read once (cached per page object), at most MAX_R7_LINES lines of MAX_R7_LINE chars, MAX_R7_STEMS stems,
// at most MAX_R7_SIBLINGS other pages, and at most MAX_R7_FINDINGS findings per page.
const MAX_R7_LINES = 20000; const MAX_R7_LINE = 400; const MAX_R7_STEMS = 500; const MAX_R7_SIBLINGS = 8; const MAX_R7_FINDINGS = 5;
const VERSION_SEG = /^v(\d+)$/i;
const NAMED_API = /\b([A-Z][A-Za-z0-9]{2,})\s+(API|Service|SDK)\s+v(\d+)(?:\.\d+)*\b/g;
interface Surface { stem: string; label: string; versions: Set<string>; line: number; snippet: string }
const surfaces = new WeakMap<Page, Map<string, Surface>>();
function surfacesOf(page: Page): Map<string, Surface> {
  const cached = surfaces.get(page);
  if (cached) return cached;
  const found = new Map<string, Surface>();
  const add = (stem: string, label: string, version: string, line: number, snippet: string) => {
    const s = found.get(stem);
    if (s) s.versions.add(version);
    else if (found.size < MAX_R7_STEMS) found.set(stem, { stem, label, versions: new Set([version]), line, snippet });
  };
  const lines = (page.text ?? '').split('\n', MAX_R7_LINES);
  lines.forEach((raw, i) => {
    const line = raw.slice(0, MAX_R7_LINE);
    if (HISTORICAL_RE.test(line)) return;
    for (const op of operationsInLine(line)) {
      const parts = op.path.split('/').filter(Boolean);
      const at = parts.map((p, k) => (VERSION_SEG.test(p) ? k : -1)).filter((k) => k >= 0);
      if (at.length !== 1 || parts.length < 2) continue;                                  // no version segment, or ambiguous: not comparable
      const k = at[0] as number;
      const rest = parts.map((p, j) => (j === k ? '{version}' : /^\d+$/.test(p) || /^\{[^}]+\}$|^:\w+$|^<[^>]+>$/.test(p) ? '{id}' : p.toLowerCase()));
      add(`${op.method} /${rest.join('/')}`, `${op.method} /${rest.join('/')}`, `v${VERSION_SEG.exec(parts[k] as string)?.[1]}`, i + 1, line.trim());
    }
    for (const m of line.matchAll(NAMED_API)) add(`named ${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`, `${m[1]} ${m[2]}`, `v${m[3]}`, i + 1, line.trim());
  });
  surfaces.set(page, found);
  return found;
}

export const pagesDisagree: Rule = {
  id: 'R7_PAGES_DISAGREE',
  severity: 'warn',
  why: 'Two pages about the same work item describe the same API at different versions, and the ticket cannot say which one is right, so a reader may follow either.',
  run({ workItem, page, siblings }: Pair): Finding[] {
    if (!siblings || siblings.length < 2) return [];
    const mine = surfacesOf(page);
    if (!mine.size) return [];
    const target = workItem.apiVersion;
    const out: Finding[] = [];
    for (const other of siblings.slice(0, MAX_R7_SIBLINGS)) {
      if (other.id === page.id || String(page.id) > String(other.id)) continue;           // each pair is reported once, by the page with the lower id
      const theirs = surfacesOf(other);
      for (const [stem, a] of mine) {
        const b = theirs.get(stem);
        if (!b || a.versions.size !== 1 || b.versions.size !== 1) continue;               // a page naming two versions of one thing is ambiguous: stay silent
        const va = [...a.versions][0] as string; const vb = [...b.versions][0] as string;
        if (va === vb || (target && (target === va || target === vb))) continue;          // equal, or R1 can already judge the page that disagrees with the ticket
        out.push({
          ruleId: this.id,
          severity: this.severity,
          why: this.why,
          summary: `"${page.title}" documents ${va} but "${other.title}" documents ${vb} for ${a.label}${target ? `, and ${workItem.key} targets ${target}` : `; ${workItem.key} has no target version`}`,
          evidence: {
            page: { id: page.id, modifiedAt: page.modifiedAt, line: a.line, snippet: a.snippet },
            other: { pageId: other.id, pageTitle: other.title, line: b.line, snippet: b.snippet },
            workItem: { key: workItem.key, apiVersion: target },
          },
        });
        if (out.length >= MAX_R7_FINDINGS) return out;
      }
    }
    return out;
  },
};

export const BUILT_IN_RULES: Rule[] = [versionMismatch, deprecatedDecision, missingRequiredField, statusClaim, specDisagrees, citedTicketClosed, pagesDisagree, durationDiffers, limitDiffers, dateDiffers];
