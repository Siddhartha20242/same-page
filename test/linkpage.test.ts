import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageLink } from '../src/linkPage.ts';

const site = 'https://acme.atlassian.net';
test('a page address on this site is accepted in both common shapes and normalised', () => {
  assert.deepEqual(parsePageLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Payments+runbook', site), { ok: true, pageId: '12345', url: 'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=12345' });
  assert.deepEqual(parsePageLink('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=987', site), { ok: true, pageId: '987', url: 'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=987' });
});

test('addresses on other sites, non-pages, non-https and rubbish are refused with a plain reason', () => {
  for (const bad of ['', 'hello', 'http://acme.atlassian.net/wiki/spaces/E/pages/1/x', 'https://evil.example/wiki/spaces/E/pages/1/x', 'https://acme.atlassian.net/wiki/spaces/ENG/overview', 'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=abc', 'https://acme.atlassian.net.evil.example/wiki/spaces/E/pages/1/x']) {
    const r = parsePageLink(bad, site);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.ok(r.reason.length > 10);
  }
  assert.equal(parsePageLink('https://acme.atlassian.net/wiki/spaces/E/pages/1/x', undefined).ok, false);
});
