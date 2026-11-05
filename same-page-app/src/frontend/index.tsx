import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Code, Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { PanelFinding, PanelModel, Span } from '../core/panelModel';

// The resolvers answer with plain bodies; bridge types them as a wider union (body, void or body-with-metadata), so cast once here.
const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;

// Thin view over the model built by the resolver. Native UI Kit only; props checked against @forge/react 11.17 types.
const TONE: Record<string, 'removed' | 'moved' | 'default'> = { block: 'removed', warn: 'moved', info: 'default' };
const LABEL: Record<string, string> = { block: 'Blocker', warn: 'Warning', info: 'Note' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : 'an unknown date');

type TaskState = { status: 'creating' } | { status: 'done'; key: string } | { status: 'error'; message: string };
type Receipt = { seq: number; entryHash: string; prevHash: string };
type ActState = { status: 'working' } | { status: 'applied'; version: number; receipt?: Receipt } | { status: 'error'; message: string };
type SeedState = { status: 'idle' | 'working' } | { status: 'done'; epicKey: string; linked: boolean; linkNote?: string } | { status: 'error'; message: string };
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; model: PanelModel };
/** What the apply, triage and seed resolvers answer: ok, or a plain-words reason. */
type ActionReply = { ok?: boolean; reason?: string; version?: number; epicKey?: string; linked?: boolean; linkNote?: string; receipt?: Receipt };

// A line of doc text with the matched token drawn highlighted. Falls back to the plain line when there is no usable range.
const Highlighted = ({ line, span, appearance }: { line?: string; span?: Span; appearance: 'removed' | 'success' }) => {
  if (!line) return null;
  if (!span || span.start < 0 || span.end > line.length || span.start >= span.end) return <Code>{line}</Code>;
  const left = line.slice(0, span.start);
  const right = line.slice(span.end);
  return (
    <Inline space="space.0" alignBlock="center" shouldWrap>
      {left ? <Code>{left}</Code> : null}
      <Lozenge appearance={appearance} isBold>{line.slice(span.start, span.end)}</Lozenge>
      {right ? <Code>{right}</Code> : null}
    </Inline>
  );
};

// Where this finding is in its life: found by a rule, a fix proposed (when one is verified), then applied by a human.
// Snoozed and dismissed findings leave the list, and the count of hidden ones is shown above it.
const Lifecycle = ({ proposed, applied }: { proposed: boolean; applied: boolean }) => {
  const steps = proposed ? ['Detected', 'Fix proposed', 'Applied'] : ['Detected', 'Needs a human decision'];
  const current = applied ? steps.length : 1;
  return (
    <Inline space="space.050" alignBlock="center" shouldWrap>
      {steps.map((label, i) => (
        <Inline key={label} space="space.050" alignBlock="center">
          <Lozenge appearance={i < current ? 'success' : i === current ? 'inprogress' : 'default'}>{label}</Lozenge>
          {i < steps.length - 1 ? <Text>→</Text> : null}
        </Inline>
      ))}
      <Lozenge appearance="new">Found by rules · no AI</Lozenge>
    </Inline>
  );
};

type LedgerView = { status: 'verified' | 'broken'; length: number; head: string; reason?: string; counts?: { seen: number; applied: number; dismissed: number; snoozed: number; reviewTasks: number; gateBlocks: number }; recent: { seq: number; ruleId: string; issueKey: string | null; entryHash: string; prevHash: string }[] };

