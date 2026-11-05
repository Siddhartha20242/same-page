import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { lastStatusTransition, normalizePage } from '../src/adapters.ts';
import { confluencePageIdsFromRemoteLinks } from '../src/links.ts';

// Contract tests against REAL captured payloads (scripts/capture-payloads.mjs).
// They skip until the files exist, then fail loudly if the adapters disagree with reality.
const load = (f: string) => (existsSync(`payloads/${f}`) ? JSON.parse(readFileSync(`payloads/${f}`, 'utf8')) : null);

test('real Jira changelog yields a usable last status transition', (t) => {
  const j = load('jira-changelog.json');
  if (!j) return t.skip('payloads/jira-changelog.json not captured yet');
  const entries = j.values ?? j.histories ?? [];
  const tr = lastStatusTransition(entries);
  assert.ok(tr, 'no status transition found; move the issue between statuses once, then recapture');
  assert.ok(!Number.isNaN(Date.parse(tr.at)), `unparseable timestamp: ${tr.at}`);
});

test('real Confluence page normalises with text, id and a last-edit time', (t) => {
  const j = load('confluence-page.json');
  if (!j) return t.skip('payloads/confluence-page.json not captured yet');
  const p = normalizePage(j);
  assert.ok(p.id && p.title);
  assert.ok(p.text.length > 0, 'empty text; check body-format=storage and the read scope');
  assert.ok(!Number.isNaN(Date.parse(p.modifiedAt)), `unparseable modifiedAt: ${p.modifiedAt}`);
});

test('real remote links yield Confluence page ids when the issue links a page', (t) => {
  const j = load('jira-remotelinks.json');
  if (!j) return t.skip('payloads/jira-remotelinks.json not captured yet');
  const ids = confluencePageIdsFromRemoteLinks(j);
  assert.ok(Array.isArray(ids));
  if (ids.length === 0) t.diagnostic('no Confluence page found in remote links: record this shape and fall back to search or a pasted URL');
});

test('real Confluence search returns a results list', (t) => {
  const j = load('confluence-search.json');
  if (!j) return t.skip('payloads/confluence-search.json not captured yet');
  assert.ok(Array.isArray(j.results), 'unexpected search shape; inspect payloads/confluence-search.json');
});
