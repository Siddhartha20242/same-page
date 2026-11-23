// Held-out wording set. Written AFTER the engine was tuned on fixtures/realistic.ts, and run once before
// any change to the engine. The first-run score is recorded in docs/accuracy.md. Cases that failed were
// then fixed, so from that point this file is a regression set too. Authors' own wording, not real data.
import type { Realistic } from './realistic.ts';
export const heldout: Realistic[] = [
  // true contradictions
  { id: 'h01', ticket: 'Idle sessions are logged out after 20 minutes.', page: 'Users are signed out after 45 minutes of idle time.', fire: 'R8' },
  { id: 'h02', ticket: 'Invoices are retained for 7 years.', page: 'Invoice retention period: 10 years', fire: 'R8' },
  { id: 'h03', ticket: 'Max request body size: 1 MB', page: 'The gateway rejects bodies over 5 MB. Max request body size: 5 MB', fire: 'R9' },
  { id: 'h04', ticket: 'The API allows 60 requests per minute.', page: 'Clients may make 600 requests per minute.', fire: 'R9' },
  { id: 'h05', ticket: 'Run the nightly job at 02:00. It must finish within 45 minutes.', page: 'The nightly job must finish within 2 hours.', fire: 'R8' },
  { id: 'h06', ticket: 'The database listens on port 5432.', page: 'Connect to Postgres on port 6432.', fire: 'R9' },
  { id: 'h07', ticket: 'Go-live is 2027-01-12.', page: 'Go-live date: 2027-01-19', fire: 'R10' },
  { id: 'h08', ticket: 'The migration deadline is March 3, 2027.', page: 'Teams must finish the migration by the deadline of March 10, 2027.', fire: 'R10' },
  { id: 'h09', ticket: 'Magic links expire after 10 minutes.', page: 'A magic link is valid for 1 hour.', fire: 'R8' },
  { id: 'h10', ticket: 'Rollout starts at 5% of traffic.', page: 'The canary receives 25% of traffic.', fire: 'R9' },
  { id: 'h11', ticket: 'Lambda timeout is 15 seconds.', page: 'Function timeout: 60 seconds', fire: 'R8' },
  { id: 'h12', ticket: 'The queue holds at most 1000 messages.', page: 'The queue holds at most 5000 messages.', fire: 'R9' },
  { id: 'h13', ticket: 'Soft-deleted users are purged after 30 days.', page: 'Deleted users are purged after 90 days.', fire: 'R8' },
  { id: 'h14', ticket: 'Heartbeat interval = 10s', page: 'heartbeat interval = 30s', fire: 'R8' },
  { id: 'h15', ticket: 'Release freeze starts on 2026-12-18.', page: 'Code freeze starts on 2026-12-11.', fire: 'R10' },
  // consistent, or not a contradiction
  { id: 'k01', ticket: 'Idle sessions are logged out after 20 minutes.', page: 'Idle sessions are logged out after 20 minutes.', fire: null },
  { id: 'k02', ticket: 'The API allows 60 requests per minute.', page: 'Burst traffic is limited to 600 requests per minute for partners.', fire: null },
  { id: 'k03', ticket: 'Magic links expire after 10 minutes.', page: 'Invitation emails expire after 7 days.', fire: null },
  { id: 'k04', ticket: 'Max request body size: 1 MB', page: 'Screenshots are limited to 5 MB each.', fire: null },
  { id: 'k05', ticket: 'The database listens on port 5432.', page: 'The cache listens on port 6379.', fire: null },
  { id: 'k06', ticket: 'Go-live is 2027-01-12.', page: 'Last year we went live on 2026-01-12 with a smaller scope.', fire: null },
  { id: 'k07', ticket: 'Lambda timeout is 15 seconds.', page: 'The API gateway timeout is 29 seconds.', fire: null },
  { id: 'k08', ticket: 'Heartbeat interval = 10s', page: 'Heartbeat interval = 10 seconds', fire: null },
  { id: 'k09', ticket: 'Soft-deleted users are purged after 30 days.', page: 'Soft-deleted users are purged after 30 days in staging and 7 days in dev.', fire: null },
  { id: 'k10', ticket: 'Rollout starts at 5% of traffic.', page: 'Disk usage alerts fire at 85%.', fire: null },
  { id: 'k11', ticket: 'The queue holds at most 1000 messages.', page: 'The queue used to hold 500 messages before we resized it.', fire: null },
  { id: 'k12', ticket: 'Max retries is 3.', page: 'Retries are capped. See the retry policy page.', fire: null },
  { id: 'k13', ticket: 'The nightly job must finish within 45 minutes.', page: 'On average the job finishes in 12 minutes.', fire: null },
  { id: 'k14', ticket: 'Token expiry is 1 hour.', page: 'Refresh tokens expire after 30 days.', fire: null },
  { id: 'k15', ticket: 'Backups run every 6 hours.', page: 'Restore tests run every 7 days.', fire: null },
];
