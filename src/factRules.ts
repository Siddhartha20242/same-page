// R8 to R10: a number or a date that the work item text and a linked page state differently for the same thing.
// Deterministic, no model. They need no target version, so they can fire on a work item that R1 cannot read.
//
// A finding needs ALL of these, which keeps them quiet:
//   - both sides state the fact with the same kind of value (a duration, a limit or port, a dated milestone);
//   - both name the same subject: at least two shared content words ("token", "expire"), or for dates the same milestone kind plus a shared word;
//   - the same qualifier: "up to", "at least" and "about" only compare with themselves, and "production" never compares with "staging" or a plan tier;
//   - the ticket gives ONE value for that subject, the page gives a different one, and the page does not also state the ticket's value elsewhere;
//   - the page line is not history (dated log entries, "previously", "deprecated", "default") and holds no range.
// When any of that is unclear the rule stays silent. A missed contradiction is better than a false alarm.

import type { Finding, Pair, Rule } from './types.ts';
import { DATED_BEFORE, HISTORICAL_RE, HISTORICAL_DATE_RE, PAST_STATE, PAST_EVENT, pastYear } from './lineGuards.ts';

type Kind = 'duration' | 'limit' | 'date' | 'name';
interface Fact { kind: Kind; unit: string; value: number; text: string; index: number; subject: Set<string>; qual: string; surface?: Record<string, string> }

const STOP = new Set('a an the and or of to in on at by for with from is are was were be been being it its this that these those as per each every than then also not no only when while after before within over under into out up down about around approximately max maximum min minimum least most set sets default defaults value values currently now new old will would should must can may might has have had do does did if else so such there here which who whom their they them we our you your begin begins began start starts starting scheduled user users'.split(' '));
const SYN: Record<string, string> = { expires: 'expire', expiry: 'expire', expiration: 'expire', expired: 'expire', ttl: 'expire', timeout: 'expire', timeouts: 'expire', lifetime: 'expire', valid: 'expire', validity: 'expire', lasts: 'expire', last: 'expire', timed: 'expire', live: 'expire', lives: 'expire', lived: 'expire', ends: 'expire', ended: 'expire', times: 'expire', kept: 'keep', retention: 'retain', retained: 'retain', retains: 'retain' };
// A word that, on one side only, names a different artefact: a refresh token is not the token, an invite link is not the link.
const DISTINCT = new Set(['refresh', 'invite', 'invitation', 'reset', 'verification', 'magic', 'temporary', 'temp', 'offline']);
const GENERIC = new Set(['date', 'planned', 'target', 'expected', 'scheduled', 'final', 'current']);
const ENV = new Set('production prod staging stage dev development test testing sandbox qa admin free pro enterprise premium basic standard trial internal external mobile desktop'.split(' '));

/** Audience, environment and plan words anywhere in a line ('for admin users', 'in staging'). Lines that name different ones are about different things. */
export const envOf = (line: string): string => [...new Set(wordsOf(line).filter((w) => ENV.has(w)))].sort().join(',');

// Plain suffix stripping so "cache / cached / caches", "limit / limited" and "batch / batches" meet. Not a language model: it only trims endings.
const stem = (w: string): string => {
  let s = Object.hasOwn(SYN, w) ? SYN[w]! : w;
  if (/(?:ies|ied)$/.test(s) && s.length > 4) s = `${s.slice(0, -3)}i`;
  else if (s.endsWith('y') && s.length > 3) s = `${s.slice(0, -1)}i`;
  else if (/(?:ch|sh|ss|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) s = s.slice(0, -1);
  return s.length > 3 && s.endsWith('e') ? s.slice(0, -1) : s;
};

/** True for a word the matcher reads as "expire" (expiry, timeout, ttl, lifetime, valid, lasts, lives...). The site-wide search leaves these out of its keyword list. */
export const isExpiryWord = (w: string): boolean => /^(expir|valid)\w*$/.test(w) || stem(w) === stem('expire');

const wordsOf = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []);

