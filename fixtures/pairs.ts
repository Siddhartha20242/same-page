// Hand-built fixture set: 15 pairs with a real contradiction, 10 clean pairs.
// `expect` lists the rule ids that SHOULD fire (empty = clean).
// Several clean pairs are deliberately tricky near-misses to test for false positives.

import type { Page, Pair, WorkItem } from '../src/types.ts';

/** A fixture pair plus the rule ids that SHOULD fire on it (empty = clean). */
export interface FixturePair extends Pair { id: string; expect: string[] }
/** A documented limitation: real staleness that historical wording hides from the blocker list. */
export interface KnownMiss extends Pair { id: string; note: string }

const OLD = '2026-08-01T10:00:00Z';
const NEW = '2026-10-01T10:00:00Z';

const wi = (key: string, o: Partial<WorkItem> = {}): WorkItem => ({
  key, status: 'Done', apiVersion: 'v2', statusChangedAt: NEW, statusChangedBy: 'dana',
  requiredFields: ['securityReview'], fields: { securityReview: 'approved' }, ...o,
});
const pg = (id: string, text: string, o: Partial<Page> = {}): Page => ({ id, title: `Runbook ${id}`, text, modifiedAt: OLD, labels: [], ...o });

export const pairs: FixturePair[] = [
  // ---- contradictions (15) ----
  { id: 'c01', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-1'), page: pg('p1', 'Call POST /api/v1/charge to create a charge.') },
  { id: 'c02', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-2', { apiVersion: 'v3' }), page: pg('p2', 'Endpoints\nGET /v2/orders lists orders.') },
  { id: 'c03', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-3'), page: pg('p3', 'Auth header format\nUse Bearer token. Service speaks v1.4 only.') },
  { id: 'c04', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-4', { status: 'In Progress' }), page: pg('p4', 'Deploy step: tag the release as v1 and push to production.') },
  { id: 'c05', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-5', { apiVersion: 'v4' }), page: pg('p5', 'Webhook payload format for v3 is shown below.\nv3 {"id": 1}') },
  { id: 'c06', expect: ['R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('ARC-1', { status: 'In Progress', apiVersion: undefined }), page: pg('p6', 'ADR: use queue.', { labels: ['Deprecated'] }) },
  { id: 'c07', expect: ['R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('ARC-2', { status: 'In Review', apiVersion: undefined }), page: pg('p7', 'ADR: use cron.', { labels: ['superseded', 'adr'] }) },
  { id: 'c08', expect: ['R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('ARC-3', { status: 'In Progress', apiVersion: undefined }), page: pg('p8', 'Decision: SOAP gateway.', { labels: ['DEPRECATED'] }) },
  { id: 'c09', expect: ['R3_MISSING_REQUIRED_FIELD'], workItem: wi('SEC-1', { fields: {}, apiVersion: undefined }), page: pg('p9', 'No versions here.') },
  { id: 'c10', expect: ['R3_MISSING_REQUIRED_FIELD'], workItem: wi('SEC-2', { fields: { securityReview: '' }, apiVersion: undefined }), page: pg('p10', 'Plain page.') },
  { id: 'c11', expect: ['R3_MISSING_REQUIRED_FIELD', 'R3_MISSING_REQUIRED_FIELD'], workItem: wi('SEC-3', { requiredFields: ['securityReview', 'legalSignoff'], fields: {}, apiVersion: undefined }), page: pg('p11', 'Plain page.') },
  { id: 'c12', expect: ['R1_VERSION_MISMATCH', 'R3_MISSING_REQUIRED_FIELD'], workItem: wi('MIX-1', { fields: {} }), page: pg('p12', 'Use v1 client.') },
  { id: 'c13', expect: ['R1_VERSION_MISMATCH', 'R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('MIX-2', { status: 'In Progress' }), page: pg('p13', 'v1 is the supported API.', { labels: ['deprecated'] }) },
  { id: 'c14', expect: ['R1_VERSION_MISMATCH', 'R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('MIX-3', { status: 'In Review', apiVersion: 'v5' }), page: pg('p14', 'Targets v4 only.', { labels: ['superseded'] }) },
  { id: 'c15', expect: ['R1_VERSION_MISMATCH'], workItem: wi('PAY-6', { apiVersion: 'v10' }), page: pg('p15', 'Mobile clients use v9.2 of the protocol.') },

  { id: 'c16', expect: ['R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('ARC-4', { status: 'In Progress', apiVersion: undefined }), page: pg('p16', 'Use REST.', { labels: ['superseded'] }) },
  { id: 'c17', expect: ['R2_DEPRECATED_DECISION_ACTIVE_WORK'], workItem: wi('ARC-5', { status: 'In Review', apiVersion: undefined }), page: pg('p17', 'Use gRPC.', { labels: ['Deprecated', 'adr'] }) },
  { id: 'c18', expect: ['R3_MISSING_REQUIRED_FIELD'], workItem: wi('SEC-4', { fields: { securityReview: null }, apiVersion: undefined }), page: pg('p18', 'Plain.') },
  { id: 'c19', expect: ['R3_MISSING_REQUIRED_FIELD'], workItem: wi('SEC-5', { requiredFields: ['legalSignoff'], fields: { securityReview: 'ok' }, apiVersion: undefined }), page: pg('p19', 'Plain.') },

  // ---- clean (10), several are near-misses ----
  { id: 'n01', expect: [], workItem: wi('OK-1'), page: pg('q1', 'Call POST /api/v2/charge.') },
  { id: 'n02', expect: [], workItem: wi('OK-2'), page: pg('q2', 'v1 is deprecated. Migrate to v2 before Q4.') },        // mentions old AND new
  { id: 'n03', expect: [], workItem: wi('OK-3'), page: pg('q3', 'Uses v1 client.', { modifiedAt: '2026-10-15T00:00:00Z' }) }, // page newer than status change
  { id: 'n04', expect: [], workItem: wi('OK-4'), page: pg('q4', 'No version references in this page at all.') },
  { id: 'n05', expect: [], workItem: wi('OK-5', { apiVersion: undefined }), page: pg('q5', 'Legacy v1 doc.') },                  // work item has no version
  { id: 'n06', expect: [], workItem: wi('OK-6', { status: 'To Do', apiVersion: undefined }), page: pg('q6', 'Old.', { labels: ['deprecated'] }) }, // deprecated but work not active
  { id: 'n07', expect: [], workItem: wi('OK-7', { status: 'In Progress', apiVersion: undefined }), page: pg('q7', 'Current.', { labels: ['adr', 'approved'] }) },
  { id: 'n08', expect: [], workItem: wi('OK-8', { status: 'In Progress', fields: {} }), page: pg('q8', 'Current v2 docs.') },       // field missing but not Done yet
  { id: 'n09', expect: [], workItem: wi('OK-9', { requiredFields: [] , fields: {} }), page: pg('q9', 'Targets v2.') },
  { id: 'n10', expect: [], workItem: wi('OK-10', { apiVersion: 'v2' }), page: pg('q10', 'Release v2.1 notes and v2.0 notes.') },  // minor versions of the same major
  // adversarial near-misses
  { id: 'n11', expect: [], workItem: wi('OK-11'), page: pg('q11', 'Rollback procedure: if the release fails, redeploy the v1 image and notify on-call.') },      // historical context
  { id: 'n12', expect: [], workItem: wi('OK-12'), page: pg('q12', 'Migration note: the old v1 endpoints were retired last year.') },
  { id: 'n13', expect: [], workItem: wi('OK-13', { status: 'Done', apiVersion: 'v2' }), page: pg('q13', 'Current v2 docs.', { labels: ['deprecated'] }) }, // deprecated but work is Done, not active
  { id: 'n14', expect: [], workItem: wi('OK-14', { status: 'In Progress', apiVersion: undefined }), page: pg('q14', 'Active decision.', { labels: ['adr', 'accepted'] }) },
  { id: 'n15', expect: [], workItem: wi('OK-15', { status: 'Done', requiredFields: ['securityReview'], fields: { securityReview: 'approved' }, apiVersion: 'v2' }), page: pg('q15', 'Legacy v1 path removed; clients use v2.') },
];

// Documented limitation (NOT counted in precision): real staleness hidden by historical wording.
export const knownMisses: KnownMiss[] = [
  { id: 'k02', note: 'Rollback step for the old version that is genuinely stale; suppressed by the "rollback" wording.', workItem: wi('KM-2', { status: 'In Progress' }), page: pg('k2', 'Rollback: redeploy v1 image.') },
  { id: 'k03', note: 'Webhook doc marked "legacy" but is the only reference; suppressed.', workItem: wi('KM-3', { apiVersion: 'v4' }), page: pg('k3', 'Legacy v3 webhook payload shown below.') },
  { id: 'k01', note: 'Stale page says "legacy" near v1 but is the only runbook; rule suppresses it.', workItem: wi('KM-1'), page: pg('k1', 'Legacy runbook: call POST /v1/charge.') },
];
