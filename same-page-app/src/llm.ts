import { chat } from '@forge/llm';
import { kvs } from '@forge/kvs';
import { createHash } from 'node:crypto';
import type { Llm } from './core/propose';

// The model only ever words ONE line, and every answer still has to pass verifyFix (version references only, same line, no new URL or markup).
// Cost is billed to the app developer, so: a small daily cap per installation, and identical prompts are answered from storage for 24 hours.
// The cache also keeps the line the panel showed identical to the line Apply writes.
const MODEL = 'claude-sonnet-5';
const DAILY_CAP = 40;
const DAY_MS = 24 * 3600 * 1000;

const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string } | null)?.text ?? '').join('') : '');

export const forgeLlm: Llm = async ({ prompt }) => {
  const key = `llm:fix:${createHash('sha256').update(prompt).digest('hex').slice(0, 40)}`;
  const hit = (await kvs.get(key)) as { text?: string; at?: number } | undefined;
  if (hit?.text && Date.now() - (hit.at ?? 0) < DAY_MS) return hit.text;

  const countKey = `llm:count:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await kvs.get(countKey)) ?? 0);
  if (used >= DAILY_CAP) throw new Error('daily model limit reached');
  await kvs.set(countKey, used + 1);

  const res = (await chat({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 200 })) as { choices?: { message?: { content?: unknown } }[] };
  const out = textOf(res.choices?.[0]?.message?.content).trim();
  if (!out) throw new Error('empty model reply');
  await kvs.set(key, { text: out, at: Date.now() });
  return out;
};
