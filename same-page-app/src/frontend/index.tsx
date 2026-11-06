import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, Code, DynamicTable, Heading, Icon, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Strike, Tab, TabList, TabPanel, Tabs, Tag, Text, TextArea, Textfield, xcss } from '@forge/react';
import { invoke as bridgeInvoke } from '@forge/bridge';
import type { PanelFinding, PanelModel, Span } from '../core/panelModel';

// The resolvers answer with plain bodies; bridge types them as a wider union (body, void or body-with-metadata), so cast once here.
const invoke = <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => bridgeInvoke(name, payload) as unknown as Promise<T>;

// Thin view over the model built by the resolver. Native UI Kit only; props checked against @forge/react 11.17 types.
const TONE: Record<string, 'removed' | 'moved' | 'default'> = { block: 'removed', warn: 'moved', info: 'default' };
const LABEL: Record<string, string> = { block: 'Blocker', warn: 'Warning', info: 'Note' };
const ruleShort = (id: string) => { const m = /^R(\d+)_/.exec(id); const names: Record<string, string> = { '8': 'Duration differs', '9': 'Limit or port differs', '10': 'Date differs', '1': 'Stale version', '2': 'Deprecated decision', '3': 'Missing field', '4': 'Stale status claim', '5': 'API spec mismatch', '6': 'Closed ticket cited as open', '7': 'Pages disagree' }; return m ? `R${m[1]} ${names[m[1]!] ?? ''}`.trim() : /^C\d+_CUSTOM$/.test(id) ? 'Custom rule' : 'Rule'; };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : 'an unknown date');

// Card and panel styling. Atlassian design tokens only, so light and dark themes both work.
const cardStyle = xcss({ borderColor: 'color.border', borderStyle: 'solid', borderWidth: 'border.width', borderRadius: 'radius.large', padding: 'space.200', backgroundColor: 'elevation.surface.raised' });
const evidenceStyle = xcss({ borderRadius: 'radius.medium', padding: 'space.150', backgroundColor: 'color.background.neutral' });
const tabPad = xcss({ paddingBlockStart: 'space.200' });

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

// The change Apply would make (or has made): the old line on top, the new line below, with the changed token highlighted.
// Once applied, the old line is struck through so the before and after read as one edit.
const BeforeAfter = ({ s, done }: { s: NonNullable<PanelFinding['suggestion']>; done: boolean }) => (
  <Stack space="space.050">
    <Heading size="xsmall">{done ? 'What changed on the page' : 'Proposed change (nothing is edited until you click Apply)'}</Heading>
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Lozenge appearance="removed">{done ? 'Was' : 'Now'}</Lozenge>
      {done ? <Strike>{s.before ?? ''}</Strike> : <Highlighted line={s.before} span={s.beforeHighlight} appearance="removed" />}
    </Inline>
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Lozenge appearance="success">{done ? 'Is now' : 'After Apply'}</Lozenge>
      <Highlighted line={s.after} span={s.afterHighlight} appearance="success" />
    </Inline>
    <Text>{`Only this line changes, and only its version reference. ${s.note ?? ''}`}</Text>
  </Stack>
);

type RuleRow = { ruleId: string; short: string; name: string; checks: string; pain: string; severity: 'block' | 'warn'; changed: boolean; dismissed?: number; acted?: number; markedReal?: number; markedFalse?: number; hint?: string | null };
type CustomDef = { id: string; name: string; template: string; phrase: string; value: string; severity: 'block' | 'warn' };
type TemplateInfo = { id: string; label: string; sentence: string };
type CanonDef = { id: string; subject: string; value: string };
type CanonResult = { id: string; subject: string; value: string; pagesRead: number; agreeing: number; pages: { pageId: string; title: string; found: { line: number; snippet: string; pageValue: string }[] }[]; note?: string };
type RulesReply = { canEdit: boolean; gateMode?: 'enforce' | 'watch'; canon?: CanonDef[]; rules: RuleRow[]; custom?: CustomDef[]; templates?: TemplateInfo[] };

