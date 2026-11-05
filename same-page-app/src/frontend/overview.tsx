import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { Overview, OverviewRow } from '../core/overview';
import type { ProjectDrift } from '../core/drift';

const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;

type Reply = (Overview & { drift?: { at: string; project: ProjectDrift | null } | null }) | { status: 'error'; message: string };
type Load = { phase: 'loading' } | { phase: 'failed' } | { phase: 'done'; reply: Reply };

const TONE: Record<OverviewRow['verdict'], 'removed' | 'moved' | 'success' | 'default'> = { Blocked: 'removed', Warning: 'moved', Clean: 'success', 'Not checked': 'default' };

// Read-only view of the project: one row per open epic or in-progress work item. Nothing on this page changes anything in Jira or Confluence.
const Row = ({ r }: { r: OverviewRow }) => (
  <Stack space="space.050">
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Link href={`/browse/${r.key}`}>{r.key}</Link>
      <Text>{r.summary}</Text>
    </Inline>
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Lozenge appearance={TONE[r.verdict]} isBold={r.verdict === 'Blocked'}>{r.verdict}</Lozenge>
      {r.verdict === 'Not checked'
        ? <Text>{`Reason: ${r.reason ?? 'unknown'}`}</Text>
        : <Text>{`${r.findings} finding${r.findings === 1 ? '' : 's'}${r.notes ? `, ${r.notes} note${r.notes === 1 ? '' : 's'} on possibly intentional history` : ''}`}</Text>}
    </Inline>
  </Stack>
);

const App = () => {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const run = useCallback(() => {
    setLoad({ phase: 'loading' });
    invoke<Reply>('getOverview').then((reply) => setLoad({ phase: 'done', reply })).catch(() => setLoad({ phase: 'failed' }));
  }, []);
  useEffect(run, [run]);

  return (
    <Stack space="space.200">
      <Text>Open epics and in-progress work items in this project, checked against the Confluence pages about them with your permissions. Read-only.</Text>
      <Inline space="space.100" alignBlock="center">
        <Button onClick={run} isDisabled={load.phase === 'loading'}>Check again</Button>
        {load.phase === 'loading' ? <Inline space="space.100" alignBlock="center"><Spinner size="small" /><Text>Checking, this can take up to 20 seconds…</Text></Inline> : null}
      </Inline>
      {load.phase === 'failed' ? <SectionMessage appearance="error" title="Could not load the overview"><Text>Something went wrong. Try Check again.</Text></SectionMessage> : null}
      {load.phase === 'done' && load.reply.status === 'error' ? <SectionMessage appearance="error" title="Could not load the overview"><Text>{load.reply.message}</Text></SectionMessage> : null}
      {load.phase === 'done' && load.reply.status === 'ready' ? (
        <Stack space="space.150">
          <SectionMessage appearance={load.reply.withContradictions ? 'warning' : load.reply.unchecked ? 'information' : 'success'} title="Summary">
            <Text>{load.reply.summaryLine}</Text>
            {load.reply.coverageLine ? <Text>{load.reply.coverageLine}</Text> : null}
          </SectionMessage>
          {load.reply.drift ? <Text>{load.reply.drift.project ? `Weekly scan (${new Date(load.reply.drift.at).toLocaleDateString()}): ${load.reply.drift.project.withContradictions} of ${load.reply.drift.project.checked} checked open epics had contradictions, ${load.reply.drift.project.newSincePrevious} new since the scan before.` : `Weekly scan (${new Date(load.reply.drift.at).toLocaleDateString()}): no open epics in this project were checked.`}</Text> : <Text>The weekly scan has not run yet. It runs once a week as the app and reports here.</Text>}
          {load.reply.rows.map((r) => <Row key={r.key} r={r} />)}
          <Text>Rules only, no AI in detection. A Not checked item is not a clean item.</Text>
        </Stack>
      ) : null}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
