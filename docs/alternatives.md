# What else exists

Our own web search on 2026-11-24, reading Marketplace listings. We did not install or test any of these, we did not see pricing, and a listing can leave out what an app does. Treat this as a map, not a verdict.

| App | What it says it does | How it differs from Same Page |
|---|---|---|
| [Linked Docs Review](https://marketplace.atlassian.com/apps/2245805503/linked-docs-review) | When a linked Jira issue's status, fix version or due date changes, the Confluence page shows "Review needed" with the lines that still state the old value. Editors mark Updated, Checked or Not relevant, and a receipt is kept. | The closest neighbour. It starts from a field change and asks people to review. It does not say it blocks a Jira transition, and its listing does not say how lines are matched. Same Page compares the work item with the page's own lines at any time, can stop a move to Done, and offers a verified fix. Listing shows 1 install, version 2.2.0 released 2026-11-18. |
| [Doc Drift for Confluence](https://marketplace.atlassian.com/apps/162934767/doc-drift-for-confluence) | Flags pages that mention a file, route or config key that a merged GitHub pull request changed. | Starts from code, not tickets. No Jira side. |
| Content Coherence, Winnow Advanced, Evergreen AI, WikiFix | Find pages that contradict each other or are stale. Winnow Advanced says it uses a language model and can be wrong. | They compare pages with pages, mostly with a model. We compare a work item with pages, with fixed rules. |
| Stale Page Finder, Stale Content Auditor, Page Pulse, Content Guardian | Flag pages by age. | Age, not content. A page edited yesterday can still be wrong. |

## What this means for the claim

The README used to say we know of no other app that does this inside a Jira workflow. That is still true of the transition gate as far as we can tell, but Linked Docs Review overlaps on the idea, so we no longer call the idea unique. Our difference is the gate, rules that explain themselves, the evidence beside Jira's own field, the audit log, and the agent and MCP tools. If a judge knows Linked Docs Review, the honest answer is that it is a neighbour and that we have not compared them side by side.