// Facts everyone should agree on: declare a value once, then check every page on the site against it. Needs no Jira link.
const CanonFacts = ({ facts, onChanged }: { facts: CanonDef[]; onChanged: () => void }) => {
  const [subject, setSubject] = useState('');
  const [value, setValue] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<{ list: CanonResult[]; stoppedEarly: boolean } | null>(null);
  const call = async <T,>(fn: string, payload?: Record<string, unknown>): Promise<T & ActionReply> => {
    setBusy(true); setMsg(null);
    try { return await invoke<T & ActionReply>(fn, payload); } catch { return { ok: false, reason: 'Something went wrong. Try again.' } as T & ActionReply; } finally { setBusy(false); }
  };
  const add = async () => { const r = await call<object>('saveCanonFact', { subject, value }); if (r.ok === false) setMsg(r.reason ?? 'Not saved.'); else { setSubject(''); setValue(''); setFormKey((k) => k + 1); onChanged(); } };
  const remove = async (id: string) => { const r = await call<object>('deleteCanonFact', { id }); if (r.ok === false) setMsg(r.reason ?? 'Not deleted.'); else { setResults(null); onChanged(); } };
  const check = async () => {
    const r = await call<{ results?: CanonResult[]; stoppedEarly?: boolean }>('checkCanon');
    if (r.ok === false) setMsg(r.reason ?? 'The check did not run.'); else setResults({ list: r.results ?? [], stoppedEarly: Boolean(r.stoppedEarly) });
  };
  return (
    <Stack space="space.100">
      <Heading size="xsmall">Facts everyone should agree on</Heading>
      <Text>Declare a value once, for example "access token expiry" is "1 hour". Same Page then searches every Confluence page you can read for pages that state it differently, with no Jira link needed. It reports; it never edits.</Text>
      {facts.length ? facts.map((f) => (
        <Inline key={f.id} space="space.100" alignBlock="center" shouldWrap>
          <Text>{`${f.subject} = ${f.value}`}</Text>
          <Button isDisabled={busy} onClick={() => remove(f.id)}>Delete this fact</Button>
        </Inline>
      )) : <Text>No facts declared yet.</Text>}
      <Text>What the fact is about (at least two words)</Text>
      <Textfield key={`s${formKey}`} placeholder="For example: access token expiry" onChange={(e) => setSubject(e.target.value)} />
      <Text>The value everyone should state</Text>
      <Textfield key={`v${formKey}`} placeholder="For example: 1 hour, or 100 requests per minute, or port 8080" onChange={(e) => setValue(e.target.value)} />
      <Inline space="space.100" shouldWrap>
        <Button appearance="primary" isDisabled={busy} onClick={add}>Add this fact</Button>
        {facts.length ? <Button isDisabled={busy} onClick={check}>{busy ? 'Checking the site…' : 'Check the whole site now'}</Button> : null}
      </Inline>
      {msg ? <Text>{msg}</Text> : null}
      {results ? (
        <Stack space="space.100">
          {results.list.map((r) => (
            <Stack key={r.id} space="space.050">
              <Text>{`${r.subject} = ${r.value}: read ${r.pagesRead} page${r.pagesRead === 1 ? '' : 's'}, ${r.pages.length} disagree${r.pages.length === 1 ? 's' : ''}, ${r.agreeing} line${r.agreeing === 1 ? '' : 's'} agree.`}</Text>
              {r.pages.map((p) => (
                <Stack key={p.pageId} space="space.025">
                  <Link href={`/wiki/pages/viewpage.action?pageId=${p.pageId}`}>{p.title || `Page ${p.pageId}`}</Link>
                  {p.found.map((d) => <Text key={`${p.pageId}${d.line}`}>{`Line ${d.line} says ${d.pageValue}: ${d.snippet}`}</Text>)}
                </Stack>
              ))}
            </Stack>
          ))}
          <Text>{results.stoppedEarly ? 'The check stopped early because of its time limit; run it again.' : 'Only the first 8 pages Confluence returns for each fact are read, so a clean result means those pages agree, not that every page on the site does.'}</Text>
        </Stack>
      ) : null}
    </Stack>
  );
};

// Gate mode and the pilot report: admin tools for trying the gate safely and for reporting what a pilot found.
const AdminTools = ({ mode, onChanged }: { mode: 'enforce' | 'watch'; onChanged: () => void }) => {
  const [report, setReport] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const setMode = async (m: 'enforce' | 'watch') => {
    try { const r = await invoke<ActionReply>('setGateMode', { mode: m }); if (r?.ok === false) setMsg(r.reason ?? 'Not changed.'); else { setMsg(null); onChanged(); } } catch { setMsg('Not changed. Try again.'); }
  };
  const makeReport = async () => {
    try { const r = await invoke<{ ok?: boolean; text?: string; reason?: string }>('pilotReport'); if (r?.ok) { setReport(r.text ?? ''); setMsg(null); } else setMsg(r?.reason ?? 'No report.'); } catch { setMsg('No report. Try again.'); }
  };
  return (
    <Stack space="space.100">
      <Heading size="xsmall">Gate mode</Heading>
      <Text>{mode === 'watch' ? 'Watch only: the gate allows every transition and only counts the ones it would have refused. Switch to Enforce when you trust it.' : 'Enforcing: the gate refuses a transition while a blocking contradiction is open (if the validator is attached to a workflow).'}</Text>
      <Inline space="space.100" shouldWrap>
        <Button appearance={mode === 'enforce' ? 'primary' : 'default'} onClick={() => setMode('enforce')}>Enforce</Button>
        <Button appearance={mode === 'watch' ? 'primary' : 'default'} onClick={() => setMode('watch')}>Watch only</Button>
      </Inline>
      <Heading size="xsmall">Pilot report</Heading>
      <Text>A plain-text summary of what Same Page found on this site and what your team marked. Counts only, no page text or names. Copy it into a message.</Text>
      <Button onClick={makeReport}>Show the pilot report</Button>
      {report !== null ? <Code>{report}</Code> : null}
      {msg ? <Text>{msg}</Text> : null}
    </Stack>
  );
};

