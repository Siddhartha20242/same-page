import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, DynamicTable, Heading, Icon, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text, Textfield, xcss } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { Overview, OverviewRow } from '../core/overview';
import type { ProjectDrift } from '../core/drift';
import type { Impact } from '../core/impact';
import { bySeverity } from '../core/verdictOrder';

const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;

type Reply = (Overview & { drift?: { at: string; hadPrevious?: boolean; project: ProjectDrift | null } | null; impact?: Impact & { canEdit: boolean } }) | { status: 'error'; message: string };
type Load = { phase: 'loading' } | { phase: 'failed' } | { phase: 'done'; reply: Reply };

const TONE: Record<OverviewRow['verdict'], 'removed' | 'moved' | 'success' | 'default'> = { Blocked: 'removed', Warning: 'moved', Clean: 'success', 'Not checked': 'default' };

const tileBase = { borderColor: 'color.border', borderStyle: 'solid', borderWidth: 'border.width', borderRadius: 'radius.large', padding: 'space.200', minWidth: '120px' } as const;
const tileStyles = {
  danger: xcss({ ...tileBase, backgroundColor: 'color.background.danger' }),
  warning: xcss({ ...tileBase, backgroundColor: 'color.background.warning' }),
  success: xcss({ ...tileBase, backgroundColor: 'color.background.success' }),
  neutral: xcss({ ...tileBase, backgroundColor: 'elevation.surface.raised' }),
};
const padStyle = xcss({ paddingBlockStart: 'space.200', width: '100%' });
const fullWidth = xcss({ width: '100%' });

// One number with a label, as a card: the project's state at a glance.
// A tile is tinted only when its count is above zero, so a clean project is calm and a blocked one stands out.
const Tile = ({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'warning' | 'success' | 'neutral' }) => (
  <Box xcss={tileStyles[value > 0 ? tone : 'neutral']}>
    <Stack space="space.050">
      <Inline space="space.075" alignBlock="center">
        <Icon glyph={tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : tone === 'success' ? 'check-circle' : 'info'} label={label} size="small" />
        <Text>{label}</Text>
      </Inline>
      <Heading size="large">{String(value)}</Heading>
    </Stack>
  </Box>
);

