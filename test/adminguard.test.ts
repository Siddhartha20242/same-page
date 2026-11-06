import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A live test as a non-admin needs a second Atlassian account, which this project does not have. This test reads the resolver source instead:
// every resolver must check administrator rights, or be on the list below of resolvers that are open to any user on purpose.
const src = readFileSync(new URL('../same-page-app/src/index.ts', import.meta.url), 'utf8');
const resolvers = [...src.matchAll(/resolver\.define\('(\w+)'/g)].map((m) => ({ name: m[1]!, body: src.slice(m.index!, src.indexOf('\n});', m.index!)) }));

// Open to any user who can see the work item. Each one acts as that user (asUser), so Jira's own permissions still apply, or it only records the viewer's own mark.
const OPEN = new Set([
  'getPanel',            // reads the panel the viewer is allowed to see; pages the viewer cannot read are redacted
  'createReviewTask',    // creates a Jira task as the viewer
  'applyFix',            // edits a Confluence page as the viewer; Confluence enforces edit rights
  'ledgerView',          // read-only audit summary
  'reviewFinding',       // records a real / false alarm mark
  'linkPage',            // adds a web link to the work item as the viewer
  'triage',              // snooze or dismiss a finding
  'setTargetVersion',    // writes an issue property as the viewer
  'confluenceCheck',     // read-only check of the page being viewed
]);

test('every site-wide or administrative resolver checks administrator rights', () => {
  assert.ok(resolvers.length >= 20, 'found the resolvers');
  for (const r of resolvers) {
    if (OPEN.has(r.name)) continue;
    assert.ok(/isJiraAdmin|canOverride/.test(r.body), `${r.name} has no administrator check; add one, or add it to OPEN with the reason`);
  }
});

test('the open list only names resolvers that exist, so it cannot hide a rename', () => {
  const names = new Set(resolvers.map((r) => r.name));
  for (const n of OPEN) assert.ok(names.has(n), `${n} is listed as open but no such resolver exists`);
});

test('demo seeding, which creates work items and pages, is administrator-only', () => {
  assert.ok(/isJiraAdmin/.test(resolvers.find((r) => r.name === 'seedDemo')!.body));
});