// The words that name WHAT a number is about: the clause before it, back to the nearest boundary, at most 8 words.
function subjectBefore(line: string, index: number, floor: number): { subject: Set<string>; qual: string; surface: Record<string, string> } {
  const seg = line.slice(floor, index);
  const clause = seg.split(/[.;()]|,\s/).pop() ?? '';
  const ws = wordsOf(clause).slice(-8);
  const subject = new Set<string>();
  const surface: Record<string, string> = Object.create(null);     // stem -> the word as written, so a finding can quote the page's own words
  const quals: string[] = [];
  for (const w of ws) {
    if (ENV.has(w)) { quals.push(w); continue; }
    if (STOP.has(w) || GENERIC.has(w)) continue;
    subject.add(stem(w));
    surface[stem(w)] = w;
  }
  // A qualifier anywhere in the clause changes what the number means: "up to", "at least", "about", "maximum", "minimum".
  const low = clause.toLowerCase();
  const q = /\b(up to|at most|at least|about|approximately|around|maximum|minimum|max|min)\b|~/.exec(low)?.[1] ?? (low.includes('~') ? '~' : undefined);
  if (q) quals.push(`q:${/up to|at most|max/.test(q) ? 'max' : /at least|min/.test(q) ? 'min' : 'approx'}`);
  return { subject, qual: quals.sort().join(','), surface };
}

const DURATION_UNITS: Record<string, number> = { y: 31536000, yr: 31536000, yrs: 31536000, year: 31536000, years: 31536000, ms: 0.001, msec: 0.001, millisecond: 0.001, milliseconds: 0.001, s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, w: 604800, wk: 604800, week: 604800, weeks: 604800 };
const COUNT_UNITS: Record<string, string> = { request: 'request', requests: 'request', req: 'request', reqs: 'request', call: 'request', calls: 'request', retry: 'retry', retries: 'retry', attempt: 'retry', attempts: 'retry', connection: 'connection', connections: 'connection', item: 'item', items: 'item', record: 'item', records: 'item', row: 'item', rows: 'item', entry: 'item', entries: 'item', user: 'user', users: 'user', message: 'message', messages: 'message', event: 'event', events: 'event', job: 'job', jobs: 'job', worker: 'worker', workers: 'worker', thread: 'thread', threads: 'thread', node: 'node', nodes: 'node', replica: 'replica', replicas: 'replica', partition: 'partition', partitions: 'partition' };
const SIZE = { b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4 } as Record<string, number>;
const PER: Record<string, number> = { second: 1, sec: 1, s: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400 };

const NUM = String.raw`(?<![\w.\-/:#$@])(\d{1,7}(?:[.,]\d+)?)`;
const END = String.raw`(?![\w])(?!\.\d)`;
const toNum = (s: string) => Number(s.replace(',', '.'));
const RANGE_AFTER = /^\s*(?:-|–|—|to)\s*\d/i;

// Wording that means a number, turned into digits before facts are read, so "half an hour", "thirty minutes" and "1h30m" meet "30 minutes",
// "30 minutes" and "90 minutes". Only fixed phrases and number words that sit right before a unit are changed; nothing is guessed.
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const UNIT_WORDS = '(?:ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|requests?|reqs?|calls?|retries|retry|attempts?|connections?|items?|records?|rows?|entries|users?|messages?|events?|jobs?|workers?|threads?|nodes?|replicas?|partitions?|kb|mb|gb|tb)';
const NUMBER_WORD = new RegExp(`\\b(?:(${Object.keys(TENS).join('|')})(?:[ -](${Object.keys(ONES).slice(0, 9).join('|')}))?|(${Object.keys(ONES).join('|')})|(?:a|one) hundred)(?=\\s*${UNIT_WORDS}\\b)`, 'gi');

