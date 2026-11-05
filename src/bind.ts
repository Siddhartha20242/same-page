// "Detect once, bind forever", the pure half. Given a page in Atlassian Document Format (ADF) and a stale token on a line,
// swap that token for an extension node (a live Forge macro reading the Jira field), leaving everything else untouched.
// The extension node's shape is NOT assumed here: the caller passes one captured from a real page where the macro was
// inserted by hand (a manual check). Community reports say inserting Forge macros through the storage format fails, so the
// ADF route is the one to test. Refuses unless the line sits in exactly one text node and the token appears once on it.

export interface AdfNode { type?: string; text?: string; content?: AdfNode[]; [key: string]: unknown }
export type BindResult = { ok: true; doc: AdfNode } | { ok: false; reason: string };

export function bindInAdf(doc: AdfNode, { line, token, node }: { line: string; token: string; node: AdfNode }): BindResult {
  const holders: { parent: AdfNode & { content: AdfNode[] }; index: number }[] = [];
  const walk = (n: AdfNode | null | undefined): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.content)) {
      n.content.forEach((child, i) => {
        if (child?.type === 'text' && typeof child.text === 'string' && child.text.includes(line)) holders.push({ parent: n as AdfNode & { content: AdfNode[] }, index: i });
        walk(child);
      });
    }
  };
  walk(doc);
  if (holders.length === 0) return { ok: false, reason: 'the line is not inside a single text run (inline formatting may split it); bind manually' };
  if (holders.length > 1) return { ok: false, reason: 'the line appears in more than one place; refusing to guess' };

  const { parent, index } = holders[0];
  const textNode = parent.content[index] as AdfNode & { text: string };
  const lineAt = textNode.text.indexOf(line);
  if (textNode.text.indexOf(line, lineAt + 1) !== -1) return { ok: false, reason: 'the line appears more than once in the same paragraph; refusing to guess' };
  const inLine = line.indexOf(token);
  if (inLine === -1 || line.indexOf(token, inLine + 1) !== -1) return { ok: false, reason: 'the token must appear exactly once on the line' };

  const at = lineAt + inLine;
  const before = textNode.text.slice(0, at);
  const after = textNode.text.slice(at + token.length);
  const piece = (text: string): AdfNode[] => (text ? [{ ...textNode, text }] : []);
  const out = structuredClone(doc);
  // locate the same holder in the clone
  const find = (orig: AdfNode, copy: AdfNode): AdfNode | null => {
    if (orig === parent) return copy;
    const kids = orig.content || [];
    for (let i = 0; i < kids.length; i++) {
      const hit = find(kids[i] as AdfNode, (copy.content as AdfNode[])[i] as AdfNode);
      if (hit) return hit;
    }
    return null;
  };
  const target = find(doc, out) as AdfNode & { content: AdfNode[] };
  target.content.splice(index, 1, ...piece(before), structuredClone(node), ...piece(after));
  return { ok: true, doc: out };
}
