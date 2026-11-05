import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { PageCheck } from '../core/pageCheck';

const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;
type Reply = PageCheck | { status: 'error'; message: string };

// Shown when the byline item is clicked. The first call as the viewing user is also where Confluence shows its "allow access" prompt:
// a consent error must stay uncaught in the resolver, so here a failed call just shows plain words.
// Only the rule name, the plain summary and the work item key are shown; the summaries come from the same rules as the Jira panel.
const Byline = () => {
  const [r, setR] = useState<Reply | null | 'failed'>(null);
  useEffect(() => { invoke<Reply>('pageCheck').then(setR).catch(() => setR('failed')); }, []);

  if (r === null) return <Stack space="space.100"><Inline space="space.100" alignBlock="center"><Spinner size="small" /><Text>Same Page is reading this page and the Jira work items it names…</Text></Inline><Text>This takes a few seconds. Nothing on the page is changed.</Text></Stack>;
  if (r === 'failed' || r.status === 'error') return <SectionMessage appearance="error" title="Same Page could not check this page"><Text>{r === 'failed' ? 'Same Page could not reach Confluence or Jira. Try again later.' : r.message}</Text></SectionMessage>;
  if (r.status === 'unchecked') return <SectionMessage appearance="information" title="Same Page: not checked"><Text>{`Not checked: ${r.reason}. This is not a clean result.`}</Text><Text>This item finds work items only by keys written in the page text, for example PAY-123. Add the key of the work item this page documents, or open the work item in Jira and use its Same Page panel, which follows links in both directions.</Text></SectionMessage>;
  const skipped = r.skipped.length ? <Text>{`Not compared: ${r.skipped.map((s) => `${s.key} (${s.reason})`).join('; ')}.`}</Text> : null;
  if (r.status === 'clean') return <Stack space="space.100"><Heading size="small">Same Page: no issues</Heading><Text>{`Compared this page with ${r.checked.join(', ')} (found from the Jira keys written in this page). No contradictions found by the 10 rules. Rules only, no AI.`}</Text>{skipped}</Stack>;
  return (
    <Stack space="space.150">
      <Heading size="small">{`Same Page: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`}</Heading>
      <Text>{`This page disagrees with a Jira work item it names. Work items are found from the Jira keys written in this page's text (${r.checked.join(', ')}).`}</Text>
      {r.issues.map((i, n) => (
        <Stack key={`${i.key}${i.ruleId}${n}`} space="space.050">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Lozenge appearance={i.severity === 'block' ? 'removed' : 'moved'} isBold>{i.rule}</Lozenge>
            <Lozenge appearance="default">{i.key}</Lozenge>
          </Inline>
          <Text>{i.summary}</Text>
        </Stack>
      ))}
      {skipped}
      <Text>Next step: open the work item (the key in the label above) in Jira, then its Same Page panel, where you get the evidence, a verified edit to apply, and a review task for the page owner.</Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><Byline /></React.StrictMode>);