export function normalizeWording(line: string): string {
  let s = line;
  s = s.replace(/\b(\d+)\s*(?:h|hr|hrs|hours?)\s*(?:and\s*)?(\d+)\s*(?:m|min|mins|minutes?)\b/gi, (_m, h, m) => `${Number(h) * 60 + Number(m)} minutes`);
  s = s.replace(/\b(?:an|one) hour and a half\b/gi, '90 minutes');
  s = s.replace(/(\d)\s*(kilo|mega|giga|tera)bytes?\b/gi, (_m, n, u) => `${n} ${{ kilo: 'KB', mega: 'MB', giga: 'GB', tera: 'TB' }[String(u).toLowerCase() as 'kilo']}`);   // "25 megabytes" -> "25 MB"
  s = s.replace(/\bhalf (?:an|a) hour\b/gi, '30 minutes').replace(/\b(?:a )?quarter (?:of an |of a |)hour\b/gi, '15 minutes');
  s = s.replace(NUMBER_WORD, (m, tens, ones, one) => {
    if (/hundred/i.test(m)) return '100';
    if (tens) return String(TENS[String(tens).toLowerCase()]! + (ones ? ONES[String(ones).toLowerCase()]! : 0));
    return String(ONES[String(one).toLowerCase()]);
  });
  // "an hour", "a minute" only after a word that makes it a length of time ("after an hour"), never in a rate such as "100 requests a day".
  s = s.replace(/\b(after|within|for|in|than|is|be|to|of|about|exactly|only|just|every|past)\s+(?:a|an)\s+(hour|minute|second|day|week)\b/gi, (_m, w, u) => `${w} 1 ${u}`);
  return s;
}

// `norm` is the line after wording was turned into digits. Fact indexes point into it, so anything that slices the line by a fact's index must slice `norm`, not the original.
// The result is cached by input text: the three fact rules and the panel's "read from ticket" list all read the same ticket and page.
type Extracted = { facts: Fact[]; lines: string[]; norm: string }[];
const extracted = new Map<string, Extracted>();
export function extractFacts(text: string): Extracted {
  const hit = extracted.get(text);
  if (hit) return hit;
  const out = text.split('\n').map((line) => { const norm = normalizeWording(line); return { lines: [line], norm, facts: factsInLine(norm) }; });
  if (extracted.size >= 32) extracted.clear();
  extracted.set(text, out);
  return out;
}

// Unit factors multiply floats (1.1 * 3600 is 3960.0000000000005), so values are rounded to 12 significant digits before they are compared.
const norm = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n);

