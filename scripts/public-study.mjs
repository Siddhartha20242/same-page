// Read-only probe of PUBLIC Apache wiki (Confluence Server) and Jira (Server) APIs. No login, no credentials, GET only,
// one request per second in total, a plain User-Agent, and an immediate stop on HTTP 429/403 (a block).
//
//   node scripts/public-study.mjs <PROJECT> [pagesPerOrder=30] [seed=1]
//   PROJECT is one of: KAFKA HADOOP CASSANDRA FLINK SPARK ZOOKEEPER (see PROJECTS below).
//   HIVE was tried and dropped: its CQL search returned 0 pages for space = Hive, so there was nothing to read.
//
// Direction: wiki page -> issue keys in its source -> the issue (status, changelog) -> the engine (src/engine.ts, all rules).
// Sampling: up to `pagesPerOrder` pages that contain an issue key from the OLDEST edits and the same number from the NEWEST
// edits (so at most 2 x pagesPerOrder = 60 pages by default). To find them it reads up to 150 page bodies per order.
// Per page at most 4 issue keys are followed. Each (page, issue) pair is a "pair".
// Engine inputs built from real data: status (Jira statusCategory: done -> "Done", new -> "To Do", else "In Progress"),
// statusChangedAt (latest status transition in the changelog), cited-ticket statuses for R6 (all keys on the page), and an API
// version for R1 only when the issue summary or components name one (fixVersion is run separately as an opt-in source).
// R2 (needs page labels), R3 (needs required fields) and R5 (needs an OpenAPI spec page) are not exercised: no data for them.
// Output: study/<PROJECT>.json (findings with one short line each, plus a seeded random sample of 20 non-finding pairs for hand
// labelling of misses). Page bodies are not saved.
import { writeFileSync, mkdirSync } from 'node:fs';
import { check } from '../src/engine.ts';
import { deriveTargetVersion, storageToText, lastStatusTransition } from '../src/adapters.ts';

const PROJECTS = {
  KAFKA: { space: 'KAFKA', keys: 'KAFKA' },
  HADOOP: { space: 'HADOOP', keys: 'HADOOP|HDFS|YARN|MAPREDUCE|HDDS' },
  CASSANDRA: { space: 'CASSANDRA', keys: 'CASSANDRA' },
  FLINK: { space: 'FLINK', keys: 'FLINK' },
  SPARK: { space: 'SPARK', keys: 'SPARK' },
  ZOOKEEPER: { space: 'ZOOKEEPER', keys: 'ZOOKEEPER' },
  // Held out: never looked at while the rules were tuned against the five above.
  IGNITE: { space: 'IGNITE', keys: 'IGNITE' },
  SOLR: { space: 'SOLR', keys: 'SOLR' },
  AIRFLOW: { space: 'AIRFLOW', keys: 'AIRFLOW' },
  NIFI: { space: 'NIFI', keys: 'NIFI' },
  IMPALA: { space: 'IMPALA', keys: 'IMPALA' },
  // Second held-out set, chosen after the Solr guards were added.
  BEAM: { space: 'BEAM', keys: 'BEAM' },
  DRILL: { space: 'DRILL', keys: 'DRILL' },
  KYLIN: { space: 'KYLIN', keys: 'KYLIN' },
  TEZ: { space: 'TEZ', keys: 'TEZ' },
  HUDI: { space: 'HUDI', keys: 'HUDI' },
};
const [project = 'HADOOP', perOrderArg = '30', seedArg = '1'] = process.argv.slice(2);
const cfg = PROJECTS[project];
if (!cfg) throw new Error(`unknown project ${project}`);
const perOrder = Number(perOrderArg);
const JIRA = 'https://issues.apache.org/jira/rest/api/2';
const WIKI = 'https://cwiki.apache.org/confluence/rest/api';
const UA = 'same-page-research (read-only, 1 req/s, public APIs)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
async function get(url) {
  await sleep(1000);
  requests++;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 429 || res.status === 403) { console.error(`STOP: HTTP ${res.status} from ${new URL(url).host}`); process.exit(2); }
  if (!res.ok) return null;
  return res.json();
}
let s = Number(seedArg) >>> 0 || 1;
const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);   // seeded LCG, so the sample is reproducible
const keyRe = new RegExp(`\\b(?:${cfg.keys})-\\d+\\b(?!\\.\\d)`, 'g');   // (?!\.\d): "FLINK-2.4" is a release number, not issue FLINK-2

// 1. pages with issue keys, from both ends of the edit history
const pages = new Map();
let scanned = 0;
for (const order of ['asc', 'desc']) {
  let kept = 0;
  for (let start = 0; start < 150 && kept < perOrder; start += 25) {
    const cql = encodeURIComponent(`space = "${cfg.space}" AND type = page ORDER BY lastmodified ${order}`);
    const res = (await get(`${WIKI}/content/search?cql=${cql}&limit=25&start=${start}&expand=body.storage,version`))?.results ?? [];
    if (!res.length) break;
    for (const p of res) {
      scanned++;
      const text = storageToText(p.body?.storage?.value ?? '');
      const keys = [...new Set(text.match(keyRe) ?? [])];
      if (!keys.length || pages.has(p.id) || kept >= perOrder) continue;
      kept++;
      pages.set(p.id, { id: p.id, title: p.title, text, modifiedAt: p.version?.when, labels: [], keys: keys.slice(0, 4), order });
    }
  }
}
console.log(`${project}: page bodies read ${scanned}, pages kept ${pages.size}`);

