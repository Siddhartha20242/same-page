// Reading an OpenAPI document that lives in a Confluence page (JSON in a code block), and checking doc lines like "POST /api/v1/charge"
// against it. Deterministic: no model, no network. A doc is compared with the real artifact, not just with a ticket.
// Only OpenAPI 3.x JSON is read; YAML is not (a documented limit).

export interface Operation { method: string; path: string; deprecated: boolean }
export interface Spec { operations: Operation[]; basePaths: string[]; title?: string }

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// The first balanced {...} object that contains an "openapi" key, found by scanning (string and escape aware) so surrounding prose is ignored.
function jsonObjectAround(text: string, at: number): string | null {
  for (let start = text.lastIndexOf('{', at); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i >= at ? text.slice(start, i + 1) : null;
    }
    if (start === 0) break;
  }
  return null;
}

/** The OpenAPI document inside a page's text, or null when the page is not a spec. Never throws. */
export function extractOpenApi(text: string): Spec | null {
  const m = /"openapi"\s*:\s*"3\./.exec(text ?? '');
  if (!m) return null;
  try {
    const raw = jsonObjectAround(text, m.index);
    if (!raw) return null;
    const doc = JSON.parse(raw) as { info?: { title?: string }; servers?: { url?: string }[]; paths?: Record<string, Record<string, { deprecated?: boolean } | unknown>> };
    if (!doc.paths || typeof doc.paths !== 'object') return null;
    const operations: Operation[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!item || typeof item !== 'object') continue;
      for (const method of METHODS) {
        const op = (item as Record<string, unknown>)[method];
        if (op && typeof op === 'object') operations.push({ method: method.toUpperCase(), path, deprecated: (op as { deprecated?: boolean }).deprecated === true });
      }
    }
    const basePaths = (doc.servers ?? []).map((s) => { try { return new URL(s.url ?? '', 'https://x.invalid').pathname.replace(/\/+$/, ''); } catch { return ''; } }).filter((p) => p && p !== '/');
    return { operations, basePaths, title: doc.info?.title };
  } catch { return null; }
}

const segs = (p: string) => p.split('/').filter(Boolean);
const isParam = (s: string) => /^\{[^}]+\}$/.test(s) || /^:[A-Za-z_]\w*$/.test(s) || /^<[^>]+>$/.test(s);

/** Does the documented path match a spec path template? `{id}`, `:id` and `<id>` match any one segment. */
export function pathMatches(docPath: string, specPath: string): boolean {
  const a = segs(docPath); const b = segs(specPath);
  return a.length === b.length && a.every((s, i) => s === b[i] || isParam(s) || isParam(b[i]!));
}

const DOC_OP = /\b(GET|POST|PUT|PATCH|DELETE)\s+((?:https?:\/\/[^\s/]+)?\/[^\s"'`)<>,;]*)/g;

/** Every "METHOD /path" mentioned in a line, with query strings, hosts and trailing punctuation removed. */
export function operationsInLine(line: string): { method: string; path: string; text: string }[] {
  const out: { method: string; path: string; text: string }[] = [];
  for (const m of line.matchAll(DOC_OP)) {
    const path = (m[2] ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/[.:]+$/, '');
    if (path.length > 1) out.push({ method: m[1]!, path, text: m[0] });
  }
  return out;
}

export type SpecVerdict = { kind: 'deprecated'; spec: Operation } | { kind: 'missing'; near: Operation[] } | null;

/** How a documented operation stands against the spec. null = it matches a live operation, or it is not about this API at all. */
// A spec can have thousands of operations and a page thousands of lines, so each spec is indexed once (cached per object) instead of
// being scanned for every line: operations by method + segment count + first segment, plus the first and last segments seen.
interface SpecIndex { buckets: Map<string, Operation[]>; firstSegs: Set<string>; byLast: Map<string, Operation[]> }
const indexes = new WeakMap<Spec, SpecIndex>();
function indexOf(spec: Spec): SpecIndex {
  const cached = indexes.get(spec);
  if (cached) return cached;
  const buckets = new Map<string, Operation[]>(); const firstSegs = new Set<string>(); const byLast = new Map<string, Operation[]>();
  const push = (m: Map<string, Operation[]>, k: string, o: Operation) => { const l = m.get(k); if (l) l.push(o); else m.set(k, [o]); };
  for (const o of spec.operations) {
    const s = segs(o.path);
    push(buckets, `${o.method} ${s.length} ${s[0] === undefined || isParam(s[0]) ? '*' : s[0]}`, o);
    if (s[0] !== undefined) firstSegs.add(s[0]);
    if (s.length) push(byLast, s[s.length - 1]!, o);
  }
  const built = { buckets, firstSegs, byLast };
  indexes.set(spec, built);
  return built;
}

export function judgeOperation(spec: Spec, doc: { method: string; path: string }): SpecVerdict {
  const ix = indexOf(spec);
  const candidates = [doc.path, ...spec.basePaths.filter((b) => doc.path.startsWith(`${b}/`)).map((b) => doc.path.slice(b.length))];
  let hit: Operation | undefined;
  for (const c of candidates) {
    const s = segs(c);
    const first = s[0];
    const lists = first === undefined || isParam(first)
      ? [...ix.buckets.entries()].filter(([k]) => k.startsWith(`${doc.method} ${s.length} `)).map(([, v]) => v)       // an unknown first segment: any bucket of that shape
      : [ix.buckets.get(`${doc.method} ${s.length} ${first}`), ix.buckets.get(`${doc.method} ${s.length} *`)].filter((l): l is Operation[] => Boolean(l));
    hit = lists.flat().find((o) => pathMatches(c, o.path));
    if (hit) break;
  }
  if (hit) return hit.deprecated ? { kind: 'deprecated', spec: hit } : null;
  // Only say "missing" for a path that is plainly in this API's family (same first segment as some spec path, or under a server base path),
  // so a line about some other service is left alone.
  const first = segs(doc.path)[0];
  const inFamily = (first !== undefined && ix.firstSegs.has(first)) || spec.basePaths.some((b) => segs(b)[0] === first);
  if (!inFamily) return null;
  const near = (ix.byLast.get(segs(doc.path).slice(-1)[0] ?? '') ?? []).slice(0, 3);
  return { kind: 'missing', near };
}