function factsInLine(line: string): Fact[] {
  const out: Fact[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const push = (f: Omit<Fact, 'subject' | 'qual'>, floor: number, end: number) => {
    if (!free(f.index, end)) return;
    taken.push([f.index, end]);
    const { subject, qual, surface } = subjectBefore(line, f.index, floor);
    out.push({ ...f, subject, qual, surface });
  };
  const floorOf = () => (out.length ? out[out.length - 1]!.index + out[out.length - 1]!.text.length : 0);

  // Dates first, so their digits are never read as counts. A date counts only right after a milestone word.
  const dateRe = /(\b20\d{2}-\d{2}-\d{2}\b)|(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}\b)|(\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+20\d{2}\b)/gi;
  for (const m of line.matchAll(dateRe)) {
    const iso = toIso(m[0]);
    if (!iso) continue;
    const before = line.slice(Math.max(0, (m.index ?? 0) - 45), m.index ?? 0).toLowerCase();
    const cue = [...before.matchAll(/(deadline|due|deprecation|sunset|retirement|end[- ]of[- ]life|go[- ]?live|cut[- ]?over|code freeze|freeze|launch|release|ship(?:ping)?|eta|rollout|roll out)\b(?=[^.;]{0,25}$)/g)].pop()?.[1];
    if (!cue) continue;
    const kind = /deprecation|sunset|retirement|end/.test(cue) ? 'sunset' : /deadline|due/.test(cue) ? 'due' : /freeze/.test(cue) ? 'freeze' : /go|cut/.test(cue) ? 'cutover' : 'release';
    const idx = m.index ?? 0;
    const f = { kind: 'date' as Kind, unit: kind, value: Date.parse(`${iso}T00:00:00Z`), text: m[0], index: idx };
    if (!free(idx, idx + m[0].length)) continue;
    taken.push([idx, idx + m[0].length]);
    const { subject, qual, surface } = subjectBefore(line, idx, 0);
    for (const w of [...cue.split(/[\s-]+/), 'release', 'code']) subject.delete(stem(w));
    out.push({ ...f, subject, qual, surface });
  }

  for (const m of line.matchAll(new RegExp(`${NUM}\\s*(ms|msec|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?|wk|years?|yrs?)${END}`, 'gi'))) {
    const idx = m.index ?? 0; const end = idx + m[0].length;
    if (RANGE_AFTER.test(line.slice(end)) || /\d\s*[a-z]{0,12}\s*(?:[-–—]|to)\s*$/i.test(line.slice(Math.max(0, idx - 24), idx))) continue;
    if (/\bbetween\s+\d[\d.,]*\s*[a-z]{0,12}\s+and\s*$/i.test(line.slice(Math.max(0, idx - 40), idx))) continue;
    push({ kind: 'duration', unit: 'time', value: norm(toNum(m[1]!) * (DURATION_UNITS[m[2]!.toLowerCase()] ?? NaN)), text: m[0], index: idx }, floorOf(), end);
  }
  for (const m of line.matchAll(new RegExp(`${NUM}(ms|s|h|d|w)${END}`, 'g'))) {   // "30s", "2h": a letter unit only when it touches the number
    const idx = m.index ?? 0; const end = idx + m[0].length;
    push({ kind: 'duration', unit: 'time', value: norm(toNum(m[1]!) * (DURATION_UNITS[m[2]!] ?? NaN)), text: m[0], index: idx }, floorOf(), end);
  }
  for (const m of line.matchAll(new RegExp(`${NUM}\\s*(kib|mib|gib|tib|kb|mb|gb|tb)${END}`, 'gi'))) {
    const idx = m.index ?? 0;
    push({ kind: 'limit', unit: 'bytes', value: norm(toNum(m[1]!) * (SIZE[m[2]!.toLowerCase()] ?? NaN)), text: m[0], index: idx }, floorOf(), idx + m[0].length);
  }
  for (const m of line.matchAll(/(?<![\w.])port\s*[:=]?\s*(\d{2,5})(?!\w)(?!\.\d)/gi)) {
    const idx = m.index ?? 0;
    push({ kind: 'limit', unit: 'port', value: Number(m[1]), text: m[0], index: idx }, floorOf(), idx + m[0].length);
  }
  // Percentages (a canary share, an availability target, an error threshold). Kept under the limit rule so no new rule id is needed.
  for (const m of line.matchAll(new RegExp(`${NUM}\\s?(?:%|percent|per cent)${END}`, 'gi'))) {
    const idx = m.index ?? 0; const end = idx + m[0].length;
    if (RANGE_AFTER.test(line.slice(end)) || /\d\s*(?:[-–—]|to)\s*$/i.test(line.slice(Math.max(0, idx - 8), idx))) continue;
    push({ kind: 'limit', unit: 'percent', value: norm(toNum(m[1]!)), text: m[0], index: idx }, floorOf(), end);
  }
  const countRe = new RegExp(`${NUM}\\s*(k)?\\s*(${Object.keys(COUNT_UNITS).join('|')})\\b(?:\\s*(?:/|per|a|every|each)\\s*(seconds?|secs?|s|minutes?|mins?|hours?|hrs?|days?))?`, 'gi');
  for (const m of line.matchAll(countRe)) {
    const idx = m.index ?? 0; const end = idx + m[0].length;
    if (RANGE_AFTER.test(line.slice(end))) continue;
    const per = m[4] ? PER[m[4].toLowerCase().replace(/s$/, '')] ?? PER[m[4].toLowerCase()] : undefined;
    const count = toNum(m[1]!) * (m[2] ? 1000 : 1);
    push({ kind: 'limit', unit: `${COUNT_UNITS[m[3]!.toLowerCase()]}${per ? '/time' : ''}`, value: norm(per ? count / per : count), text: m[0], index: idx }, floorOf(), end);
  }
  // A count stated after the setting's name: "Max retries is 3", "Connection pool size: 20", "Max connections per host: 200".
  const setRe = /\b(retries|retry limit|attempts|pool size|batch size|queue size|page size|concurrency|connections|replicas|workers|threads|partitions)\b[^.;:=\d]{0,30}?(?:\s(?:is|are|should be|must be|of|to)\s+|\s*[:=]\s*)(\d{1,6})(?![\w%/:-])(?!\.\d)(?!\s*(?:ms|s|seconds?|minutes?|mins?|hours?|days?|%|percent|[kmgt]b)\b)/gi;
  for (const m of line.matchAll(setRe)) {
    const idx = (m.index ?? 0) + m[0].length - m[2]!.length;
    push({ kind: 'limit', unit: `set:${m[1]!.toLowerCase()}`, value: Number(m[2]), text: m[2]!, index: idx }, 0, idx + m[2]!.length);
  }
  return out.filter((f) => Number.isFinite(f.value));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toIso(s: string): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()); return mo < 0 ? null : valid(+m[3]!, mo + 1, +m[2]!); }
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()); return mo < 0 ? null : valid(+m[3]!, mo + 1, +m[1]!); }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w));
// Two dates about the same milestone kind ("release", "freeze") with nothing else named on either side are about the same thing.
// Numbers that sit after a setting name ("Max retries is 3") carry the name as their unit, so the subjects must be identical.
// For the rest, a word that only one side has is fine ("Access token expiry" and "Tokens expire"), but a different word on EACH side
// ("audit log retention" and "application log retention", "password reset link" and "invite link") means two different things.
const same = (a: Fact, b: Fact) => {
  if (a.kind !== b.kind || a.unit !== b.unit || a.qual !== b.qual) return false;
  const common = shared(a.subject, b.subject);
  if (a.kind === 'date') return common.length >= 1 || (a.subject.size === 0 && b.subject.size === 0);
  if (a.unit.startsWith('set:')) return a.subject.size === b.subject.size && common.length === a.subject.size && a.subject.size > 0;
  if ([...a.subject, ...b.subject].some((w) => DISTINCT.has(w) && !(a.subject.has(w) && b.subject.has(w)))) return false;
  return common.length >= 2 && !(common.length < a.subject.size && common.length < b.subject.size);
};