// 2. issues
const issues = new Map();
async function issue(key) {
  if (issues.has(key)) return issues.get(key);
  const it = await get(`${JIRA}/issue/${key}?fields=summary,description,status,resolutiondate,fixVersions,components&expand=changelog`);
  let out = null;
  if (it?.fields) {
    const cat = it.fields.status?.statusCategory?.key;
    const t = lastStatusTransition(it.changelog?.histories ?? []);
    out = {
      key, summary: it.fields.summary, description: typeof it.fields.description === 'string' ? it.fields.description.slice(0, 4000) : '', rawStatus: it.fields.status?.name,
      status: cat === 'done' ? 'Done' : cat === 'new' ? 'To Do' : 'In Progress',
      fixVersions: (it.fields.fixVersions ?? []).map((v) => v.name), components: (it.fields.components ?? []).map((c) => c.name),
      statusChangedAt: t?.at ?? it.fields.resolutiondate ?? undefined, statusChangedBy: t?.by ?? null,
    };
  }
  issues.set(key, out);
  return out;
}

// 3. engine
const stats = { project, pages: pages.size, pagesScanned: scanned, pairs: 0, issueReadable: 0, pairsWithTransition: 0, pageOlderThanTransition: 0,
  r1TargetFromSummary: 0, r1TargetFromFixVersion: 0, findings: 0, byRule: {}, requests: 0 };
const rows = []; const nonFindings = [];
const seenFinding = new Set();
for (const p of pages.values()) {
  const cited = {};
  for (const k of p.keys) { const it = await issue(k); if (it) cited[k] = { status: it.status, changedAt: it.statusChangedAt }; }
  for (const k of p.keys) {
    stats.pairs++;
    const it = issues.get(k);
    if (!it) continue;
    stats.issueReadable++;
    if (!it.statusChangedAt) continue;
    stats.pairsWithTransition++;
    const older = new Date(p.modifiedAt) < new Date(it.statusChangedAt);
    if (older) stats.pageOlderThanTransition++;
    const base = { key: k, summary: it.summary, text: [it.summary, it.description].filter(Boolean).join('\n'), status: it.status, requiredFields: [], fields: {}, components: it.components, fixVersions: it.fixVersions, statusChangedAt: it.statusChangedAt, statusChangedBy: it.statusChangedBy };
    const fromSummary = deriveTargetVersion(base, { sources: ['component', 'summary'] });
    const fromFix = deriveTargetVersion(base, { sources: ['fixVersion'] });
    if (fromSummary) stats.r1TargetFromSummary++;
    if (fromFix) stats.r1TargetFromFixVersion++;
    const page = { id: p.id, title: p.title, text: p.text, modifiedAt: p.modifiedAt, labels: [] };
    const runs = [['default', fromSummary], ...(fromFix ? [['fixVersion', fromFix]] : [])];
    let any = false;
    for (const [mode, apiVersion] of runs) {
      for (const f of check({ workItem: { ...base, apiVersion }, page, cited }).findings) {
        if (f.ruleId === 'R6_CITED_TICKET_CLOSED' && f.evidence.workItem?.key !== k) continue;
        const id = `${f.ruleId === 'R1_VERSION_MISMATCH' ? mode : ''}|${f.ruleId}|${p.id}|${f.evidence.page?.line}|${f.evidence.cited?.key ?? k}`;
        if (seenFinding.has(id)) continue;
        seenFinding.add(id); any = true;
        stats.findings++; stats.byRule[f.ruleId] = (stats.byRule[f.ruleId] ?? 0) + 1;
        rows.push({ mode, rule: f.ruleId, severity: f.severity, issue: k, jiraStatus: it.rawStatus, statusChangedAt: it.statusChangedAt, cited: f.evidence.cited ?? null,
          target: apiVersion ?? null, page: p.title, pageId: p.id, pageModifiedAt: p.modifiedAt, line: f.evidence.page?.line, snippet: (f.evidence.page?.snippet ?? '').slice(0, 200), summary: f.summary });
      }
    }
    if (!any) {
      const lines = p.text.split('\n'); const at = lines.findIndex((l) => l.includes(k));
      nonFindings.push({ issue: k, jiraStatus: it.rawStatus, statusChangedAt: it.statusChangedAt, issueSummary: it.summary?.slice(0, 100), page: p.title, pageId: p.id, pageModifiedAt: p.modifiedAt, pageOlder: older, line: at + 1, snippet: lines[at]?.trim().slice(0, 200) });
    }
  }
}
// seeded shuffle, keep 20 non-findings for hand labelling
for (let i = nonFindings.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [nonFindings[i], nonFindings[j]] = [nonFindings[j], nonFindings[i]]; }
stats.nonFindingPairs = nonFindings.length;
stats.requests = requests;
const outDir = process.env.STUDY_OUT || 'study';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${project}.json`, JSON.stringify({ ranAt: new Date().toISOString(), seed: Number(seedArg), stats, findings: rows, nonFindingSample: nonFindings.slice(0, 20) }, null, 2));
console.log(JSON.stringify(stats));