// Team-defined rules: pick one of three templates, type a phrase and a value, preview what it would find on this work item, then save.
// Nothing is saved by a preview. Only a Jira administrator sees the form; everyone can see the saved rules.
// Copy a site's team rules as text and paste them into another site. Each imported rule is checked like a typed one.
const ShareRules = ({ custom, onImported }: { custom: CustomDef[]; onImported: () => void }) => {
  const [exported, setExported] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const doExport = async () => {
    try { const r = await invoke<{ ok?: boolean; text?: string; reason?: string }>('exportCustomRules'); if (r?.ok) { setExported(r.text ?? ''); setMsg(null); } else setMsg(r?.reason ?? 'Not exported.'); }
    catch { setMsg('Not exported. Try again.'); }
  };
  const doImport = async () => {
    try {
      const r = await invoke<{ ok?: boolean; added?: number; skipped?: number; reasons?: string[]; reason?: string }>('importCustomRules', { text });
      if (r?.ok) { setMsg(`Added ${r.added ?? 0} rule${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}${r.reasons?.length ? ` (${r.reasons.join(' ')})` : ''}` : ''}.`); onImported(); }
      else setMsg(r?.reason ?? 'Not imported.');
    } catch { setMsg('Not imported. Try again.'); }
  };
  return (
    <Stack space="space.100">
      <Heading size="xsmall">Share rules between sites</Heading>
      <Inline space="space.100" shouldWrap>
        {custom.length ? <Button onClick={doExport}>Show my rules as text to copy</Button> : null}
      </Inline>
      {exported !== null ? <Code>{exported}</Code> : null}
      <Text>To bring rules from another site, paste the text here.</Text>
      <TextArea placeholder="Paste exported rule text" onChange={(e) => setText(e.target.value)} />
      <Button onClick={doImport}>Import these rules</Button>
      {msg ? <Text>{msg}</Text> : null}
    </Stack>
  );
};

const CustomRules = ({ data, onChanged }: { data: RulesReply; onChanged: () => void }) => {
  const templates = data.templates ?? [];
  const [template, setTemplate] = useState(templates[0]?.id ?? 'phrase-while-status');
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [value, setValue] = useState('');
  const [severity, setSeverity] = useState<'block' | 'warn'>('warn');
  const [msg, setMsg] = useState<{ appearance: 'success' | 'error' | 'information'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);        // changing it clears the fields: they are uncontrolled so fast typing is never overwritten
  const body = { name, template, phrase, value, severity };
  const current = templates.find((t) => t.id === template);
  type CallReply = ActionReply & { count?: number; pagesChecked?: number; note?: string };
  const call = async (fn: string, payload: Record<string, unknown>): Promise<CallReply> => {
    setBusy(true); setMsg(null);
    try { return await invoke<CallReply>(fn, payload); }
    catch { return { ok: false, reason: 'Something went wrong. Try again.' }; }
    finally { setBusy(false); }
  };
  const preview = async () => {
    const r = await call('previewCustomRule', body);
    if (r.ok === false) { setMsg({ appearance: 'error', text: r.reason ?? 'Not previewed.' }); return; }
    setMsg({ appearance: 'information', text: r.note ?? `On this work item, this rule would raise ${r.count ?? 0} finding${r.count === 1 ? '' : 's'} (${r.pagesChecked ?? 0} linked page${r.pagesChecked === 1 ? '' : 's'} read). Nothing was saved.` });
  };
  const save = async () => {
    const r = await call('saveCustomRule', body);
    if (r.ok === false) { setMsg({ appearance: 'error', text: r.reason ?? 'Not saved.' }); return; }
    setName(''); setPhrase(''); setValue(''); setFormKey((k) => k + 1); onChanged();
  };
  const remove = async (id: string) => { const r = await call('deleteCustomRule', { id }); if (r.ok === false) setMsg({ appearance: 'error', text: r.reason ?? 'Not deleted.' }); else onChanged(); };
  const custom = data.custom ?? [];
  if (!data.canEdit && !custom.length) return null;
  return (
    <Stack space="space.100">
      <Heading size="xsmall">Your team's rules</Heading>
      {custom.length ? custom.map((c) => (
        <Inline key={c.id} space="space.100" alignBlock="center" shouldWrap>
          <Lozenge appearance={c.severity === 'block' ? 'removed' : 'moved'} isBold>{c.severity === 'block' ? 'Blocker' : 'Warning'}</Lozenge>
          <Text>{`${c.name}: ${templates.find((t) => t.id === c.template)?.label ?? c.template} (phrase "${c.phrase}", value "${c.value}")`}</Text>
          {data.canEdit ? <Button isDisabled={busy} onClick={() => remove(c.id)}>Delete this rule</Button> : null}
        </Inline>
      )) : <Text>No team rules yet.</Text>}
      {data.canEdit ? <ShareRules custom={custom} onImported={onChanged} /> : null}
      {data.canEdit ? (
        <Stack space="space.100">
          <Text>Add a rule. Phrases are matched as plain text, ignoring case, and lines worded as history (previously, deprecated…) are skipped. A site can have up to 10.</Text>
          <Inline space="space.100" shouldWrap>
            {templates.map((t) => <Button key={t.id} appearance={t.id === template ? 'primary' : 'default'} onClick={() => setTemplate(t.id)}>{t.label}</Button>)}
          </Inline>
          {current ? <Text>{current.sentence}</Text> : null}
          <Text>Rule name</Text>
          <Textfield key={`n${formKey}`} placeholder="Rule name, for example Ready too early" onChange={(e) => setName(e.target.value)} />
          <Text>Phrase on the page (at least 3 characters)</Text>
          <Textfield key={`p${formKey}`} placeholder="Phrase, for example ready for production" onChange={(e) => setPhrase(e.target.value)} />
          <Text>{template === 'phrase-while-status' ? 'Work item status (put ! before it to mean "is not")' : 'Work item label or component'}</Text>
          <Textfield key={`v${formKey}`} placeholder={template === 'phrase-while-status' ? 'Status, for example !Done' : 'Label or component, for example payments'} onChange={(e) => setValue(e.target.value)} />
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Button onClick={() => setSeverity(severity === 'warn' ? 'block' : 'warn')}>{severity === 'warn' ? 'Severity: Warning (click for Blocker)' : 'Severity: Blocker (click for Warning)'}</Button>
            <Button isDisabled={busy} onClick={preview}>Preview on this work item</Button>
            <Button appearance="primary" isDisabled={busy} onClick={save}>Save this rule</Button>
          </Inline>
        </Stack>
      ) : null}
      {msg ? <SectionMessage appearance={msg.appearance}><Text>{msg.text}</Text></SectionMessage> : null}
    </Stack>
  );
};

// The rule set, visible even when nothing is found. A Jira administrator can move a rule between Blocker and Warning;
// that decides which findings may stop a transition. Rules cannot be switched off and findings are never hidden by this.
const RulesList = ({ autoOpen }: { autoOpen?: boolean }) => {
  const [view, setView] = useState<{ phase: 'closed' } | { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; data: RulesReply; note?: string }>({ phase: 'closed' });
  const open = () => {
    setView({ phase: 'loading' });
    invoke<RulesReply>('getRules').then((data) => setView({ phase: 'ready', data })).catch(() => setView({ phase: 'error' }));
  };
  const change = async (r: RuleRow, severity: 'block' | 'warn') => {
    try {
      const out = await invoke<ActionReply>('setRuleSeverity', { ruleId: r.ruleId, severity });
      if (out?.ok === false) { setView((v) => (v.phase === 'ready' ? { ...v, note: out.reason ?? 'Not changed.' } : v)); return; }
      open();
    } catch { setView((v) => (v.phase === 'ready' ? { ...v, note: 'Not changed. Try again.' } : v)); }
  };
  useEffect(() => { if (autoOpen) open(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (view.phase === 'closed') return <Button onClick={open}>Show the ten rules</Button>;
  if (view.phase === 'loading') return <Inline space="space.100" alignBlock="center"><Spinner size="small" /><Text>Loading the rules…</Text></Inline>;
  if (view.phase === 'error') return <SectionMessage appearance="error" title="Could not load the rules"><Text>Nothing was changed. Try again in a moment.</Text></SectionMessage>;
  const { data } = view;
  return (
    <Stack space="space.100">
      <Heading size="xsmall">The ten rules</Heading>
      <Text>{data.canEdit ? 'Blockers can stop a Jira transition when the validator is attached. You are a Jira administrator, so you can move a rule between Blocker and Warning.' : 'Blockers can stop a Jira transition when the validator is attached. Only a Jira administrator can change a severity.'}</Text>
      {data.rules.map((r) => (
        <Stack key={r.ruleId} space="space.050">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Lozenge appearance={r.severity === 'block' ? 'removed' : 'moved'} isBold>{r.severity === 'block' ? 'Blocker' : 'Warning'}</Lozenge>
            <Text>{`${r.short} ${r.name}${r.changed ? ' (changed on this site)' : ''}`}</Text>
            {data.canEdit ? <Button onClick={() => change(r, r.severity === 'block' ? 'warn' : 'block')}>{r.severity === 'block' ? 'Make it a warning' : 'Make it a blocker'}</Button> : null}
          </Inline>
          <Text>{`${r.checks} ${r.pain}`}</Text>
          {(r.markedReal ?? 0) + (r.markedFalse ?? 0) > 0 ? <Text>{`Marked by your team: ${r.markedReal ?? 0} real, ${r.markedFalse ?? 0} false alarm.`}</Text> : null}
          {r.hint ? <Text>{`Suggestion: ${r.hint}`}</Text> : null}
          {(r.dismissed ?? 0) + (r.acted ?? 0) > 0 ? <Text>{`On this site: acted on ${r.acted ?? 0}, dismissed ${r.dismissed ?? 0} (${Math.round((100 * (r.dismissed ?? 0)) / ((r.dismissed ?? 0) + (r.acted ?? 0)))}% dismissed).`}</Text> : null}
        </Stack>
      ))}
      {data.canEdit ? <CanonFacts facts={data.canon ?? []} onChanged={open} /> : null}
      {data.canEdit ? <AdminTools mode={data.gateMode ?? 'enforce'} onChanged={open} /> : null}
      <CustomRules data={data} onChanged={open} />
      {view.note ? <SectionMessage appearance="warning"><Text>{view.note}</Text></SectionMessage> : null}
      <Button onClick={() => setView({ phase: 'closed' })}>Hide the rules</Button>
    </Stack>
  );
};

// A version can be set from here when R1 could not run. Optional: the number, limit and date rules (R8 to R10) need no version.
const TargetForm = ({ onSaved }: { onSaved: () => void }) => {
  const [v, setV] = useState('');
  const [st, setSt] = useState<{ status: 'idle' | 'working' } | { status: 'error'; message: string }>({ status: 'idle' });
  const save = async () => {
    setSt({ status: 'working' });
    try {
      const r = await invoke<ActionReply>('setTargetVersion', { version: v });
      if (r?.ok === false) { setSt({ status: 'error', message: r.reason ?? 'Not saved.' }); return; }
      onSaved();
    } catch (e) { setSt({ status: 'error', message: (e as Error)?.message ?? 'Unknown error.' }); }
  };
  return (
    <Stack space="space.050">
      <Text>Target API version (optional, lets rule R1 run)</Text>
      <Inline space="space.100" alignBlock="center">
        <Textfield placeholder="Target API version, for example v2" onChange={(e) => setV(e.target.value)} />
        <Button isDisabled={!v.trim() || st.status === 'working'} onClick={save}>{st.status === 'working' ? 'Saving…' : 'Save target version'}</Button>
      </Inline>
      {st.status === 'error' ? <SectionMessage appearance="error" title="Not saved">{st.message}</SectionMessage> : null}
    </Stack>
  );
};

// Link a Confluence page to this work item so it is checked from now on. The address must be on this site.
const LinkPage = ({ onLinked }: { onLinked: () => void }) => {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true); setMsg(null);
    try { const r = await invoke<ActionReply & { title?: string }>('linkPage', { url }); if (r?.ok === false) setMsg(r.reason ?? 'Not linked.'); else onLinked(); }
    catch { setMsg('Not linked. Try again.'); }
    setBusy(false);
  };
  return (
    <Stack space="space.050">
      <Text>Link a Confluence page to this work item (paste its address)</Text>
      <Inline space="space.100" alignBlock="center">
        <Textfield placeholder="Address of a page on this site" onChange={(e) => setUrl(e.target.value)} />
        <Button isDisabled={busy} onClick={link}>{busy ? 'Linking…' : 'Link this page'}</Button>
      </Inline>
      {msg ? <Text>{msg}</Text> : null}
    </Stack>
  );
};

// The trust layer: what was read and which rules ran, always shown, in the same place whether or not anything was found.
// Rules that could not run on this work item are named, so a result is never read as a full check when it was not.
const Checked = ({ titles, count, found, skipped, onSaved }: { titles?: string[]; count: number; found: number; skipped?: string[]; onSaved?: () => void }) => (
  <Stack space="space.100">
    <Heading size="xsmall">What Same Page checked</Heading>
    <Text>{`Read ${count} linked page${count === 1 ? '' : 's'}${titles?.length ? ` (${titles.join(', ')})` : ''}, ran ${10 - (skipped?.length ? (skipped[0]!.includes('R4') ? 2 : 1) : 0)} of 10 rules, found ${found} contradiction${found === 1 ? '' : 's'}.`}</Text>
    {skipped?.length ? <Text>{`Did not run: ${skipped.join('; ')}.`}</Text> : null}
    {skipped?.some((x) => /target version/.test(x)) && onSaved ? <TargetForm onSaved={onSaved} /> : null}
    <Text>Rules only, no AI in detection, so every finding can be explained and repeated.</Text>
    {onSaved ? <LinkPage onLinked={onSaved} /> : null}
  </Stack>
);

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
    </Inline>
  );
};

type LedgerView = { status: 'verified' | 'broken'; length: number; head: string; reason?: string; counts?: { seen: number; applied: number; dismissed: number; snoozed: number; reviewTasks: number; gateBlocks: number }; recent: { seq: number; ruleId: string; issueKey: string | null; entryHash: string; prevHash: string }[] };

// The tamper-evident chain of applied fixes, read and re-verified on request. It proves the stored history was not edited or reordered;
// it cannot stop someone with storage access from rewriting the whole chain, and it says so.
const AuditTrail = ({ autoOpen }: { autoOpen?: boolean }) => {
  const [view, setView] = useState<{ phase: 'closed' } | { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; ledger: LedgerView }>({ phase: 'closed' });
  const open = () => {
    setView({ phase: 'loading' });
    invoke<LedgerView>('ledgerView').then((ledger) => setView({ phase: 'ready', ledger })).catch((e: Error) => setView({ phase: 'error', message: e?.message ?? 'Could not read the audit trail.' }));
  };
  useEffect(() => { if (autoOpen) open(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (view.phase === 'closed') return <Button onClick={open}>Show the audit trail</Button>;
  if (view.phase === 'loading') return <Inline space="space.100" alignBlock="center"><Spinner /><Text>Verifying the chain…</Text></Inline>;
  if (view.phase === 'error') return <SectionMessage appearance="error" title="Audit trail unavailable">{view.message}</SectionMessage>;
  const l = view.ledger;
  const EVENT: Record<string, string> = { APPLIED: 'Fix applied', DISCOVERED: 'First found', DISMISSED: 'Dismissed', SNOOZED: 'Snoozed', REVIEW_TASK: 'Review task created' };
  const rows = l.recent.map((e) => {
    const [r, kind] = e.ruleId.split(':');
    return { key: String(e.seq), cells: [
      { key: 'n', content: `#${e.seq}` },
      { key: 'what', content: EVENT[kind ?? ''] ?? 'Recorded' },
      { key: 'rule', content: ruleShort(r ?? '') },
      { key: 'item', content: e.issueKey ?? '' },
      { key: 'hash', content: <Code>{`${e.entryHash}…`}</Code> },
    ] };
  });
  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Icon glyph={l.status === 'verified' ? 'check-circle' : 'error'} label={l.status === 'verified' ? 'Intact' : 'Broken'} size="medium" />
        <Lozenge appearance={l.status === 'verified' ? 'success' : 'removed'} isBold>{l.status === 'verified' ? 'Chain intact' : 'Chain broken'}</Lozenge>
        <Text>{l.length === 0 ? 'Nothing has been sealed yet.' : `${l.length} sealed ${l.length === 1 ? 'entry' : 'entries'}`}</Text>
      </Inline>
      {l.reason ? <Text>{l.reason}</Text> : null}
      {l.counts ? (
        <Inline space="space.100" shouldWrap>
          <Tag text={`${l.counts.seen} found`} />
          <Tag text={`${l.counts.applied} fixed`} />
          <Tag text={`${l.counts.reviewTasks} sent to owners`} />
          <Tag text={`${l.counts.dismissed} dismissed`} />
          <Tag text={`${l.counts.snoozed} snoozed`} />
          <Tag text={`${l.counts.gateBlocks} transitions refused`} />
        </Inline>
      ) : null}
      {rows.length ? (
        <DynamicTable caption="Latest sealed events, oldest first" head={{ cells: [{ key: 'n', content: 'Entry' }, { key: 'what', content: 'What happened' }, { key: 'rule', content: 'Rule' }, { key: 'item', content: 'Work item' }, { key: 'hash', content: 'Seal' }] }} rows={rows} />
      ) : <Text>No events yet. When a finding is shown, dismissed, snoozed or fixed, it appears here.</Text>}
      <Text>Each entry is hashed together with the one before it, so editing or deleting an old one breaks every seal after it. This detects tampering; it cannot stop someone with access to the app's storage from rewriting the whole chain.</Text>
    </Stack>
  );
};

