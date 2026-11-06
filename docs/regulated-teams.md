# For teams that have to explain their decisions

Same Page was built so that when it stops a release, the reason can be shown, repeated and kept. This page lists what the app does that matters to a team in an audited setting, and, just as plainly, what we have not done.

## What it does
- **No model in detection.** Fixed rules decide what counts as a contradiction. The same work item and pages always give the same findings, so a refusal can be reproduced and explained to the person it stopped.
- **No external network access.** The manifest declares none, so the app talks only to Atlassian's own APIs and your content does not leave Atlassian.
- **Evidence, not an opinion.** A refusal shows the page's own line next to Jira's own field, with a short evidence id that is the same id the panel shows.
- **A person approves every change.** An applied fix is a normal Confluence page version that names the approver. Page history is the undo.
- **A record of what happened.** Each applied fix and each step in a finding's handling (first shown, dismissed with a reason, snoozed, sent to an owner) is sealed in one hash chain, and the panel re-verifies it on request. It records who acted, not who merely looked.
- **It respects page permissions.** Panel actions run as the viewing user. The gate shows page text only to a person who can read the page.
- **A safe way in.** The gate has a watch-only mode that allows every transition and only counts what it would have refused, so a team can see the effect before it enforces.
- **Small footprint.** Forge storage holds counters, markers, rule settings and the audit chain. The privacy policy lists all of it.

## What we have not done
- **No independent security review or certification.** We have not been through a security audit, and we make no compliance claim of any kind. A team's own security review still has to approve the app.
- **The audit chain is tamper-evident, not tamper-proof.** It detects edits to stored history. Someone with write access to the app's storage could rewrite the whole chain.
- **Atlassian Cloud only.** Forge apps run on Atlassian Cloud. A team on Jira Data Center or Server cannot install this.
- **No real-world accuracy figure.** No team has used it yet. Its fixed rules miss contradictions that are worded differently enough, and it can raise false alarms. Every finding has "real" and "false alarm" buttons so a team can measure that on its own documents.
- **The gate needs a company-managed Jira project** and an administrator to attach it.

## Try it without risk
Use a test project with made-up data, set the gate to watch only, and mark every finding real or false alarm. After a week, an administrator can print a pilot report (counts only, no page text or names). See [pilot-kit.md](pilot-kit.md).
