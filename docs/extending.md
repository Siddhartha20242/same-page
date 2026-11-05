# Extending Same Page: a design, not a feature

**Nothing in this document is built.** It records how we would add sources beyond Confluence pages, and why we have not.

## Why only Jira and Confluence today
Reading a README, a Google Doc or a spec in a repository means calling a service outside Atlassian. Forge requires an app to declare external network access in its manifest, and our manifest declares none. That is a promise we make to every site that installs the app: your content never leaves Atlassian. We chose to keep it for this submission.

## The shape of an extension
The engine already compares plain text with plain text. Every rule takes a work item and a page `{ id, title, text, modifiedAt }`. A new source only has to produce that shape:

```ts
interface ExternalSourceAdapter {
  /** A stable name shown in the panel, for example "README in the payments repo". */
  name: string;
  /** Which sources belong to this work item, from a link or a label on the work item. */
  discover(issue: Issue): Promise<{ id: string; url: string }[]>;
  /** The text of one source, or null when the viewer may not read it. */
  read(id: string): Promise<{ title: string; text: string; modifiedAt: string } | null>;
}
```

Because the rules only see text, none of them would change. A README line would be compared the same way a runbook line is, and the evidence would quote it the same way.

## What it would cost
- A manifest change that declares the external host, which every installing site must accept, and which ends the "no external egress" statement in the README and the privacy policy.
- Authentication for each source, stored per site.
- For writes (the Apply fix), a different mechanism per source. We would start read-only: detect and quote, never edit.
- Re-checking the privacy policy and the Marketplace listing.

## Order we would do it
1. OpenAPI specs and READMEs in a public or token-protected repository, read-only.
2. Linked Google Docs, read-only.
3. Anything that needs writes.