const show = (f: Fact) => f.text.trim();

// ---- canonical facts: one declared value, checked against any text ----
export interface CanonFact { kind: Kind; unit: string; value: number; text: string; subject: string[]; qual: string; env: string; /** For kind 'name': the declared name or identifier, as written. */ word?: string }
export interface Disagreement { line: number; snippet: string; pageValue: string }

/** A declared fact such as ("access token expiry", "1 hour"). Null unless the sentence holds exactly one time, limit or dated milestone. */
export function canonFromSentence(subject: string, value: string): CanonFact | null {
  const facts = factsInLine(normalizeWording(`${subject} ${value}`));
  if (facts.length === 0) return canonName(subject, value);
  if (facts.length !== 1) return null;
  const f = facts[0]!;
  return f.subject.size >= (f.kind === 'date' ? 1 : 2) ? { kind: f.kind, unit: f.unit, value: f.value, text: f.text.trim(), subject: [...f.subject], qual: f.qual, env: envOf(`${subject} ${value}`) } : null;
}

// ---- declared names and identifiers: "payments service owner" is "Team Atlas", "primary region" is "eu-west-1" ----
// Only two shapes are read, because they can be compared without guessing what a sentence means: a name of up to four capitalised words
// ("Team Atlas", "SRE"), or one identifier with a separator ("eu-west-1", "payments-api"). Free prose is refused when it is declared.
type Shape = 'name' | 'id';
const shapeOf = (v: string): Shape | null => {
  const words = v.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (words.length === 1 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/i.test(words[0]!)) return 'id';
  return words.every((w) => /^[A-Z][A-Za-z0-9'\u2019-]*$/.test(w) || /^[A-Z0-9]{2,}$/.test(w)) ? 'name' : null;
};
const stemsOf = (text: string): Set<string> => new Set(wordsOf(text).filter((w) => !STOP.has(w) && !GENERIC.has(w)).map(stem));

function canonName(subject: string, value: string): CanonFact | null {
  const word = value.trim();
  const shape = shapeOf(word);
  const stems = [...stemsOf(subject)];
  if (!shape || stems.length < 2) return null;
  return { kind: 'name', unit: shape, value: 0, text: word, word, subject: stems, qual: '', env: envOf(`${subject} ${word}`) };
}

// Where the value of "<subject> is/are/:/=/- <value>" starts, and where it ends (a comma, a bracket, "and", "but"...).
const SEP = /\s(?:is|are)\s+|\s*[:=]\s*|\s+[-\u2013\u2014]\s+/;
const VALUE_END = /[.;,()\[\]]|\s(?:and|but|or|because|who|which|for|until)\s/i;
function nameDisagreements(canon: CanonFact, text: string): { disagree: Disagreement[]; agree: number } {
  const want = canon.word ?? canon.text;
  const disagree: Disagreement[] = [];
  let agree = 0;
  text.split('\n').forEach((raw, i) => {
    if (HISTORICAL_RE.test(raw) || /\bdefault|\be\.g\.|\bfor example|\bexample\b/i.test(raw) || envOf(raw) !== (canon.env ?? '')) return;
    const line = raw.replace(/[*_`#>]/g, ' ');
    const m = SEP.exec(line);
    if (!m) return;
    const before = stemsOf(line.slice(0, m.index));
    if (!canon.subject.every((w) => before.has(w))) return;                      // the line must name the whole subject before the value
    const rest = line.slice(m.index + m[0].length).trim();
    const value = rest.split(VALUE_END)[0]!.replace(/["'\u201c\u201d]+/g, '').trim();
    if (!value || shapeOf(value) !== canon.unit) return;                       // prose or another shape is not comparable, so it stays silent
    if (value.toLowerCase() === want.toLowerCase()) agree++;
    else disagree.push({ line: i + 1, snippet: raw.trim().slice(0, 240), pageValue: value });
  });
  return { disagree: disagree.slice(0, 5), agree };
}

/** Lines of `text` that state the same thing as the canon (same kind, unit, qualifier and at least two shared subject words) with a different value. */
export function disagreements(canon: CanonFact, text: string): { disagree: Disagreement[]; agree: number } {
  if (canon.kind === 'name') return nameDisagreements(canon, text);
  const c: Fact = { ...canon, index: 0, subject: new Set(canon.subject) };
  const canonEnv = canon.env ?? '';
  const disagree: Disagreement[] = [];
  let agree = 0;
  text.split('\n').forEach((raw, i) => {
    if (HISTORICAL_RE.test(raw) || /\bdefault|\be\.g\.|\bfor example|\bexample\b/i.test(raw) || envOf(raw) !== canonEnv) return;
    const normed = normalizeWording(raw);
    for (const f of factsInLine(normed)) {
      if (f.kind !== canon.kind || !same(c, f)) continue;
      if (f.kind !== 'date' && DATED_BEFORE.test(normed.slice(0, f.index))) continue;     // the index points into the normalized line, so the prefix is taken from it
      if (f.value === canon.value) agree++;
      else disagree.push({ line: i + 1, snippet: raw.trim().slice(0, 240), pageValue: show(f) });
    }
  });
  return { disagree: disagree.slice(0, 5), agree };
}

const MILESTONE: Record<string, string> = { release: 'the release date', freeze: 'the code freeze', due: 'the due date', cutover: 'the cutover date', sunset: 'the sunset date' };

/** The numbers and dates the rules read from a work item's text, each with what it is about, for showing a person what was understood. */
export function ticketFactsOf(text: string): string[] {
  const out: string[] = [];
  for (const { facts } of extractFacts(text)) {
    for (const f of facts) {
      const words = [...f.subject].slice(0, 3).map((w) => f.surface?.[w] ?? w);
      const what = words.length ? words.join(' ') : f.kind === 'date' ? (MILESTONE[f.unit] ?? 'the date').replace(/^the /, '') : f.kind;
      out.push(`${f.text.trim()} (${what})`);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

function makeRule(id: string, kind: Kind, label: string, why: string): Rule {
  return {
    id, severity: 'warn', why,
    run({ workItem, page }: Pair): Finding[] {
      const ticketText = workItem.text ?? '';
      if (!ticketText.trim()) return [];
      const ticket = extractFacts(ticketText).flatMap(({ facts, lines }) => facts.filter((f) => f.kind === kind).map((f) => ({ f, line: lines[0]!.trim() })));
      if (!ticket.length) return [];
      const rows = extractFacts(page.text).map((r, i) => ({ ...r, n: i + 1 }));
      const pageFacts = rows.flatMap((r) => r.facts.filter((f) => f.kind === kind).map((f) => ({ f, line: r.lines[0]!, norm: r.norm, n: r.n })));
      const out: Finding[] = [];
      const seen = new Set<string>();
      for (const p of pageFacts) {
        const line = p.line;
        const live = kind === 'date' ? line.replace(/\b(?:deprecation|sunset|retirement|end[- ]of[- ]life)\s+(?:date|deadline|day)\b/gi, '') : line;
        if ((kind === 'date' ? HISTORICAL_DATE_RE : HISTORICAL_RE).test(live) || /\bdefault|\be\.g\.|\bfor example|\bexample\b/i.test(line)) continue;
        if (PAST_STATE.test(line) || (kind === 'date' ? PAST_EVENT.test(line) : pastYear(line, page.modifiedAt))) continue;
        if (kind !== 'date' && DATED_BEFORE.test(p.norm.slice(0, p.f.index))) continue;
        const matches = ticket.filter((t) => same(t.f, p.f) && envOf(t.line) === envOf(line));
        if (!matches.length) continue;
        const values = new Set(matches.map((t) => t.f.value));
        if (values.size !== 1 || values.has(p.f.value)) continue;                                   // the ticket is unambiguous, and the page disagrees
        if (pageFacts.some((o) => o !== p && same(o.f, p.f) && values.has(o.f.value))) continue;    // the page also states the ticket's value somewhere
        const t = matches[0]!;
        const key = `${p.n}|${show(p.f)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const words = [...shared(t.f.subject, p.f.subject)].slice(0, 3).map((w) => p.f.surface?.[w] ?? w);
        const what = words.length ? words.join(' ') : kind === 'date' ? MILESTONE[p.f.unit] ?? 'the date' : 'the value';
        out.push({
          ruleId: id, severity: 'warn', why,
          summary: `Page says ${what} is ${show(p.f)}, but ${workItem.key} says ${show(t.f)}`,
          evidence: {
            page: { id: page.id, modifiedAt: page.modifiedAt, line: p.n, snippet: line.trim() },
            fact: { label, ticketLine: t.line, ticketValue: show(t.f), pageValue: show(p.f) },
            workItem: { key: workItem.key, status: workItem.status },
          },
        });
      }
      return out;
    },
  };
}

export const durationDiffers = makeRule('R8_DURATION_DIFFERS', 'duration', 'duration', 'A time that readers will rely on (a timeout, an expiry, a window) is not the one the work item states.');
export const limitDiffers = makeRule('R9_LIMIT_DIFFERS', 'limit', 'limit', 'A limit, size or port that readers will rely on is not the one the work item states.');
export const dateDiffers = makeRule('R10_DATE_DIFFERS', 'date', 'date', 'A milestone date on the page is not the one the work item states, so people plan around the wrong day.');
