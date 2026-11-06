import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { Overview, OverviewRow } from '../core/overview';
import type { ProjectDrift } from '../core/drift';
import type { Impact } from '../core/impact';

const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;

type Reply = (Overview & { drift?: { at: string; hadPrevious?: boolean; project: ProjectDrift | null } | null; impact?: Impact & { canEdit: boolean } }) | { status: 'error'; message: string };
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

// What Same Page has done on this site, from its own counters. Time saved appears only after an administrator types their own estimate.
const ScanNow = ({ onDone }: { onDone: () => void }) => {
  const [state, setState] = useState<'idle' | 'working' | { error: string }>('idle');
  const go = async () => {
    setState('working');
    try { const r = await invoke<{ ok?: boolean; reason?: string }>('runScanNow'); if (r?.ok === false) setState({ error: r.reason ?? 'Not run.' }); else { setState('idle'); onDone(); } }
    catch { setState({ error: 'The scan could not run. Try again.' }); }
  };
  return (
    <Stack space="space.050">
      <Button isDisabled={state === 'working'} onClick={go}>{state === 'working' ? 'Scanning, this can take up to 40 seconds…' : 'Run the weekly scan now'}</Button>
      {typeof state === 'object' ? <Text>{state.error}</Text> : null}
    </Stack>
  );
};

const ImpactCard = ({ impact, onSaved }: { impact: Impact & { canEdit: boolean }; onSaved: () => void }) => {
  const [minutes, setMinutes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try { const r = await invoke<{ ok?: boolean; reason?: string }>('setMinutesPerFix', { minutes }); if (r?.ok === false) setMsg(r.reason ?? 'Not saved.'); else { setMsg(null); onSaved(); } }
    catch { setMsg('Not saved. Try again.'); }
  };
  return (
    <Stack space="space.100">
      <Heading size="xsmall">What Same Page has done on this site</Heading>
      <Text>{impact.line}</Text>
      <Text>{impact.review.line}</Text>
      {impact.estimatedHoursSaved !== null
        ? <Text>{`About ${impact.estimatedHoursSaved} hours of review time saved: ${impact.counts.applied} fixes at ${impact.minutesPerFix} minutes each. That is your administrator's own estimate, not something Same Page measured.`}</Text>
        : <Text>No time-saved figure yet. Same Page does not guess one; a Jira administrator can enter how many minutes one fix saves.</Text>}
      {impact.canEdit ? (
        <Stack space="space.050">
          <Text>Minutes saved per applied fix (0 clears it)</Text>
          <Inline space="space.100" alignBlock="center">
            <Textfield placeholder="Minutes, for example 15" onChange={(e) => setMinutes(e.target.value)} />
            <Button onClick={save}>Save estimate</Button>
          </Inline>
          {msg ? <Text>{msg}</Text> : null}
        </Stack>
      ) : null}
    </Stack>
  );
};

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
          {load.reply.drift ? <Text>{load.reply.drift.project ? `Weekly scan (${new Date(load.reply.drift.at).toLocaleDateString()}): ${load.reply.drift.project.withContradictions} of ${load.reply.drift.project.checked} checked open epics had contradictions${load.reply.drift.hadPrevious === false ? '. This is the first scan, so there is nothing to compare with yet.' : `, ${load.reply.drift.project.newSincePrevious} new and ${load.reply.drift.project.resolvedSincePrevious ?? 0} resolved since the scan before.`}` : `Weekly scan (${new Date(load.reply.drift.at).toLocaleDateString()}): no open epics in this project were checked.`}</Text> : <Text>No weekly scan result has reached this page yet. The scan runs once a week as the app, and its result is kept per product, so a Jira administrator can also run it here.</Text>}
          {load.reply.impact?.canEdit ? <ScanNow onDone={run} /> : null}
          {load.reply.impact ? <ImpactCard impact={load.reply.impact} onSaved={run} /> : null}
          {load.reply.rows.map((r) => <Row key={r.key} r={r} />)}
          <Text>Rules only, no AI in detection. A Not checked item is not a clean item.</Text>
        </Stack>
      ) : null}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
