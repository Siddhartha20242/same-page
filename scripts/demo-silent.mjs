// Offline demo of "silent when unsure", on generated data. Not from a real site. Nothing is changed anywhere.
import { check } from '../src/engine.ts';

const ticket = 'Token expiry should be 1 hour. Rate limit is 100 requests per minute.';
const cases = [
  ['A real contradiction', 'Access tokens expire after 30 minutes.'],
  ['An example, not a claim', 'Example: set token expiry to 5 minutes for the demo tenant.'],
  ['History', 'Tokens previously expired after 30 minutes, before the 2.0 rewrite.'],
  ['A different environment', 'In staging, tokens expire after 5 minutes.'],
  ['A default, not the setting', 'The default token expiry is 30 minutes.'],
  ['A range', 'Tokens expire after 30-60 minutes depending on the client.'],
  ['A different thing with the same unit', 'Refresh tokens expire after 30 days.'],
  ['The same value in other units', 'Tokens expire after 60 minutes.'],
];
console.log('Generated data, not from a real site.\nTicket: ' + ticket + '\n');
for (const [label, page] of cases) {
  const r = check({ workItem: { key: 'DEMO-1', status: 'In Progress', text: ticket }, page: { id: '1', title: 'Runbook', text: page, modifiedAt: '2026-01-01T00:00:00Z' } });
  const f = r.findings.filter((x) => /^R(8|9|10)_/.test(x.ruleId));
  console.log(`${f.length ? 'FLAGGED' : 'silent '}  ${label}\n         page: ${page}${f.length ? `\n         -> ${f[0].summary}` : ''}`);
}
