# Same Page: Privacy Policy

Last updated: 2026-11-05

Same Page is a Forge app for Jira Cloud and Confluence Cloud. This page says what it reads, what it keeps, and how to remove it.

## Where your data goes
Same Page runs on Atlassian's Forge platform inside your Atlassian site. The app declares no external egress in its manifest, so it cannot send data to any server outside Atlassian. We do not run a server, and we do not receive your Jira or Confluence content.

## What the app reads
It reads the Jira work item you open (summary, status history, labels, links, components) and the Confluence pages linked to it or found by search (title, text, labels, last edit time and editor). Panel actions run as the person using the app, so Jira and Confluence permissions decide what it can see. The pre-ship gate and the pin check run without a signed-in user and read as the app. Before the gate quotes any page text in a refusal message, it asks Confluence whether the person making the transition can read that page. If the answer is unclear, the text is withheld.

## Detection never uses a model
Contradictions are found by fixed rules. No model is called to detect anything.

## The optional AI fix is off by default
For one ambiguous line, the app can ask a model to reword that single line. This uses Forge LLM, a service on the Atlassian platform. It is off unless the app's developer sets the variable SAME_PAGE_AI=1, and it is off in the version you install. When on, it sends one line of page text with the request, makes at most 40 calls per day per installation, and keeps answers for 24 hours. A reworded line is shown only if it passes the same rule check, and nothing is written until a person clicks Apply.

## What is stored
In Forge storage for your installation:
- Dismiss and snooze records: an identifier for the finding, the reason a person typed, their account ID, and the date.
- An audit chain: one entry for each fix a person applied, with the rule, the work item key, the page ID, a short snippet (up to 200 characters) of the old and new line, a timestamp, and hashes.
- Counters: how many findings were shown, applied, dismissed, snoozed, turned into review tasks, and how many transitions were blocked. The counters hold no page text, titles, or names.
- A short cache for the pre-ship gate, per work item: the blocking finding, page title, and the flagged line.
- A cache of AI-reworded lines, only if the optional AI path is on.
- Demo data identifiers, only if you click Create demo data.

On your Jira and Confluence content:
- A Confluence content property named same-page.pins on a page the app fixed, listing the work item keys it is pinned to.
- Jira work item properties: same-page.lastReceipt (the audit entry number and hash) and same-page.targetVersion (if you save a target version).
- Page versions, review tasks, and comments the app creates when a person clicks a button. The comment from the pin check names no page title or text.

## Why each permission is requested
- Read Jira work and users: read work items, and show the approver's name in the page version message.
- Write Jira work: create review tasks and demo data, store the properties above, and comment when a fixed page regresses.
- Read Confluence content, spaces, pages, labels, and search: find and read linked pages.
- Write Confluence content, pages, and labels: save an applied fix as a new page version, and create demo pages.
- Read content permissions: check whether a person may read a page before the gate quotes it.
- Read and write content properties: keep the pin on the page.
- Storage: keep the records listed above.

## Deleting data
Nothing is deleted automatically, and there is no time limit on audit entries. The audit chain is meant to be a lasting record.

What happens to the app's own storage after you uninstall is set by Atlassian's Forge platform rules, not by this app. See Atlassian's Forge documentation for the current terms. The app has no uninstall step of its own, so these remain in your site until you delete them: the page versions it saved (they can be reverted from page history), the same-page.pins and same-page.lastReceipt properties, the same-page.targetVersion property, review tasks, comments, and any demo pages or work items. To remove the properties, delete them with the Jira and Confluence property APIs or ask us for help.

## Certifications
We have not obtained any security certification or compliance attestation for this app. Same Page relies on the security of the Atlassian platform it runs on.

## Contact
Questions or deletion help: {{SUPPORT_CONTACT}}

We will update this page if the app's data handling changes.
