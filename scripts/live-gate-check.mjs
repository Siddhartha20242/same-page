#!/usr/bin/env node
// End-to-end check of the pre-ship gate against a REAL Jira + Confluence site, using only REST. It needs no browser.
// It creates one runbook page (stale), one epic in your project, links them, then:
//   1. tries to move the epic to Done           -> expects HTTP 400 and the Same Page evidence message
//   2. fixes the page text through the Confluence API (as the panel's Apply would)
//   3. tries Done again                           -> expects HTTP 204
// and prints PASS or FAIL per step. Run it after every deploy.
//
// Usage:
//   SITE=your-site.atlassian.net EMAIL=you@example.com TOKEN=<atlassian api token> PROJECT=PAY SPACE_ID=<confluence space id> node scripts/live-gate-check.mjs
// The project must be COMPANY-MANAGED and have "Same Page contradiction check" on its Done transition (see docs/gate-setup.md).
// The token is read from the environment only and is never printed. It creates two items you can delete afterwards.

const { SITE, EMAIL, TOKEN, PROJECT, SPACE_ID } = process.env;
if (![SITE, EMAIL, TOKEN, PROJECT, SPACE_ID].every(Boolean)) { console.error('Set SITE, EMAIL, TOKEN, PROJECT and SPACE_ID (see the header of this file).'); process.exit(2); }

const base = `https://${SITE}`;
const auth = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const call = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check', ...(init.headers ?? {}) } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failed++; };

const stamp = Date.now();
const page = await call('/wiki/api/v2/pages', { method: 'POST', body: JSON.stringify({ spaceId: SPACE_ID, status: 'current', title: `Gate check runbook ${stamp}`, body: { representation: 'storage', value: '<p>Call POST /api/v1/charge with the order id.</p>' } }) });
step('create the stale runbook page', page.status === 200 && page.json?.id, `HTTP ${page.status}`);
if (failed) process.exit(1);
await wait(1500);                                                           // the page must be OLDER than the epic's status change
const epic = await call('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields: { project: { key: PROJECT }, issuetype: { name: 'Epic' }, summary: `Migrate to v2 (gate check ${stamp})` } }) });
step('create the epic', epic.status === 201, `HTTP ${epic.status}`);
if (failed) process.exit(1);
const key = epic.json.key;
const trs = (await call(`/rest/api/3/issue/${key}/transitions`)).json?.transitions ?? [];
const to = (name) => trs.find((t) => t.to?.name === name)?.id;
const toProgress = await call(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: to('In Progress') } }) });
step('move the epic to In Progress', toProgress.status === 204, `HTTP ${toProgress.status}`);
const link = await call(`/rest/api/3/issue/${key}/remotelink`, { method: 'POST', body: JSON.stringify({ object: { url: `${base}/wiki/pages/viewpage.action?pageId=${page.json.id}`, title: `Gate check runbook ${stamp}` } }) });
step('link the page to the epic', link.status === 201, `HTTP ${link.status}`);

const blocked = await call(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: to('Done') } }) });
const message = blocked.json?.errorMessages?.[0] ?? '';
step('Done is REFUSED while the runbook says v1', blocked.status === 400 && /Same Page blocked/.test(message), `HTTP ${blocked.status}`);
step('the message names the rule', /\[R1\]/.test(message));
console.log(`      message: ${message.slice(0, 220)}`);

const cur = await call(`/wiki/api/v2/pages/${page.json.id}?body-format=storage`);
const fixed = await call(`/wiki/api/v2/pages/${page.json.id}`, { method: 'PUT', body: JSON.stringify({ id: page.json.id, status: 'current', title: cur.json.title, body: { representation: 'storage', value: '<p>Call POST /api/v2/charge with the order id.</p>' }, version: { number: cur.json.version.number + 1, message: 'live-gate-check: version fix' } }) });
step('fix the page', fixed.status === 200, `HTTP ${fixed.status}`);
await wait(1000);

const allowed = await call(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: to('Done') } }) });
step('Done is ALLOWED once the page is fixed', allowed.status === 204, `HTTP ${allowed.status}`);

console.log(`\nCreated ${key} and page ${page.json.id}; delete them when you are done.`);
console.log(failed ? `${failed} step(s) FAILED` : 'ALL STEPS PASSED');
process.exit(failed ? 1 : 0);
