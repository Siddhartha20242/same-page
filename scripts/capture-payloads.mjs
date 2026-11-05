// Captures the four real API payloads the adapters depend on, redacts people, and writes them to ./payloads.
// Run it yourself with your own credentials; nothing here sends them anywhere except your Atlassian site.
//
//   JIRA_SITE=https://yoursite.atlassian.net ATLASSIAN_EMAIL=you@example.com ATLASSIAN_API_TOKEN=... \
//   ISSUE_KEY=EG-1 PAGE_ID=123456 node scripts/capture-payloads.mjs
//
// Create the API token at https://id.atlassian.com/manage-profile/security/api-tokens (never paste it into chat).
import { mkdirSync, writeFileSync } from 'node:fs';

const { JIRA_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, ISSUE_KEY, PAGE_ID, CQL = 'type=page order by lastmodified desc' } = process.env;
for (const [k, v] of Object.entries({ JIRA_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, ISSUE_KEY, PAGE_ID })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}
const auth = 'Basic ' + Buffer.from(`${ATLASSIAN_EMAIL}:${ATLASSIAN_API_TOKEN}`).toString('base64');
const names = new Map();
const alias = (v) => { if (!names.has(v)) names.set(v, `User ${names.size + 1}`); return names.get(v); };

// Replace people and avatars so the files are safe to share.
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'avatarUrls' || k === 'self' && typeof val === 'string' && val.includes('/user?')) continue;
      if (['accountId', 'authorId', 'ownerId', 'emailAddress'].includes(k) && typeof val === 'string') out[k] = alias(val);
      else if (k === 'displayName' && typeof val === 'string') out[k] = alias(val);
      else out[k] = redact(val);
    }
    return out;
  }
  return v;
}

async function get(path) {
  const res = await fetch(`${JIRA_SITE}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}\n${body.slice(0, 300)}`);
  return JSON.parse(body);
}

mkdirSync('payloads', { recursive: true });
const jobs = {
  'jira-changelog.json': `/rest/api/3/issue/${ISSUE_KEY}/changelog`,
  'jira-remotelinks.json': `/rest/api/3/issue/${ISSUE_KEY}/remotelink`,
  'confluence-page.json': `/wiki/api/v2/pages/${PAGE_ID}?body-format=storage`,
  'confluence-search.json': `/wiki/rest/api/search?cql=${encodeURIComponent(CQL)}&limit=10`,
};
for (const [file, path] of Object.entries(jobs)) {
  try {
    writeFileSync(`payloads/${file}`, JSON.stringify(redact(await get(path)), null, 2));
    console.log(`saved payloads/${file}`);
  } catch (e) { console.error(`FAILED ${file}: ${e.message}`); }
}
console.log('\nThese files still contain page text and issue titles. Read them before sharing.');
