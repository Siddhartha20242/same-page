// Second held-out set. Written after heldout.ts had been fixed, and run once before any change to the engine.
// The first-run score is in docs/accuracy.md. Authors' own wording, not real data.
import type { Realistic } from './realistic.ts';
export const heldout2: Realistic[] = [
  // true contradictions
  { id: 'i01', ticket: 'OAuth access tokens last 15 minutes.', page: 'Access tokens last for 60 minutes before the client must refresh.', fire: 'R8' },
  { id: 'i02', ticket: 'Upload limit is 50 MB per file.', page: 'Each file may be up to 200 MB.', fire: 'R9' },
  { id: 'i03', ticket: 'Webhook delivery timeout: 5 seconds', page: 'Webhook delivery timeout is 20 seconds.', fire: 'R8' },
  { id: 'i04', ticket: 'The scheduler runs with 4 workers.', page: 'Worker count: 8', fire: 'R9' },
  { id: 'i05', ticket: 'Cut-over is on 2027-02-02.', page: 'Cut-over date: 2027-02-09', fire: 'R10' },
  { id: 'i06', ticket: 'Audit entries are kept for 400 days.', page: 'We retain audit entries for 180 days.', fire: 'R8' },
  { id: 'i07', ticket: 'API rate limit: 300 requests per hour', page: 'Rate limit: 3000 requests per hour per key', fire: 'R9' },
  { id: 'i08', ticket: 'Staging runs on port 9090.', page: 'Staging runs on port 9091.', fire: 'R9' },
  { id: 'i09', ticket: 'Cache entries expire after 2 hours.', page: 'Cached entries have a TTL of 12 hours.', fire: 'R8' },
  { id: 'i10', ticket: 'Max page size is 100 items.', page: 'Page size: 500', fire: 'R9' },
  { id: 'i11', ticket: 'Launch is 2027-03-01.', page: 'The launch is scheduled for March 8, 2027.', fire: 'R10' },
  { id: 'i12', ticket: 'Disk alert threshold is 80%.', page: 'Disk alert threshold: 90%', fire: 'R9' },
  { id: 'i13', ticket: 'Password reset emails expire in 1 hour.', page: 'Password reset emails expire in 24 hours.', fire: 'R8' },
  { id: 'i14', ticket: 'Max retries: 2', page: 'Max retries is 6.', fire: 'R9' },
  { id: 'i15', ticket: 'Failover completes within 30 seconds.', page: 'Failover completes within 5 minutes.', fire: 'R8' },
  // consistent, or not a contradiction
  { id: 'j01', ticket: 'OAuth access tokens last 15 minutes.', page: 'Refresh tokens last 14 days.', fire: null },
  { id: 'j02', ticket: 'Upload limit is 50 MB per file.', page: 'The whole archive may be up to 2 GB.', fire: null },
  { id: 'j03', ticket: 'Webhook delivery timeout: 5 seconds', page: 'Webhook delivery timeout: 5 seconds', fire: null },
  { id: 'j04', ticket: 'The scheduler runs with 4 workers.', page: 'The web tier runs with 12 workers.', fire: null },
  { id: 'j05', ticket: 'Cut-over is on 2027-02-02.', page: 'The 2026 cut-over took place on 2026-02-09.', fire: null },
  { id: 'j06', ticket: 'Audit entries are kept for 400 days.', page: 'Application logs are kept for 30 days.', fire: null },
  { id: 'j07', ticket: 'API rate limit: 300 requests per hour', page: 'Example: a burst of 3000 requests per hour is blocked.', fire: null },
  { id: 'j08', ticket: 'Staging runs on port 9090.', page: 'Production runs on port 443.', fire: null },
  { id: 'j09', ticket: 'Cache entries expire after 2 hours.', page: 'Sessions expire after 12 hours.', fire: null },
  { id: 'j10', ticket: 'Max page size is 100 items.', page: 'The legacy API returned up to 500 items per page.', fire: null },
  { id: 'j11', ticket: 'Launch is 2027-03-01.', page: 'The 2025 launch happened on 2025-03-08.', fire: null },
  { id: 'j12', ticket: 'Disk alert threshold is 80%.', page: 'The disk is currently at 91%.', fire: null },
  { id: 'j13', ticket: 'Password reset emails expire in 1 hour.', page: 'Password reset emails expire in 60 minutes.', fire: null },
  { id: 'j14', ticket: 'Max retries: 2', page: 'Retries use exponential backoff starting at 2 seconds.', fire: null },
  { id: 'j15', ticket: 'Failover completes within 30 seconds.', page: 'A full disaster recovery takes up to 4 hours.', fire: null },
];