// The tamper-evident chain of applied fixes, read and re-verified on request. It proves the stored history was not edited or reordered;
// it cannot stop someone with storage access from rewriting the whole chain, and it says so.
const AuditTrail = () => {
  const [view, setView] = useState<{ phase: 'closed' } | { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; ledger: LedgerView }>({ phase: 'closed' });
  const open = () => {
    setView({ phase: 'loading' });
    invoke<LedgerView>('ledgerView').then((ledger) => setView({ phase: 'ready', ledger })).catch((e: Error) => setView({ phase: 'error', message: e?.message ?? 'Could not read the audit trail.' }));
  };
  if (view.phase === 'closed') return <Button onClick={open}>Audit trail</Button>;
  if (view.phase === 'loading') return <Inline space="space.100" alignBlock="center"><Spinner /><Text>Verifying the chain…</Text></Inline>;
  if (view.phase === 'error') return <SectionMessage appearance="error" title="Audit trail unavailable">{view.message}</SectionMessage>;
  const l = view.ledger;
  return (
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={l.status === 'verified' ? 'success' : 'removed'} isBold>{l.status === 'verified' ? 'Chain intact' : 'Chain broken'}</Lozenge>
        <Text>{l.length === 0 ? 'No fix has been applied yet.' : `${l.length} sealed ${l.length === 1 ? 'entry' : 'entries'} · head ${l.head}…`}</Text>
      </Inline>
      {l.reason ? <Text>{l.reason}</Text> : null}
      {l.counts ? <Text>{`Impact on this site so far: ${l.counts.seen} finding(s) shown · ${l.counts.applied} fix(es) applied · ${l.counts.dismissed} dismissed · ${l.counts.snoozed} snoozed · ${l.counts.reviewTasks} review task(s) · ${l.counts.gateBlocks} transition(s) blocked.`}</Text> : null}
      {l.recent.map((e) => <Code key={e.seq}>{`#${e.seq} ${e.ruleId} ${e.issueKey ?? ''}  ${e.prevHash}… → ${e.entryHash}…`}</Code>)}
      <Text>Each applied fix is hashed together with the one before it, so changing or deleting an old entry breaks every hash after it. This detects tampering; it cannot stop someone with access to the app's storage from rewriting the whole chain.</Text>
      <Button onClick={() => setView({ phase: 'closed' })}>Hide</Button>
    </Stack>
  );
};

interface FindingProps {
  f: PanelFinding;
  task?: TaskState;
  act?: ActState;
  onCreateTask: (f: PanelFinding) => void;
  onApply: (f: PanelFinding) => void;
  onSnooze: (f: PanelFinding) => void;
  onDismiss: (f: PanelFinding, reason: string) => void;
}