interface FindingProps {
  review?: 'real' | 'false';
  onReview: (f: PanelFinding, verdict: 'real' | 'false') => void;
  f: PanelFinding;
  first?: boolean;
  task?: TaskState;
  act?: ActState;
  onCreateTask: (f: PanelFinding) => void;
  onApply: (f: PanelFinding) => void;
  onSnooze: (f: PanelFinding) => void;
  onDismiss: (f: PanelFinding, reason: string) => void;
}

const Finding = ({ f, first, task, onCreateTask, act, onApply, onSnooze, onDismiss, review, onReview }: FindingProps) => {
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const applied = act?.status === 'applied';
  const hasFix = Boolean(f.suggestion?.after);
  const busy = act?.status === 'working';
  return (
  <Box xcss={cardStyle}>
  <Stack space="space.150">
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Icon glyph={f.severity === 'block' ? 'error' : f.severity === 'warn' ? 'warning' : 'info'} label={LABEL[f.severity] ?? 'Finding'} size="medium" />
      <Lozenge appearance={TONE[f.severity] ?? 'default'} isBold>{LABEL[f.severity] ?? 'Finding'}</Lozenge>
      <Tag text={ruleShort(f.ruleId)} />
      {first ? <Lozenge appearance="new" isBold>Start here</Lozenge> : null}
    </Inline>
    <Heading size="small">{f.summary}</Heading>
    {applied ? (
      <SectionMessage appearance="success" title="Fixed">{`Applied as page version ${act.version}. Revert it from the page history if it is wrong.${act.receipt ? ` Sealed as audit entry #${act.receipt.seq} (${act.receipt.entryHash.slice(0, 12)}…).` : ''}${f.evidence.moreStale ? ` ${f.evidence.moreStale} more line(s) on this page still name an old version. The page now counts as edited, so Same Page will not flag them again. Review them.` : ''}`}</SectionMessage>
    ) : (
      <Stack space="space.075">
        <Text>{hasFix ? 'Next step: apply the verified edit below. Nothing changes on the page until you click.' : 'Next step: open the page and fix it, or hand it to the page owner as a review task.'}</Text>
        <Inline space="space.100" alignBlock="center" shouldWrap>
          {hasFix ? <Button appearance="primary" isDisabled={busy} onClick={() => onApply(f)}>{busy ? 'Applying…' : 'Apply this edit to the page'}</Button> : null}
          {task?.status === 'done' ? <Lozenge appearance="success" isBold>{`Review task ${task.key} created`}</Lozenge> : (
            <Button appearance={hasFix ? 'default' : 'primary'} isDisabled={task?.status === 'creating'} onClick={() => onCreateTask(f)}>{task?.status === 'creating' ? 'Creating…' : 'Create review task'}</Button>
          )}
        </Inline>
        {task?.status === 'error' ? <SectionMessage appearance="error" title="Could not create the task">{task.message}</SectionMessage> : null}
      </Stack>
    )}
    {act?.status === 'error' ? <SectionMessage appearance="error" title="Not done">{act.message}</SectionMessage> : null}
    <Box xcss={evidenceStyle}>
      <Inline space="space.300" alignBlock="start" shouldWrap>
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
    </Box>
    {hasFix ? <BeforeAfter s={f.suggestion!} done={applied} /> : f.suggestion?.unavailable ? <Text>{`No automatic edit: ${f.suggestion.unavailable}`}</Text> : null}
    <Text>{`Why it matters: ${f.why}`}</Text>
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Text>Was this a real contradiction?</Text>
      <Button appearance={review === 'real' ? 'primary' : 'subtle'} onClick={() => onReview(f, 'real')}>{review === 'real' ? 'Marked real' : 'Yes, it is real'}</Button>
      <Button appearance={review === 'false' ? 'primary' : 'subtle'} onClick={() => onReview(f, 'false')}>{review === 'false' ? 'Marked false alarm' : 'No, false alarm'}</Button>
    </Inline>
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Button appearance="subtle" onClick={() => onSnooze(f)} isDisabled={busy}>Snooze for 7 days</Button>
      <Button appearance="subtle" onClick={() => setAsking(!asking)} isDisabled={busy}>Dismiss with a reason…</Button>
      <Tag text={`Evidence #${f.id.slice(0, 8)}`} />
    </Inline>
    {asking ? (
      <Stack space="space.050">
        <Text>Reason for dismissing this finding (required)</Text>
        <Textfield placeholder="Why is this not a problem? (required)" onChange={(e) => setReason(e.target.value)} />
        <Button appearance="danger" isDisabled={!reason.trim()} onClick={() => onDismiss(f, reason)}>Dismiss with this reason</Button>
      </Stack>
    ) : null}
    <Lifecycle proposed={hasFix} applied={applied} />
    {f.foundBecause?.length ? <Text>{`Found because: ${f.foundBecause.map((r) => r.replace(/^(title|body) matches (.+)$/, (_m, w, rest) => `${w} matches ${String(rest).split(', ').length} word${String(rest).split(', ').length === 1 ? '' : 's'}`)).join(', ')}.`}</Text> : null}
  </Stack>
  </Box>
  );
};

const EmptyStateBlock = ({ onRefresh }: { onRefresh: () => void }) => (
  <Stack space="space.150" alignInline="center">
    <Icon glyph="check-circle" label="Clean" size="large" />
    <Heading size="medium">All clear</Heading>
    <Text>Nothing on the linked pages disagrees with this work item. If you change the work item or a page, check again.</Text>
    <Button onClick={onRefresh}>Check again</Button>
  </Stack>
);

const App = () => {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [acts, setActs] = useState<Record<string, ActState>>({});
  const [reviews, setReviews] = useState<Record<string, 'real' | 'false'>>({});
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
  const review = async (f: PanelFinding, verdict: 'real' | 'false') => {
    setReviews((r) => ({ ...r, [f.id]: verdict }));            // shown at once; the server keeps the count
    try { const r = await invoke<ActionReply>('reviewFinding', { findingId: f.id, verdict }); if (r?.ok === false) setReviews((x) => { const n = { ...x }; delete n[f.id]; return n; }); }
    catch { setReviews((x) => { const n = { ...x }; delete n[f.id]; return n; }); }
  };
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

  if (state.phase === 'loading') return (<Inline space="space.100" alignBlock="center"><Spinner /><Text>Reading the linked pages and checking them against this work item…</Text></Inline>);
  if (state.phase === 'error') return (<Stack space="space.100"><SectionMessage appearance="error" title="Same Page could not load"><Text>{state.message}</Text><Text>Nothing was changed, and this is not a clean result: Same Page never reports no contradictions when a check failed. This is usually a permissions prompt or a short outage.</Text></SectionMessage><Button onClick={load}>Try again</Button></Stack>);

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
            <Textfield placeholder="Target API version, for example v2" onChange={(e) => setTarget(e.target.value)} />
            <Button appearance="primary" isDisabled={!target.trim() || targetState.status === 'working'} onClick={saveTarget}>{targetState.status === 'working' ? 'Saving…' : 'Save target version'}</Button>
          </Inline>
          {targetState.status === 'error' ? <SectionMessage appearance="error" title="Not saved">{targetState.message}</SectionMessage> : null}
        </Stack>
      ) : null}
      <LinkPage onLinked={load} />
      {seed.status === 'done' && seed.linked
        ? <SectionMessage appearance="success" title="Demo data created">{`Open ${seed.epicKey} (the epic it names), then the Same Page panel in its apps menu. You should see 3 contradictions. Start with the runbook version one: it has a verified fix you can Apply, and you can then watch the page change in Confluence. The token expiry one (1 hour against 30 minutes) has no Apply, because Same Page cannot tell which side is right. A fact "access token expiry = 1 hour" was also declared: open Show the ten rules and click Check the whole site now to find a starter guide that was never linked to any work item and says 2 hours.`}</SectionMessage>
        : (
          <>
            {seed.status === 'done' ? <SectionMessage appearance="warning" title="Demo data created, but the page link failed">{`${seed.linkNote ?? 'The pages were not linked to the epic.'} Click Create demo data again to retry the link.`}</SectionMessage> : null}
            {seed.status === 'error' ? <SectionMessage appearance="error" title="Demo data not created">{seed.message}</SectionMessage> : null}
            <Button onClick={makeDemo} isDisabled={seed.status === 'working'}>{seed.status === 'working' ? 'Creating…' : 'Create demo data'}</Button>
          </>
        )}
    </Stack>
  );
  // The same shell for a clean result and for findings: a status banner first, then tabs, so the answer comes before the settings.
  const checkedTab = <Checked titles={m.pageTitles} count={m.pagesChecked} found={m.status === 'clean' ? 0 : m.findings.length} skipped={m.skippedRules} onSaved={load} />;
  const shell = (banner: React.ReactNode, findingsCount: number, findingsPanel: React.ReactNode) => (
    <Stack space="space.150">
      {banner}
      <Tabs id="same-page-tabs">
        <TabList>
          <Tab>{findingsCount ? `Findings (${findingsCount})` : 'Findings'}</Tab>
          <Tab>What was checked</Tab>
          <Tab>Rules and settings</Tab>
          <Tab>Audit trail</Tab>
        </TabList>
        <TabPanel><Box xcss={tabPad}>{findingsPanel}</Box></TabPanel>
        <TabPanel><Box xcss={tabPad}>{checkedTab}</Box></TabPanel>
        <TabPanel><Box xcss={tabPad}><RulesList autoOpen /></Box></TabPanel>
        <TabPanel><Box xcss={tabPad}><AuditTrail autoOpen /></Box></TabPanel>
      </Tabs>
    </Stack>
  );

  if (m.status === 'clean') return shell(
    <SectionMessage appearance="success" title="No contradictions found">{`Read ${m.pagesChecked} linked page${m.pagesChecked === 1 ? '' : 's'} and found nothing that disagrees with this work item.${m.hidden ? ` ${m.hidden} finding(s) hidden by snooze or dismissal.` : ''} Rules only, no AI.`}</SectionMessage>,
    0,
    <EmptyStateBlock onRefresh={load} />,
  );

  // Findings with a verified fix come first, then blockers, so the first card is the quickest win.
  const rank = (f: PanelFinding) => (f.suggestion?.after ? 0 : f.severity === 'block' ? 1 : 2);
  const ordered = [...(m.findings ?? [])].sort((a, b) => rank(a) - rank(b));
  const hasFix = ordered.some((f) => f.suggestion?.after);
  const worst = ordered.some((f) => f.severity === 'block') ? 'error' : 'warning';
  const n = m.findings.length;
  return shell(
    m.status === 'findings'
      ? <SectionMessage appearance={worst} title={`${n} ${n === 1 ? 'contradiction' : 'contradictions'} found`}>{hasFix ? 'Start with the first card: it has a verified edit you can apply in one click.' : 'Start with the first card. None has an automatic edit, so open the page or create a review task.'}</SectionMessage>
      : <SectionMessage appearance="information" title="Possible history, worth a look">These notes may describe the past on purpose. They never block.</SectionMessage>,
    n,
    <Stack space="space.200">
      {m.hidden ? <Text>{`${m.hidden} more finding(s) hidden by snooze or dismissal.`}</Text> : null}
      {(m.noisyRules ?? []).map((nr) => <Text key={nr.ruleId}>{nr.message}</Text>)}
      {[...ordered, ...(m.notes ?? [])].map((f, i) => (<Finding key={f.id} first={i === 0 && m.status === 'findings'} f={f} task={tasks[f.id]} onCreateTask={createTask} act={acts[f.id]} onApply={apply} onSnooze={snooze} onDismiss={dismissIt} review={reviews[f.id] ?? f.reviewed} onReview={review} />))}
      <Button onClick={load}>Check again</Button>
    </Stack>,
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
