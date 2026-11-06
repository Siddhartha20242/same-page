// "Link a page": a person pastes a Confluence page address and Same Page adds it to the work item as a web link, so it is checked from then on.
// The address must be on this site (so nothing is sent anywhere else), must name a page, and the person must be able to read that page.

const PAGE_PATH = /\/wiki\/(?:spaces\/[^/]+\/pages|x\/[^/]+\/pages)\/(\d{1,20})(?:\/|$)/i;
const PAGE_QUERY = /\/wiki\/pages\/viewpage\.action$/i;

export type ParsedLink = { ok: true; pageId: string; url: string } | { ok: false; reason: string };

export function parsePageLink(input: unknown, siteUrl?: string): ParsedLink {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Paste the address of a Confluence page.' };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'That does not look like a web address. Paste it exactly as it appears in the browser.' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https addresses are accepted.' };
  let site: URL | null = null;
  try { site = siteUrl ? new URL(siteUrl) : null; } catch { site = null; }
  if (!site) return { ok: false, reason: 'The site address is not known, so the page could not be linked.' };
  if (u.host.toLowerCase() !== site.host.toLowerCase()) return { ok: false, reason: `Only pages on ${site.host} can be linked here.` };
  const id = PAGE_PATH.exec(u.pathname)?.[1] ?? (PAGE_QUERY.test(u.pathname) ? /^\d{1,20}$/.exec(u.searchParams.get('pageId') ?? '')?.[0] : undefined);
  if (!id) return { ok: false, reason: 'That address does not point to a Confluence page. Open the page and copy its address.' };
  return { ok: true, pageId: id, url: `${u.origin}/wiki/pages/viewpage.action?pageId=${id}` };
}
