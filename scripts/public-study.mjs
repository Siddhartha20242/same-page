// Read-only probe of Apache's PUBLIC wiki and Jira (Server-style APIs, no login), one request per second.
// Direction: wiki page -> issue keys found in its source (macros included) -> issue -> engine.
//   node scripts/public-study.mjs KAFKA 30 [fixVersion|summary]
import { writeFileSync, mkdirSync } from 'node:fs';
import { check } from '../src/engine.ts';
import { deriveTargetVersion, storageToText } from '../src/adapters.ts';

const [project = 'KAFKA', pageLimit = '30', source = 'fixVersion'] = process.argv.slice(2);
const JIRA = 'https://issues.apache.org/jira/rest/api/2';
const WIKI = 'https://cwiki.apache.org/confluence/rest/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  await sleep(1000);
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'same-page-research (read-only, 1 req/s)' } });
  if (!res.ok) return null;
  return res.json();
}

const cql = encodeURIComponent(`space = ${project} AND type = page ORDER BY lastmodified ${process.env.ORDER || "DESC"}`);
const pages = (await get(`${WIKI}/content/search?cql=${cql}&limit=${pageLimit}&expand=body.storage,version`))?.results ?? [];
console.log(`pages fetched: ${pages.length}`);

const stats = { pages: pages.length, pairs: 0, resolvedWithTarget: 0, pageOlder: 0, findings: 0 };
const rows = [];
const seen = new Map();
for (const p of pages) {
  const html = p.body?.storage?.value ?? '';
  const keys = [...new Set(html.match(new RegExp(`\\b${project}-\\d+\\b`, 'g')) ?? [])].slice(0, 3);
  for (const key of keys) {
    stats.pairs++;
    if (!seen.has(key)) seen.set(key, await get(`${JIRA}/issue/${key}?fields=summary,fixVersions,resolutiondate`));
    const it = seen.get(key);
    if (!it?.fields?.resolutiondate) continue;
    const issue = { key, summary: it.fields.summary, status: 'Done', fixVersions: it.fields.fixVersions.map((v) => v.name), requiredFields: [], fields: {} };
    const apiVersion = deriveTargetVersion(issue, { sources: [source] });
    if (!apiVersion) continue;
    stats.resolvedWithTarget++;
    const page = { id: p.id, title: p.title, text: storageToText(html), modifiedAt: p.version?.when, labels: [] };
    if (new Date(page.modifiedAt) < new Date(it.fields.resolutiondate)) stats.pageOlder++;
    for (const f of check({ workItem: { ...issue, apiVersion, statusChangedAt: it.fields.resolutiondate }, page }).findings) {
      stats.findings++;
      rows.push({ issue: key, fixVersions: issue.fixVersions, target: apiVersion, page: p.title, severity: f.severity, line: f.evidence.page.line, snippet: f.evidence.page.snippet.slice(0, 200) });
    }
  }
}
mkdirSync('study', { recursive: true });
writeFileSync(`study/${project}-${source}.json`, JSON.stringify({ stats, rows }, null, 2));
console.log(JSON.stringify(stats));
for (const r of rows.slice(0, 12)) console.log(`\n[${r.severity}] ${r.issue} fix ${r.fixVersions.join(',')} -> ${r.target} | "${r.page}" line ${r.line}\n   ${r.snippet}`);
