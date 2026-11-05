import type { Finding, Pair, Rule } from './types';
import { HISTORICAL_RE } from './lineGuards';

// Team-defined rules. A site administrator fills in one of three fixed templates; there is no code and no pattern language to learn,
// and no model. A phrase is matched as plain text, ignoring case, so nothing a person types can run as a regular expression.
//
//   phrase-while-status   Flag a page that says <phrase> while the work item's status is <value>  ("!Done" means "is not Done").
//   phrase-with-label     Flag a page that says <phrase> while the work item carries the label or component <value>.
//   label-needs-phrase    Flag a page that never says <phrase> while the work item carries the label or component <value>.
//
// Lines worded as history ("previously", "deprecated", ...) are skipped, like the built-in rules.

export type CustomTemplate = 'phrase-while-status' | 'phrase-with-label' | 'label-needs-phrase';
export interface CustomRuleDef { id: string; name: string; template: CustomTemplate; phrase: string; value: string; severity: 'block' | 'warn' }
export interface CustomRuleInput { name?: unknown; template?: unknown; phrase?: unknown; value?: unknown; severity?: unknown }

export const MAX_CUSTOM_RULES = 10;
export const TEMPLATES: { id: CustomTemplate; label: string; sentence: string }[] = [
  { id: 'phrase-while-status', label: 'Page says … while status is …', sentence: 'Flag a page that says the phrase while the work item status is the value (put ! before the value to mean "is not").' },
  { id: 'phrase-with-label', label: 'Page says … while work item has label …', sentence: 'Flag a page that says the phrase while the work item has the label or component.' },
  { id: 'label-needs-phrase', label: 'Work item has label … but page never says …', sentence: 'Flag a page that never says the phrase while the work item has the label or component.' },
];

const clean = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f`<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const isCustomId = (id: string) => /^C\d+_CUSTOM$/.test(id);

/** Checks what a person typed. Returns the cleaned definition (without an id) or a plain-words reason. */
export function validateCustomRule(input: CustomRuleInput): { ok: true; def: Omit<CustomRuleDef, 'id'> } | { ok: false; reason: string } {
  const template = TEMPLATES.find((t) => t.id === input.template)?.id;
  const name = clean(input.name, 60);
  const phrase = clean(input.phrase, 80);
  const value = clean(input.value, 60);
  if (!template) return { ok: false, reason: 'Pick one of the three templates.' };
  if (name.length < 3) return { ok: false, reason: 'Give the rule a name of at least 3 characters.' };
  if (phrase.length < 3) return { ok: false, reason: 'The phrase must be at least 3 characters, so it does not match everything.' };
  if (!value || value === '!') return { ok: false, reason: template === 'phrase-while-status' ? 'Enter the status, for example "Done" or "!Done".' : 'Enter the label or component name.' };
  if (template !== 'phrase-while-status' && value.startsWith('!')) return { ok: false, reason: 'Only the status template accepts a ! in front of the value.' };
  const severity = input.severity === 'block' ? 'block' : 'warn';
  return { ok: true, def: { name, template, phrase, value, severity } };
}

const has = (text: string, phrase: string) => text.toLowerCase().includes(phrase.toLowerCase());

export function compileRule(def: CustomRuleDef): Rule {
  const why = `Your team defined this rule ("${def.name}").`;
  return {
    id: def.id,
    severity: def.severity,
    why,
    run({ workItem, page }: Pair): Finding[] {
      const item = workItem as Pair['workItem'] & { labels?: string[]; components?: string[] };
      const tags = [...(item.labels ?? []), ...(item.components ?? [])].map((t) => t.toLowerCase());
      const base = { ruleId: def.id, severity: def.severity, why };
      const evidenceItem = { key: workItem.key, status: workItem.status };
      if (def.template === 'label-needs-phrase') {
        if (!tags.includes(def.value.toLowerCase()) || has(page.text, def.phrase)) return [];
        return [{ ...base, summary: `Custom rule "${def.name}": ${workItem.key} has "${def.value}" but "${page.title}" never says "${def.phrase}"`, evidence: { page: { id: page.id, modifiedAt: page.modifiedAt, snippet: `(this page has no mention of "${def.phrase}")` }, workItem: evidenceItem } }];
      }
      if (def.template === 'phrase-with-label') { if (!tags.includes(def.value.toLowerCase())) return []; }
      else {
        const negate = def.value.startsWith('!');
        const status = (negate ? def.value.slice(1) : def.value).trim().toLowerCase();
        if ((workItem.status ?? '').toLowerCase() === status === negate) return [];
      }
      const lines = page.text.split('\n');
      const at = lines.findIndex((l) => has(l, def.phrase) && !HISTORICAL_RE.test(l));
      if (at < 0) return [];
      const cond = def.template === 'phrase-with-label' ? `${workItem.key} has "${def.value}"` : `${workItem.key} is ${workItem.status || 'unknown'}`;
      return [{ ...base, summary: `Custom rule "${def.name}": page says "${def.phrase}" while ${cond}`, evidence: { page: { id: page.id, modifiedAt: page.modifiedAt, line: at + 1, snippet: lines[at]!.trim() }, workItem: evidenceItem } }];
    },
  };
}

export interface RuleStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
interface Saved { rules: CustomRuleDef[]; next: number }
const KEY = 'rules:custom';

async function read(store: RuleStore): Promise<Saved> {
  try {
    const raw = (await store.get(KEY)) as Partial<Saved> | null | undefined;
    const rules = (Array.isArray(raw?.rules) ? raw!.rules : []).filter((r): r is CustomRuleDef => Boolean(r) && isCustomId(String(r.id)) && validateCustomRule(r).ok).slice(0, MAX_CUSTOM_RULES);
    return { rules, next: Number.isFinite(raw?.next) ? Number(raw!.next) : rules.length + 1 };
  } catch { return { rules: [], next: 1 }; }
}

export const loadCustomDefs = async (store: RuleStore): Promise<CustomRuleDef[]> => (await read(store)).rules;
export const loadCustomRules = async (store: RuleStore): Promise<Rule[]> => (await loadCustomDefs(store)).map(compileRule);

export async function addCustomRule(store: RuleStore, input: CustomRuleInput): Promise<{ ok: true; def: CustomRuleDef } | { ok: false; reason: string }> {
  const v = validateCustomRule(input);
  if (!v.ok) return v;
  const cur = await read(store);
  if (cur.rules.length >= MAX_CUSTOM_RULES) return { ok: false, reason: `A site can have at most ${MAX_CUSTOM_RULES} custom rules. Delete one first.` };
  const def: CustomRuleDef = { id: `C${cur.next}_CUSTOM`, ...v.def };
  await store.set(KEY, { rules: [...cur.rules, def], next: cur.next + 1 });
  return { ok: true, def };
}

export async function deleteCustomRule(store: RuleStore, id: string): Promise<{ ok: boolean }> {
  const cur = await read(store);
  const rules = cur.rules.filter((r) => r.id !== id);
  if (rules.length === cur.rules.length) return { ok: false };
  await store.set(KEY, { rules, next: cur.next });
  return { ok: true };
}

/** A rule built from what is typed in the form, for "what would this find on the work item I am looking at". Never saved. */
export function previewRule(input: CustomRuleInput): { ok: true; rule: Rule } | { ok: false; reason: string } {
  const v = validateCustomRule(input);
  return v.ok ? { ok: true, rule: compileRule({ id: 'C0_CUSTOM', ...v.def }) } : v;
}