// Read-only view of the project: one row per open epic or in-progress work item. Nothing on this page changes anything in Jira or Confluence.

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
  const [filter, setFilter] = useState<'All' | OverviewRow['verdict']>('All');
  const run = useCallback((carried?: OverviewRow[]) => {
    setLoad({ phase: 'loading' });
    invoke<Reply>('getOverview', carried ? { carried } : undefined).then((reply) => setLoad({ phase: 'done', reply })).catch(() => setLoad({ phase: 'failed' }));
  }, []);
  useEffect(() => { run(); }, [run]);

  const ready = load.phase === 'done' && load.reply.status === 'ready' ? load.reply : null;
  const count = (v: OverviewRow['verdict']) => (ready ? ready.rows.filter((r) => r.verdict === v).length : 0);
  const itemsTab = ready ? (
    <Stack space="space.200">
      <Inline space="space.150" shouldWrap>
        <Tile label="Blocked" value={count('Blocked')} tone="danger" />
        <Tile label="Warning" value={count('Warning')} tone="warning" />
        <Tile label="Clean" value={count('Clean')} tone="success" />
        <Tile label="Not checked" value={count('Not checked')} tone="neutral" />
      </Inline>
      <SectionMessage appearance={ready.withContradictions ? 'warning' : ready.unchecked ? 'information' : 'success'} title={ready.summaryLine.replace(/\.$/, '')}>
        {ready.coverageLine ? <Text>{ready.coverageLine}</Text> : ready.rows.length ? <Text>Open a work item, then choose Same Page from its apps menu (the puzzle icon under the title) to see the evidence for each finding.</Text> : null}
      </SectionMessage>
      {ready.rows.length > 1 ? (
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Text>Show:</Text>
          {(['All', 'Blocked', 'Warning', 'Not checked', 'Clean'] as const).map((f) => {
            const n = f === 'All' ? ready.rows.length : count(f);
            return n > 0 || f === 'All' ? <Button key={f} appearance={filter === f ? 'primary' : 'default'} onClick={() => setFilter(f)}>{`${filter === f ? '✓ ' : ''}${f} (${n})`}</Button> : null;
          })}
        </Inline>
      ) : null}
      {ready.rows.length ? (
        <DynamicTable
          caption="Open epics and in-progress work items"
          head={{ cells: [{ key: 'key', content: 'Work item' }, { key: 'summary', content: 'Summary' }, { key: 'verdict', content: 'Verdict' }, { key: 'detail', content: 'Detail' }] }}
          rows={bySeverity(ready.rows).filter((r) => filter === 'All' || r.verdict === filter).map((r) => ({ key: r.key, cells: [
            { key: 'key', content: <Link href={`/browse/${r.key}`}>{r.key}</Link> },
            { key: 'summary', content: r.summary },
            { key: 'verdict', content: <Lozenge appearance={TONE[r.verdict]} isBold={r.verdict === 'Blocked'}>{r.verdict}</Lozenge> },
            { key: 'detail', content: r.verdict === 'Not checked'
              ? `Reason: ${r.reason ?? 'unknown'}`
              : `${r.findings} finding${r.findings === 1 ? '' : 's'}${r.notes ? `, ${r.notes} note${r.notes === 1 ? '' : 's'}` : ''}${r.headline ? `: ${r.headline}` : ''}` },
          ] }))}
        />
      ) : null}
      <Text>Worst first. Rules only, no AI in detection. A Not checked item is not a clean item.</Text>
    </Stack>
  ) : null;
  const weeklyLine = ready ? (ready.drift
    ? ready.drift.project
      ? `Weekly scan (${new Date(ready.drift.at).toLocaleDateString()}): ${ready.drift.project.withContradictions} of ${ready.drift.project.checked} checked open epics had contradictions${ready.drift.hadPrevious === false ? '. This is the first scan, so there is nothing to compare with yet.' : `, ${ready.drift.project.newSincePrevious} new and ${ready.drift.project.resolvedSincePrevious ?? 0} resolved since the scan before.`}`
      : `Weekly scan (${new Date(ready.drift.at).toLocaleDateString()}): no open epics in this project were checked.`
    : 'No weekly scan result has reached this page yet. The scan runs once a week as the app, and its result is kept per product, so a Jira administrator can also run it here.') : '';
  const impactTab = ready ? (
    <Stack space="space.200">
      <Text>{weeklyLine}</Text>
      {ready.impact?.canEdit ? <ScanNow onDone={() => run()} /> : null}
      {ready.impact ? <ImpactCard impact={ready.impact} onSaved={() => run()} /> : null}
    </Stack>
  ) : null;

  return (
    <Box xcss={fullWidth}>
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" spread="space-between">
        <Text>Open epics and in-progress work items in this project, checked against the Confluence pages about them with your permissions. Read-only.</Text>
        <Inline space="space.100" alignBlock="center">
          {load.phase === 'loading' ? <Spinner size="small" /> : null}
          {ready && ready.remaining > 0 && load.phase !== 'loading'
            ? <Button appearance="primary" onClick={() => run(ready.rows)}>{`Check the rest (${ready.remaining} left)`}</Button> : null}
          <Button onClick={() => run()} isDisabled={load.phase === 'loading'}>{load.phase === 'loading' ? 'Checking, up to 20 seconds…' : 'Check again'}</Button>
        </Inline>
      </Inline>
      {load.phase === 'failed' ? <SectionMessage appearance="error" title="Could not load the overview"><Text>Something went wrong. Try Check again.</Text></SectionMessage> : null}
      {load.phase === 'done' && load.reply.status === 'error' ? <SectionMessage appearance="error" title="Could not load the overview"><Text>{load.reply.message}</Text></SectionMessage> : null}
      {ready ? (
        <Tabs id="overview-tabs">
          <TabList><Tab>Open work</Tab><Tab>What Same Page has done here</Tab></TabList>
          <TabPanel><Box xcss={padStyle}>{itemsTab}</Box></TabPanel>
          <TabPanel><Box xcss={padStyle}>{impactTab}</Box></TabPanel>
        </Tabs>
      ) : null}
    </Stack>
    </Box>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