const Finding = ({ f, task, onCreateTask, act, onApply, onSnooze, onDismiss }: FindingProps) => {
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  return (
  <Stack space="space.100">
    <Lifecycle proposed={Boolean(f.suggestion?.after)} applied={act?.status === 'applied'} />
    <Inline space="space.100" alignBlock="center">
      <Lozenge appearance={TONE[f.severity] ?? 'default'}>{LABEL[f.severity] ?? 'Finding'}</Lozenge>
      <Text>{f.summary}</Text>
    </Inline>
    <Inline space="space.200" alignBlock="start" shouldWrap>
      <Stack space="space.050">
        <Heading size="xsmall">Page says</Heading>
        <Text>{`${f.pageTitle ?? 'A linked page'} · edited ${when(f.evidence.docModifiedAt)}`}</Text>
        {f.evidence.docLine ? <Highlighted line={f.evidence.docLine} span={f.evidence.docHighlight} appearance="removed" /> : <Text>This page carries a label or status, not a line of text.</Text>}
        {f.evidence.moreStale ? <Text>{`${f.evidence.moreStale} more line(s) on this page also name an old version.`}</Text> : null}
      </Stack>
      <Stack space="space.050">
        <Heading size="xsmall">{f.evidence.sourceLabel ?? 'Jira says'}</Heading>
        <Text>{`${f.evidence.ticket ?? ''}${f.evidence.ticketChangedAt ? ` · status changed ${when(f.evidence.ticketChangedAt)}${f.evidence.ticketChangedBy ? ` by ${f.evidence.ticketChangedBy}` : ''}` : ''}`}</Text>
      </Stack>
    </Inline>
    <Text>{`Why it matters: ${f.why}`}</Text>
    {f.foundBecause?.length ? <Text>{`Found because: ${f.foundBecause.join(', ')}`}</Text> : null}
    {f.suggestion?.after ? (
      <Stack space="space.050">
        <Text>{`Suggested edit (${f.suggestion.note})`}</Text>
        <Highlighted line={f.suggestion.before} span={f.suggestion.beforeHighlight} appearance="removed" />
        <Highlighted line={f.suggestion.after} span={f.suggestion.afterHighlight} appearance="success" />
      </Stack>
    ) : f.suggestion?.unavailable ? (
      <Text>{`No automatic edit: ${f.suggestion.unavailable}`}</Text>
    ) : null}
    {task?.status === 'done' ? (
      <SectionMessage appearance="success">{`Created review task ${task.key}.`}</SectionMessage>
    ) : task?.status === 'error' ? (
      <SectionMessage appearance="error" title="Could not create the task">{task.message}</SectionMessage>
    ) : (
      <Button appearance="primary" isDisabled={task?.status === 'creating'} onClick={() => onCreateTask(f)}>
        {task?.status === 'creating' ? 'Creating…' : 'Create review task'}
      </Button>
    )}
    {f.suggestion?.after ? (
      act?.status === 'applied' ? (
        <SectionMessage appearance="success">{`Applied as page version ${act.version}. Revert it from the page history if it is wrong.${act.receipt ? ` Sealed as audit entry #${act.receipt.seq} (${act.receipt.entryHash.slice(0, 12)}…).` : ''}${f.evidence.moreStale ? ` ${f.evidence.moreStale} more line(s) on this page still name an old version. The page now counts as edited, so Same Page will not flag them again. Review them.` : ''}`}</SectionMessage>
      ) : (
        <Button appearance="warning" isDisabled={act?.status === 'working'} onClick={() => onApply(f)}>
          {act?.status === 'working' ? 'Applying…' : 'Apply this edit to the page'}
        </Button>
      )
    ) : null}
    {act?.status === 'error' ? <SectionMessage appearance="error" title="Not done">{act.message}</SectionMessage> : null}
    <Inline space="space.100" alignBlock="center">
      <Button onClick={() => onSnooze(f)} isDisabled={act?.status === 'working'}>Snooze 7 days</Button>
      <Button onClick={() => setAsking(!asking)} isDisabled={act?.status === 'working'}>Dismiss…</Button>
    </Inline>
    {asking ? (
      <Stack space="space.050">
        <Textfield placeholder="Why is this not a problem? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button appearance="danger" isDisabled={!reason.trim()} onClick={() => onDismiss(f, reason)}>Dismiss with this reason</Button>
      </Stack>
    ) : null}
  </Stack>
  );
};

const App = () => {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [acts, setActs] = useState<Record<string, ActState>>({});
  const [seed, setSeed] = useState<SeedState>({ status: 'idle' });
  const [target, setTarget] = useState('');
  const [targetState, setTargetState] = useState<{ status: 'idle' | 'working' } | { status: 'error'; message: string }>({ status: 'idle' });

  const load = () => {
    setState({ phase: 'loading' });
    invoke<PanelModel>('getPanel')
      .then((model) => setState({ phase: 'ready', model }))
      .catch((e: Error) => setState({ phase: 'error', message: e?.message ?? 'Could not load.' }));
  };
  useEffect(load, []);

  const createTask = async (f: PanelFinding) => {
    setTasks((t) => ({ ...t, [f.id]: { status: 'creating' } }));
    try {
      const r = await invoke<{ key: string }>('createReviewTask', { findingId: f.id });
      setTasks((t) => ({ ...t, [f.id]: { status: 'done', key: r.key } }));
    } catch (e) {
      setTasks((t) => ({ ...t, [f.id]: { status: 'error', message: (e as Error)?.message ?? 'Unknown error.' } }));
    }
  };

  // Apply, snooze and dismiss all go through the resolver, which rebuilds the finding itself; the client sends only an id.
  const run = async (f: PanelFinding, name: string, payload: Record<string, unknown>, onOk: (r: ActionReply) => void) => {
    setActs((a) => ({ ...a, [f.id]: { status: 'working' } }));
    try {
      const r = await invoke<ActionReply>(name, { findingId: f.id, ...payload });
      if (r?.ok === false) { setActs((a) => ({ ...a, [f.id]: { status: 'error', message: r.reason ?? 'Not done.' } })); return; }
      onOk(r);
    } catch (e) {
      setActs((a) => ({ ...a, [f.id]: { status: 'error', message: (e as Error)?.message ?? 'Unknown error.' } }));
    }
  };
  const apply = (f: PanelFinding) => run(f, 'applyFix', { expectedAfter: f.suggestion?.after }, (r) => setActs((a) => ({ ...a, [f.id]: { status: 'applied', version: r.version ?? 0, receipt: r.receipt } })));
  const snooze = (f: PanelFinding) => run(f, 'triage', { kind: 'snooze' }, load);
  const dismissIt = (f: PanelFinding, reason: string) => run(f, 'triage', { kind: 'dismiss', reason }, load);

  const saveTarget = async () => {
    setTargetState({ status: 'working' });
    try {
      const r = await invoke<ActionReply>('setTargetVersion', { version: target });
      if (r?.ok === false) { setTargetState({ status: 'error', message: r.reason ?? 'Not saved.' }); return; }
      setTargetState({ status: 'idle' });
      setTarget('');
      load();
    } catch (e) { setTargetState({ status: 'error', message: (e as Error)?.message ?? 'Unknown error.' }); }
  };

  const makeDemo = async () => {
    setSeed({ status: 'working' });
    try {
      const r = await invoke<ActionReply>('seedDemo');
      setSeed(r.ok ? { status: 'done', epicKey: r.epicKey ?? '', linked: r.linked === true, linkNote: r.linkNote } : { status: 'error', message: r.reason ?? 'Not created.' });
    } catch (e) { setSeed({ status: 'error', message: (e as Error)?.message ?? 'Unknown error.' }); }
  };

  if (state.phase === 'loading') return (<Inline space="space.100" alignBlock="center"><Spinner /><Text>Checking this issue against its docs…</Text></Inline>);
  if (state.phase === 'error') return (<SectionMessage appearance="error" title="Same Page could not load">{state.message}</SectionMessage>);

  const m = state.model;
  if (m.status === 'error') return (<Stack space="space.100"><SectionMessage appearance="error" title="Same Page could not finish">{m.message}</SectionMessage><Button onClick={load}>Try again</Button></Stack>);
  if (m.status === 'unchecked') return (
    <Stack space="space.100">
      <SectionMessage appearance="information" title="Nothing to check yet">
        <Text>{`Not checked: ${m.reason}.`}</Text>
        <Text>{/status transition/i.test(m.reason)
          ? 'Move this work item to a new status, for example In Progress. Same Page compares each page\'s last edit with that move, so pages edited before it are the ones that may be stale.'
          : /related Confluence page/i.test(m.reason)
            ? 'Link the runbook or decision page to this work item (a web link to the Confluence page), or put the work item key in the page title.'
            : 'Tell Same Page which API version this work item targets, and link the runbook to it. You can also put the version in the summary (for example "Migrate to v2") or a component.'}</Text>
      </SectionMessage>
      {/target version/i.test(m.reason) ? (
        <Stack space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Textfield placeholder="Target API version, for example v2" value={target} onChange={(e) => setTarget(e.target.value)} />
            <Button appearance="primary" isDisabled={!target.trim() || targetState.status === 'working'} onClick={saveTarget}>{targetState.status === 'working' ? 'Saving…' : 'Save target version'}</Button>
          </Inline>
          {targetState.status === 'error' ? <SectionMessage appearance="error" title="Not saved">{targetState.message}</SectionMessage> : null}
        </Stack>
      ) : null}
      {seed.status === 'done' && seed.linked
        ? <SectionMessage appearance="success" title="Demo data created">{`Open ${seed.epicKey} to see Same Page find a real contradiction.`}</SectionMessage>
        : (
          <>
            {seed.status === 'done' ? <SectionMessage appearance="warning" title="Demo data created, but the page link failed">{`${seed.linkNote ?? 'The pages were not linked to the epic.'} Click Create demo data again to retry the link.`}</SectionMessage> : null}
            {seed.status === 'error' ? <SectionMessage appearance="error" title="Demo data not created">{seed.message}</SectionMessage> : null}
            <Button onClick={makeDemo} isDisabled={seed.status === 'working'}>{seed.status === 'working' ? 'Creating…' : 'Create demo data'}</Button>
          </>
        )}
    </Stack>
  );
  if (m.status === 'clean') return (
    <Stack space="space.100">
      <SectionMessage appearance="success" title="Same page">{`Checked ${m.pagesChecked} related page(s). No contradictions found.${m.hidden ? ` ${m.hidden} finding(s) hidden by snooze or dismissal.` : ''}`}</SectionMessage>
      <AuditTrail />
    </Stack>
  );

  return (
    <Stack space="space.200">
      <Heading size="small">{m.status === 'findings' ? `${m.findings.length} contradiction(s) found` : 'Possible history, worth a look'}</Heading>
      {m.hidden ? <Text>{`${m.hidden} more finding(s) hidden by snooze or dismissal.`}</Text> : null}
      {[...(m.findings ?? []), ...(m.notes ?? [])].map((f) => (<Finding key={f.id} f={f} task={tasks[f.id]} onCreateTask={createTask} act={acts[f.id]} onApply={apply} onSnooze={snooze} onDismiss={dismissIt} />))}
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Button onClick={load}>Check again</Button>
      </Inline>
      <AuditTrail />
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
