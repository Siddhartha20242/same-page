# What happened on a real Atlassian site (2026-11-05)

First deploy and run on a real dev site (Jira + Confluence, Standard plans). Everything below was observed, not assumed.

## Works, observed live
- `forge lint`, `forge deploy -e development`, `forge install` on Jira and Confluence.
- The issue panel (UI Kit native) renders in Jira and calls the resolver. It lives under the work item's **app actions** menu (the puzzle icon under the title), not in the right sidebar.
- Create demo data: runbook page, deprecated ADR page, epic, status transition, and absolute-URL remote links all created as the viewing user.
- Detection on live data: R1 (runbook says v1, epic targets v2) and R2 (ADR deprecated, epic In Progress) both fired.
- Apply: the runbook became Confluence page version 2 with only the flagged line changed (`/api/v1/charge` to `/api/v2/charge`) and the message "Same Page: version fix for SCRUM-2, approved by ...". A re-check then showed only R2.
- Create review task: a Jira Task with the evidence packet.
- The pre-ship gate, both ways. A company-managed project (PAY) with the "Same Page contradiction check" rule on its Done transition: moving PAY-1 to Done while the runbook said v1 was REFUSED with HTTP 400 in about 3 s and the evidence message; after Apply fixed the page, the same transition returned 204 and the issue went Done. Server logs: `BLOCK (live)` then `allow (live)`, so reading Confluence as the app works.
- Model-written fix (Forge LLM, `claude-sonnet-5`): a line the mechanical rewrite refuses (`/api/v1.4/charge`) got an AI-suggested edit labelled as such, passed the same verification, and Apply changed only that token.
- The approver's display name in the page-version message (needs `read:jira-user`): "approved by <display name>".
- Snooze 7 days and Dismiss (an empty reason is refused; with a reason the panel says "N finding(s) hidden by snooze or dismissal").
- `rovo:agent`, `rovo:mcp` and `action` modules are accepted by lint and deploy.
- Production environment deployed, and installed on a SECOND, fresh site (`forge site provision` demo site, production build): panel, Create demo data, both findings, the proposed fix. That is the judge's experience.
- The Rovo agent, end to end, on that fresh site: `@Same Page do the docs for MOBL-58 contradict the ticket?` Rovo showed "Invoking tool: Scan several issues for doc contradictions" and "Check an issue against its docs", the production logs show our handlers ran (`scan-issues`, `check-issue-docs` for each key), and the answer said "MOBL-58 has stale documentation, while SPD-1 could not be checked" with the quoted evidence.

## Fixed because of the real site
| Symptom | Cause | Fix |
|---|---|---|
| `TypeScript emitted no output` on deploy | `noEmit: true` in the app tsconfig; Forge's bundler needs output | removed it (type checking still runs with `tsc --noEmit`) |
| `NEEDS_AUTHENTICATION_ERR` / "Authentication Required" on the first Confluence call, then an endless "Allow access" loop | The Confluence v2 endpoints need GRANULAR scopes; we declared only classic ones. Forge reports the 401 as a consent problem, and consenting never fixes it | added `read:space`, `read:page`, `write:page`, `read:label`, `write:label` (all `:confluence`) |
| Consent prompt never appeared | resolvers caught the consent error and returned a message | rethrow `NEEDS_AUTHENTICATION_ERR` (`needsConsent` in `src/index.ts` and `src/atlassianDeps.ts`) so the platform can show its prompt |
| Remote link POST returned HTTP 400 | Jira only accepts ABSOLUTE urls; we sent a path | `createSeedDeps(request, siteUrl)` with the site url from the resolver context |
| Seed reported success though linking failed, and never retried | link failure was stored as final | retry until `linked === true`; panel says so |
| "targets n/a (unknown date)" on the R2 card | the ticket line always assumed a target version | text depends on the rule (`ticketLine` in `src/panelModel.ts`) |
| Review task said "Doc says: undefined" | no quoted line for R2 | line omitted when absent |
| "approved by <accountId>" | `/rest/api/3/myself` needs `read:jira-user` | scope added (display name expected; not re-checked after the upgrade) |

## Facts worth remembering
- ANY scope change is a major version: `forge deploy --approve MAJOR_VERSION_RULE`, then `forge install --upgrade -s SITE -p Jira` and `-p Confluence`.
- Jira and Confluence are separate installations; both must be upgraded.
- Forge logs: `forge logs -e development`. Nothing is logged unless the code logs it, so the seed wrapper logs every failed call.
- Workflow validators need a COMPANY-MANAGED project. The demo space here is team-managed (`style: next-gen`), so the gate cannot be attached there.
- Changing the panel code needs only `forge deploy`; adding a scope also needs the install upgrade.

## More fixes found while verifying
| Symptom | Fix |
|---|---|
| A snoozed or dismissed finding vanished without a trace when other findings remained | the hidden count is now shown with the visible findings |
| A model-reworded edit could differ between what the panel showed and what Apply wrote | Apply sends the edit the person saw and refuses if the rebuilt edit differs; model answers are also cached 24 h |
| Forge CLI 15 refused Node 24.14 | needs Node >= 24.22.1 (installed 24.22.2 with nvm and use `nvm use 24.22.2` before any forge command) |

## More facts
- New module types need an approval too: `llm` triggers MAJOR_VERSION_RULE (deploy with `--approve MAJOR_VERSION_RULE`, then `forge install --upgrade` for Jira and Confluence).
- A panel loaded in Jira never saw an R1 finding for a page created AFTER the last status change. That is the rule working: R1 needs the page to be older. To stage a stale page, create the page first and move the epic afterwards.
- Workflow validators: Jira settings > Work items > Workflows > Edit > select the transition > Validate details > add. The rule appears by the manifest `name`, also under "Marketplace rules".
- Team-managed projects cannot use it; create a company-managed project (`projectTemplateKey: com.pyxis.greenhopper.jira:gh-scrum-template`).
- The Forge LLM costs money billed to the developer. `src/llm.ts` caps it at 40 calls per day per installation.
| Demo seed put the epic in the first project it found (a service-desk project cannot hold an Epic; on the demo site it also landed in someone else's "Mobile Dev") | the project the panel is opened in wins when it is a software project; otherwise only software projects are searched |

## Still unverified (from round 1; see round 2 below for what changed)
- The Atlassian MCP path used by a third-party client (OAuth from, say, Claude.ai against `https://mcp.atlassian.com/forge/<appId>`): needs an org admin to enable external access and a client to authenticate. The same actions work through the Rovo agent.
- Rovo agents on the original dev site: that org shows no Rovo chat entry. The fresh demo site has Rovo and works.
- Running the app as someone other than its developer (consent for a second user, a site where the installer is not the app owner).
- Marketplace listing, privacy policy, terms, install guide, demo video, customer evidence.
- Distribution: the console says "Not sharing". Set it to Sharing (Edit on the Distribution page) with Jira and Confluence ticked, and fill company, support contact, privacy policy, terms. An app listed on Marketplace can no longer use installation links, so decide before submitting.

---

# Round 2 (2026-11-05, later): the 15 gaps, worked through

Everything below was run on the real dev site, and on a fresh demo site for the production build, unless marked otherwise.

## Done and verified live
| Gap | What was built | Verified how |
|---|---|---|
| Gate leaks page text | the gate asks Confluence whether the PERSON MAKING THE TRANSITION can read each page (permission-check API) and withholds title and line unless the answer is a clear yes; fails closed | blocked message quoted evidence for a reader; the endpoint answered `hasPermission:true` for the owner and 404 for an unknown user; unit tests for no checker, a throwing checker, partial visibility |
| Evidence was a text list | "Page says / Jira says" columns, the stale token highlighted, a lifecycle bar (Detected, Fix proposed, Applied), "Found by rules - no AI" on every finding | screenshot of the live panel |
| Stuck first run | "Save target version" form (stored as a Jira issue property the engine reads first), and guidance that depends on what is actually missing | typed v2 on SCRUM-1; property confirmed through the REST API |
| Messy pages | table cells separated; code-macro text read; Apply edits just the changed token when the line is split by inline formatting (smallest context that matches exactly once, else refuses); a URL may change by its version only | 10 unit tests; a live table-cell Apply changed only that cell |
| Only three rules | R4 (a page says a work item is planned or shipped while Jira says otherwise) and R5 (a doc line like `DELETE /api/v2/charge/42` against an OpenAPI 3 JSON spec held in a linked page: deprecated operations block, unknown operations warn) | both fired on a live epic; R5 shows the "Spec says" column |
| Fix one line, the rest vanish | R1 now says how many OTHER lines on the page also name an old version, and the Apply message warns that the page now counts as edited | unit test |
| Ledger not connected | each Apply is sealed into the hash chain and its hash anchored on the Jira issue (`same-page.lastReceipt`); Audit trail view re-verifies on request; `scripts/verify-receipt.mjs` re-verifies a receipt offline | entries #0 to #3 written live; "Chain intact"; the anchor matched; tampering caught in tests |
| One-time only | pin guard: after Apply, the page is pinned (a content property on the page); when a pinned page is edited and the old version is back, the app comments on the work item (no page title or text in the comment) | edited a pinned page live; log `checked 1, alerted 1` and the comment appeared |
| No measured value | per-installation counters (shown, applied, dismissed, snoozed, review tasks, gate blocks) in the Audit trail, plus pilot-kit.md | counters visible live |
| No scale test | `test/scale.test.ts`: a 3 MB page, pathological text, a 5,000-operation spec against a 5,000-line doc, a 200-issue release with bounded requests | found and fixed a 4.7 s slow path (now 31 ms) |
| No live testing, no off switch | `scripts/live-gate-check.mjs` (REST-only end-to-end check of the gate), `SAME_PAGE_KILL=1` environment variable that allows every transition, timing in every gate log line | the script parses; it needs an API token to run, so it was NOT run by the assistant |
| Gate admin help | message says where to look and how to override; gate-setup.md | text verified in a real blocked transition |

## Bugs the real sites exposed this round
- Forge storage is PER INSTALLATION and Jira and Confluence are separate installations: a value written in Jira (Apply) is invisible to a Confluence trigger. Anything shared between the two must live in a product object (the pin lives on the page).
- The Confluence v1 content-property endpoint answers the APP with HTTP 410; the v2 properties API works.
- Content properties need their own scopes (`read:confluence-props`, `write:confluence-props` and the granular names), the permission check needs `read:confluence-content.permission`. Missing scopes surface as "Authentication Required".
- The validator event carries `user.accountId`; that is what makes a permission-aware message possible.
- `forge deploy` + two `forge install --upgrade` can take several minutes; run them in the background.

## NOT done, and why
- **Real-world accuracy and a pilot**: no real team has used it. pilot-kit.md is how to get one. The 1.00 precision is still on fixtures written here.
- **Team-managed reach (Jira automation action)**: researched, not built. An automation rule runs after the transition, so it could comment or revert but not block, and the action needs its own config screen.
- **Environment-name rule** and **"linked ticket is closed" rule**: not built (they need data the demo epics do not carry and extra lookups).
- **Attached files**: R5 reads an OpenAPI JSON spec that is IN a linked Confluence page (a code block). Attachments and YAML are not read.
- **A decorative "AI phrasing off" switch**: not built on purpose. Detection never calls a model; only an ambiguous line (for example `v1.4`) does, and it is labelled "AI-suggested".
- **Third-party MCP**: unchanged, unverified. The Rovo agent runs end to end.

## 2026-11-06: new features on the development site (app version 7.12 to 7.15)
Observed on a real Jira and Confluence site, in a team-managed project, with a test work item (SCRUM-5, description "Access token expiry should be 1 hour") linked to a test page ("Access tokens expire after 30 minutes."):
- **R8 on a work item with no target version.** The panel showed one Warning, "R8 Duration differs: Page says access token expire is 30 minutes, but SCRUM-5 says 1 hour", with both lines side by side, "No automatic edit" and the two ways to resolve it, and "ran 8 of 10 rules" with "Did not run: R1 and R4 (no status change recorded yet)". After the status change it read "ran 9 of 10".
- **Rules list.** It listed the rules with their severities and, because the viewer is a Jira administrator, offered "Make it a blocker". Changing R8 to Blocker showed "(changed on this site)", and changing it back removed that text.
- **Soft gate.** With R8 set to Blocker, moving SCRUM-5 to Done made the app post one comment: "Same Page: this work item was moved to Done while 1 blocking contradiction with its docs is still open (R8 Duration differs)… This is a notice, not a block." It named the rule and a count, no page title or text. The log line read `same-page soft gate SCRUM-5: commented`.
- **Weekly scan.** The scheduled function ran on its own after deploy: `same-page drift scan: 4 items, 0 not checked`.
- **Real payloads.** Four responses from this site (changelog, remote links, page, search) were captured, redacted and now back the contract tests.

Not observed: R9 and R10 on a real site; the project brief and rules list agent actions; the new demo data (this site already held demo state, so seeding resumed instead of recreating); the soft gate in a company-managed project; the Rules tab as a non-administrator; the weekly summary line on the overview page; production.
The test work item and page remain on the development site.

## 2026-11-06: custom rules, evidence id and handling events (app version 7.16 to 7.17)
Observed on the same development site, as a Jira administrator, on SCRUM-5:
- **A bug the live site exposed.** Typing quickly into a text field kept only the last character, because the field was re-rendered from app state on every keystroke. This also affected the dismiss-reason and target-version fields. All text fields are now uncontrolled; after the fix the full text stayed in the three custom-rule fields.
- **Custom rule, end to end.** The "Your team's rules" form appeared. A rule ("Token docs live test": page says "access tokens" while status is not "Never") was previewed ("On this work item, this rule would raise 1 finding (1 linked page read). Nothing was saved."), saved, and then showed as a second Warning labelled "Custom rule" next to the built-in R8 finding. Empty or too-short input showed a plain error. The rule was then deleted and the list returned to "No team rules yet."
- **Evidence id.** Each finding in the panel showed "Evidence id: #xxxxxxxx" (for example #a45e3483). The gate refusal carries the same short id; that match is covered by a test, and was not re-run live in this session.
- **Handling events.** The audit trail read "Chain intact" with "5 sealed entries" and listed the new event types. DISMISSED, SNOOZED and REVIEW_TASK events were not triggered live.
Not observed: the weekly scan's "resolved" count, the project brief's weekly delta, custom rules in the gate or the soft gate, and a non-administrator seeing the saved rules read-only.

## 2026-11-06: overview impact card and "run the scan now" (app version 7.18 to 7.19)
Observed on the development site, as a Jira administrator, on the project overview page:
- **Impact card.** "What Same Page has done on this site" showed "6 contradictions found · 0 fixed on the page · 0 sent to a page owner · 0 dismissed · 0 transitions refused", with no hours figure and the sentence that none is guessed. The minutes field appeared because the viewer is an administrator. The minutes were not saved.
- **A gap the live site exposed.** The overview said no weekly scan had run, although the log showed the scheduled scan running. Scheduled triggers run once per installation and storage is per installation, so the scan's result had been saved in the other product. Fix: an administrator-only "Run the weekly scan now" button saves the result where the overview reads it.
- **Run the scan now.** After clicking it the page read "Weekly scan (11/6/2026): 1 of 2 checked open epics had contradictions". The first scan then said "1 new and 0 resolved since the scan before", which was misleading for a first scan; it now says it is the first scan, covered by a test, not re-run live.
Not observed: the three new Rovo agents and the three new actions (no Rovo on this site), the minutes estimate being saved, and the "resolved" count on a second scan.

## 2026-11-06: the three new Rovo agents, on the production build (demo site)
After the production deploy, on the demo site (Jira and Confluence at major version 3), in Rovo chat, as the site owner:
- **Listing.** Searching agents for "Same Page" listed all four: Same Page, Same Page release check, Same Page audit trail and Same Page rule coach.
- **Rule coach.** "What do the ten Same Page rules check?" returned all ten rules with a plain description each, and a "Site Health & Tuning" part: all rules at default severity, no recorded actions or dismissals, none noisy, and the pointer to Same Page > Rules for changes. It used the site's own data.
- **Release check.** "Is project MOBL ready to ship?" answered "not ready": MOBL-58 Blocked with 2 findings, one clean item, and 18 items listed as not checked with reasons (4 unreadable pages, 2 with no related page, 12 not reached before the request budget ran out). It said an unchecked item is not a clean item.
- **Audit trail.** "What has Same Page done on this site, and what happened to the contradictions on MOBL-58?" answered that the site has found 2 contradictions, none fixed, sent or dismissed, and that there are no recorded handling events for MOBL-58 (the new build had not been used on that work item yet).
A limit this showed: on a project with many open items the release check reaches only the first items before its request budget (60 requests) runs out, and says so. We have not tuned that budget.
Not observed: an agent answering with real handling events, and how Rovo chooses between the four agents when the user does not pick one.

## 2026-11-06: "real or false alarm" marks (app version 7.21)
Observed on the development site on SCRUM-5: each finding showed "Was this a real contradiction?" with "Yes, it is real" and "No, false alarm". Clicking the first changed it to "Marked real" at once, and after "Check again" it still read "Marked real", so the mark was saved. This test mark is on the test work item and counts as 1 real on that site.
Not observed: the overview line with the review summary, changing a mark, and the agents reporting the counts.
Also changed, not observed live: the release check's request budget went from 60 to 100 (time limit 22 seconds, so it still fits the default function timeout). Forge's linter does not allow a longer timeout on action functions.

## 2026-11-06: release check after the larger budget (production, demo site)
After deploying the 100-request budget to production, the same question ("Is project MOBL ready to ship?") on the demo site reached all but 2 of the 20 items. Before the change, 12 were not reached. The answer: "not ready", MOBL-58 Blocked with 2 findings, one clean item, 8 items with unreadable pages, 8 with no related page, and 2 (MOBL-12, MOBL-9) not reached before the request budget ran out.
One wording problem: the tool returned `status: ready` for "the scan finished", and the agent repeated that next to "not ready", which read as a contradiction. The tool now returns `status: scan complete`; that change is covered by tests and has not been deployed.

After the `scan complete` wording change was deployed to production, the same question on the demo site gave the same coverage (18 items not checked: 8 unreadable pages, 8 with no related page, 2 not reached before the budget ran out; MOBL-58 Blocked; MOBL-2 Clean) and the answer opened with "A scan of the project's open items revealed significant documentation contradictions and coverage gaps". The earlier sentence that read "ready" beside "not ready" no longer appeared.

## 2026-11-06: change notice and link a page (app version 7.22)
Observed on the development site on SCRUM-5:
- **Change notice.** After the description was edited to "Access token expiry should be two hours" (the page says 30 minutes), the app posted one comment: "Same Page: after this edit, 1 contradiction with the linked docs is still open (R8 Duration differs)… This is a notice, not a block." It named the rule and a count, no page text. The finding also shows number words work: "two hours" was read as 2 hours.
- **Link a page.** An address on another site was refused ("Only pages on the demo site can be linked here."). A real page address was linked, and the panel then read "Read 2 linked pages". The test link stays on SCRUM-5.
Not observed: rule export and import, the tuning suggestions (they need at least 5 marks on a rule), and the notice staying quiet on an unrelated edit.

## 2026-11-06: gate mode and the pilot report (app version 7.23)
Observed on the development site as a Jira administrator: the Rules list showed a Gate mode section. Choosing Watch only changed its text to "Watch only: the gate allows every transition and only counts the ones it would have refused…", and choosing Enforce changed it back ("Enforcing: the gate refuses a transition while a blocking contradiction is open…"). "Show the pilot report" printed "Same Page pilot report (2026-11-06)" with the site's real counts ("Contradictions found: 6").
Not observed: a real transition refused or allowed under watch only (the offline test covers the logic, and the validator needs a company-managed project), and the report's per-rule marks.

## 2026-11-06: the fact registry (app version 7.24 to 7.25)
Observed on the development site, as a Jira administrator: the Rules list showed "Facts everyone should agree on". The fact "access token expiry" is "1 hour" was added. "Check the whole site now" then returned "access token expiry = 1 hour: read 2 pages, 2 disagree, 0 lines agree", listing the linked test runbook ("Line 1 says 30 minutes") and a starter guide that had been created for the test and never linked to any work item ("Line 2 says 2 hours: Access tokens last 2 hours").
A bug the live site exposed: the first run found only the linked runbook, because the search required the word "expiry" on every page and the guide says "lasts". The matcher already treats those as one idea; the search now leaves such words out and narrows by the nouns. Covered by a test.
Not observed: the agent action `canon-check`, the demo data declaring the fact on a fresh site, and a non-administrator trying to run the check (it is refused by design).
The declared fact and the unlinked test page stay on the development site.

After the fact registry was deployed to production, on the demo site in Rovo chat, the "Same Page rule coach" agent was asked "Which pages disagree about our declared facts?". It called the new `canon-check` action and answered honestly that no facts have been declared on that site yet, and told an administrator where to add them. This checks the action is wired in production and its empty case. The case with a declared fact was observed in the Jira panel on the development site, not through the agent.

## 2026-11-06: redesigned panel and overview (app version 7.26 to 7.30)
Observed on the development site, light interaction only:
- **Panel.** A status banner ("1 contradiction found" with a warning icon and the next step) sits above four tabs (Findings (1), What was checked, Rules and settings, Audit trail). Each finding is a card: severity lozenge and icon, rule tag, a "Start here" marker on the first, a bold summary, the primary action directly under it, "Page says" beside "Jira says" on a tinted panel, then secondary actions in a quieter style and an evidence tag. Settings, forms and the rule list are out of the way until their tab is opened.
- **Audit tab.** Opened by itself when selected and showed "Chain intact", counts as tags, and a table of events ("What happened", "Rule", "Work item", "Seal") instead of a block of code.
- **Overview.** Four stat tiles (Blocked, Warning, Clean, Not checked), a summary banner, a verdict table at full page width, and a second tab for what Same Page has done on the site.
Not observed: the new layout on a very narrow window, a screen reader run, and the clean-state "All clear" screen (this site has a finding).

## 2026-11-06 and 07: break glass, draft stage, playground, diff-style evidence (app version 7.32 to 7.33)
Observed on the development site as a Jira administrator:
- **Diff-style evidence.** The finding card showed "Page says" on a red panel beside "Jira says" on a green panel, and a line "Which side first: The page was last edited today."
- **Draft stage.** Each rule row has Draft, Warning and Blocker buttons. Setting R8 to Draft made its finding disappear ("No contradictions found / All clear"), and the Rules list said "Draft: this rule runs but shows nothing and cannot block. It would have raised 1 finding on this site." Setting it back restored the finding.
- **Break glass, end to end on the Payments project (company-managed, gate attached).** Moving PAY-3 to Done was refused with "Same Page blocked this transition: PAY-3 has 2 provable contradictions… Rule: R5 API spec mismatch · evidence #678086a8… Next: open Same Page…". After break glass was granted from the panel (an empty reason was refused first), the same transition succeeded (HTTP 204, log "ALLOWED by break-glass override") and PAY-3 was moved back to In Progress. After Revoke, the Done transition was refused again.
- **A bug this found and the fix.** The first Revoke did nothing: Forge storage rejects a `null` value ("Provided request body is invalid"), and the code stored `null`. The same mistake had silently stopped the gate cache from being cleared after a fix (the live re-check had hidden it) and would have stopped clearing the minutes-per-fix estimate. All three now store an expired or empty marker, and tests use a store that rejects `null`.
- **Playground.** With the sample work item "Migrate Payment API to v2. Access token expiry should be 1 hour" and the sample page "Call POST /api/v1/charge. Access tokens last half an hour." it listed R1 Stale version and R8 Duration differs, and the note that nothing was read or saved.
Not observed on a real site: severity chips (this item has a single severity), the patch preview with context lines (no version finding on this item), YAML specs, legacy-section skipping, the audit export button, the warm gate cache, and a non-administrator trying break glass.
PAY-3 is back in In Progress; test overrides were revoked. SCRUM-5 and PAY-3 test data remain.

## Severity chips, audit trail and audit export (dev site, Nov 6)

| Check | Observed |
|---|---|
| Severity chips on PAY-3 | "All (3)", "Blockers (2)", "Warnings (1)"; choosing Warnings showed only the R4 card |
| Audit trail | "Chain intact", 9 sealed entries; break-glass entries now read "Break glass granted" and "Passed through break glass" under "Transition gate" (before the fix they read "Recorded / Rule") |
| Audit export | The panel's export text, copied from the live page, passed `node scripts/verify-export.mjs` (9 entries, head f360b40b9aaa…). Changing one field of entry 6 made it fail with "BROKEN at entry 6: entry was altered" |
| Leftover test override | A break-glass override from an earlier test was still active on SCRUM-5; it was revoked from the panel |

## 2026-11-07: the two new Rovo agents, on the production build (3.11.0, demo site)
Rovo chat, as the site owner. All six agents were listed when searching for "Same Page".
- **On-call check.** "Can I trust the runbook for MOBL-58 right now?" answered "Contradiction found for MOBL-58." with two findings, each with the page line next to what Jira says: the Payment API Runbook line "Call POST /api/v1/charge with the order id." against a v2 target, and the ADR-12 page marked deprecated while MOBL-58 is In Progress. A flaw: it ended with "No contradiction found means only that the fixed rules found nothing…", which belongs to the other answer. The prompt now says to add that caveat only for a "no contradiction found" answer (fixed in the manifest, not yet re-run in Rovo).
- **Docs owner.** "Which pages disagree with MOBL-58, and what do I fix first?" answered page by page (ADR-12, then the Payment API Runbook), each with the disagreement, what Jira says and the recency (for the runbook: Jira was updated about three seconds after the page was last edited), told the owner to use the Same Page panel to apply or hand off a fix, and said all relevant pages were checked. A flaw: it did not rank the pages and only offered "Which page should I fix first?" as a follow-up. The prompt now says how to order them (a blocker first, then most findings, then most recently edited), not yet re-run in Rovo.
Not observed: how Rovo chooses among the six agents when the user does not pick one; the two prompt fixes in Rovo.

## 2026-11-07: both agents re-run after the prompt fixes (production 3.12.0, demo site)
- **On-call check.** "Can I trust the runbook for MOBL-58 right now?" answered "Contradiction found. Treat the linked pages for MOBL-58 with care." with the two findings (the Payment API Runbook line "Call POST /api/v1/charge with the order id." against a v2 target, and the ADR-12 page marked deprecated while MOBL-58 is In Progress). It no longer adds the "no contradiction found means only…" caveat after reporting a contradiction. The earlier flaw is fixed.
- **Release check.** "Is project MOBL ready to ship?" answered "Project MOBL is not ready to ship", named MOBL-58 as Blocked with two contradictions, listed 7 items with no related page and 3 not reached before the check budget ran out, and said only MOBL-2 was verified clean. It kept unchecked items separate from clean ones.
- **Latency.** The release check took about 90 seconds to start answering, because it scans the whole project. A single-item question to the on-call agent answered in about 20 seconds.
- **The docs owner's ordering fix** (blocker first, then most findings) was not re-run.
- **Duplicates in the agent picker.** Searching "Same Page" listed some agents twice with different icons, for example two "Same Page on-call check" entries and two "Same Page" entries. The cause is not known; it may be one copy per installation (Jira and Confluence). The first entry was used and worked. This is not understood yet.

## 2026-11-07: agent picker, an invented-link bug, and the docs owner re-run (production 3.12.0, demo site)
- **Duplicates in the picker.** Searching "Same Page" lists every agent twice (the general agent and the docs owner were both confirmed as pairs). The two "Same Page" entries have the same description and the same starter questions and differ only in icon. The app is installed in two products (the Forge installations list shows one Jira and one Confluence installation per environment), and the likely cause is that Rovo lists each agent once per installation. That is an inference, not something Atlassian's documentation was checked for. Both copies of the general agent answered "Do the docs for MOBL-58 contradict the ticket?" with the same two findings. The other agents were tried on the first copy only.
- **An invented link.** The second copy of the general agent answered with links to `.../wiki/spaces/PAY/pages/12345` and `.../pages/67890`, and Rovo showed "Can't find link" beside each. Our tools return page titles, not links, so the model made the ids up. Fix: every agent prompt now says to name pages by title only and never to write a link, URL or page id a tool did not return, and a test checks the sentence in all six prompts. It is on the development site (7.47.0) and not yet on production, so it is not re-checked in Rovo.
- **Docs owner ranking.** After the prompt fix the docs owner answered "Which pages disagree with MOBL-58, and what do I fix first?" with a "What to fix first" section that names ADR-12 first and gives a reason. The reason ("has a blocking finding" and "most recently edited") is partly loose, since the runbook finding is also a blocker, but the order and the pointer to the Jira panel are right.

## 2026-11-07: patch preview, legacy sections and YAML specs on a real site (development site, SCRUM-2)
Two test pages were created in the dev Confluence and linked to the epic SCRUM-2 as web links: a runbook with a live `v1` call line and a "Legacy" section holding another `v1` line, and an OpenAPI spec in YAML inside a code macro. Both are titled "(live test, safe to delete)".
- **YAML spec.** With a `servers` entry of `/api/v2`, the runbook line `DELETE /api/v2/charge/42` raised R5 against the spec's deprecated `DELETE /charge/{id}`. Without the `servers` entry it raised nothing, which is the intended quiet behaviour: nothing says the spec's path lives under `/api/v2`. The spec text reached the rules with its indentation intact.
- **R1 and its preview.** R1 stayed silent while the runbook also mentioned `v2` (a page that names the target version is not stale) and while the pages were newer than the epic's last status change (by design). After removing the `v2` mention and moving the epic To Do and back to In Progress, R1 fired with the title "Page documents v1 but SCRUM-2 targets v2" and a "Proposed change (nothing is edited until you click Apply)" block: the line above, the line "Now" with `v1` marked, the line "After Apply" with `v2` marked, the line below, and "Only this line changes, and only its version reference." Apply was not clicked.
- **Legacy section.** The `v1` line under the "Legacy" heading did not produce a "more lines still name an old version" note, so it was skipped.
- **Age hint.** The card said the page and the work item both changed today, around the same time, and told the reader to ask who owns each, instead of choosing a side.
- **Also seen.** The two R5 warnings for `POST /api/v2/charge` came from the older demo pages, because the quick test spec does not define that operation.
Still unseen on a real site: rule export and import, and the tuning suggestions.

## 2026-11-07: rule export and import on a real site (development site, PAY-3)
- A team rule was created in the panel ("Export round trip test", phrase "frozen for audit", status Done). "Show my rules as text to copy" printed `{"samePageRules": 1, "rules": [{"name", "template", "phrase", "value", "severity"}]}` with no rule id, as designed.
- A different rule written in that same format ("Imported copy test") was pasted into the import box. The first click on "Import these rules", made a fraction of a second after typing about 150 characters by automation, answered "That is not valid rule text". A second click a few seconds later imported it, and both rules were listed. The most likely cause is that the first click ran with the text from before the last keystrokes reached the app; a person who pastes and then moves the mouse does not hit that. It was not reproduced by hand.
- Both test rules were deleted afterwards, and the list read "No team rules yet."
Still unseen on a real site: the tuning suggestions.

## 2026-11-07: after the production deploy that added the link fix and the blocking question (demo site)
- **"What is blocking MOBL-58 from Done?"** to the on-call check. The new starter question "What is blocking SCRUM-2 from Done?" appeared on the agent's intro screen. The answer listed only the findings marked as blockers (the deprecated ADR-12 page and the runbook line that calls `/api/v1/charge` against a v2 target) and said they are what the Same Page transition gate refuses on when its validator is on that workflow and the gate is not in watch-only mode. It ended by telling the person to open the work item and use the Same Page panel to fix a page or hand it to the page owner. It gave no link.
- **The invented-link check.** The second copy of the general agent, the one that invented `.../pages/12345` and `.../pages/67890` earlier, was asked "Do the docs for MOBL-58 contradict the ticket?" It named both pages by title and wrote no link. Its answer also carried the receipt line, "Same Page checked 2 linked pages for MOBL-58 and found these 2 contradictions (evidence #88e18eb9, …", the first time the receipt has been seen in a Rovo answer.
- Not re-run: the release check on a whole project after this deploy.

## 2026-11-07: production 3.14.0 (demo site, MOBL-58)
After the production deploy with the two code-review rounds, the panel on MOBL-58 showed "2 contradictions found" with the R1 finding (the runbook's `/api/v1/charge` line beside "MOBL-58 targets v2"), and the Audit trail tab loaded with "Chain intact". It read "Nothing has been sealed yet" next to a counter of 2 findings shown: those findings were counted before handling events were recorded in the chain, so no event exists for them. Not checked on production: the as-non-administrator view of the Audit trail and the findings history tool for an issue the caller cannot see (one account; both are covered by offline tests).


## 2026-11-07, production redeploy (round 3 fixes)

Production was redeployed (Forge deploy at 15:27 UTC) and the install link was checked afterwards: it is unchanged and still follows the latest production deploy. On the demo site, work item MOBL-58:

- **Same Page on-call check**, "Can I trust the runbook for MOBL-58 right now?": answered "Contradiction found" and quoted both pages' lines next to what Jira says. It added no "no contradiction found" caveat.
- **Same Page release check**, "Is project MOBL ready to ship?": answered "not ready", named the blocked work item with both reasons, and listed 18 other items it could not verify. It took about 90 seconds.

## 2026-11-07, tuning counts on the dev site

On PAY-3 I dismissed the R4 finding with a reason. The finding count went from 3 to 2, the Audit trail added "#13 Dismissed, R4 Stale status claim, PAY-3" with the chain still intact, and the Rules tab showed "On this site: acted on 0, dismissed 1 (100% dismissed)" for R4. The "has been dismissed N of M times" hint needs at least 5 outcomes on one rule, so it was not reached here; that threshold is covered by the tests only, not by a live run.

## 2026-11-08, production redeploy (7.53.0, parallel checks), overview coverage

Production was redeployed with the change that checks up to three work items at once. On the demo project's Same Page overview (20 open items): 1 blocked, 1 clean, 18 not checked, of which 12 were "not reached before the time or request budget ran out", 4 had related pages the viewer cannot read, and 2 had no related page. This is the same result as before the change. The request budget, not time, is what stops the run, so the change did not increase coverage on this project. I did not run the release-check agent again.

## 2026-11-08, "Check the rest" on the overview page (dev 7.54.0)

Found by reading the code after the production check above: "Check again" re-ran from the first item every time, so on a project whose first run stops early, items after the first 8 could never be reached even though the page said to use Check again. The overview now continues from where it stopped ("Check the rest (N left)"). Observed live on the dev site: the page loads on the new build and shows 2 of 2 items checked with no continue button, as expected. The continue path was then observed on the production demo project after the redeploy (7.54.0): the first run left 12 of 20 items unreached and a single click on "Check the rest (12 left)" resolved all 12, with no item left as not reached. The final picture for that project is 1 blocked, 1 clean, and 18 not checked for real reasons (10 with related pages the viewer cannot read, 8 with no related Confluence page). So the fix removed the false "not reached" rows, but it does not make more of that project checkable: most of its items have no readable page.

## 2026-11-08, on-call agent re-check on production (7.54.0) and starter prompts

Asked the "Same Page on-call check" agent "Can I trust the runbook for MOBL-58 right now?" on the production demo site. It answered in about 20 seconds with "contradiction found": the runbook says to call POST /api/v1/charge while Jira says MOBL-58 targets v2, and ADR-12 is marked deprecated while Jira says MOBL-58 is In Progress. The agent picker still lists two entries for each Same Page agent (one per product install); this is not fixed.

Found while doing this: the agents' suggested starter prompts named SCRUM-1, SCRUM-2, SCRUM-3 and project SCRUM, which do not exist on most sites, so a first click on a starter would ask about work items that are not there. They now say "this work item" or "this project" (7.55.0, deployed to development only). Production was then redeployed (7.55.0) and the new starters were clicked on MOBL-58: "Can I trust the runbook for this work item right now?" (on-call agent) answered "contradiction found" with the runbook line and what Jira says, and "Is this project ready to ship?" (release-check agent) answered that the project is not ready, with one item having critical contradictions and 18 items that could not be verified (permission issues and no related page), in under 30 seconds on this run. Neither agent asked which work item or project. Only these two starters were tried; the others were not.

## 2026-11-08, three new agents on production (7.56.0)

Added a developer check, a team digest and an incident review agent (nine in total) and ran each once on the production demo site, on MOBL-58, using one of its starter prompts. Developer check ("Which docs contradict this work item before I start?"): "Contradiction found", with both findings, the page line, what Jira says and the rule id for each. Team digest ("Give me a digest of this project against its docs"): 2 items checked, 1 with contradictions, 18 not checked (8 with related pages the viewer cannot read, 8 with no related page, 2 not reached before the budget ran out), "no weekly scan yet", and the handling counts (2 found, 0 fixed, 0 sent, 0 dismissed, 0 transitions refused); these match the overview page, except that the digest's scan reached two fewer items than the overview's second run. Incident review ("Which docs contradicted this work item, and was it ignored?"): both contradictions with their lines, and "no recorded history for this work item", which is true because nothing has been dismissed or handled on MOBL-58. None of the three claimed a cause or said which side was right. Not tried: the other starters of each agent, and the team digest with a weekly scan present. The picker now lists eighteen Same Page entries (two per agent).

## 2026-11-08, release check by fix version (dev 7.57.0)

Added an optional fix version to the project check, so a release owner can ask about one Jira release instead of a whole project. Deployed to the development environment only; the dev site has no Rovo, and production is still on 7.56.0. Covered by tests (query building, rejection of unsafe version names before any search, Jira's 400 for an unknown version turned into a plain message, the weekly scan left out next to a single release, the agent prompt). Not yet seen live: that Rovo passes the version name to the action, that the MCP tool accepts the new input, and what the answer looks like on a real release.

### Release by fix version, observed on production (7.57.0)

On the production demo site, with the release check agent, MOBL-58 open as context:
- "Is release Version 1.0 of project MOBL ready to ship?" ("Version 1.0" is the only fix version in the MOBL project and holds 7 open work items). The agent passed the version through and answered "Could not be checked": none of the 7 open items could be verified against documentation, listing MOBL-14, 15, 16, 17 and 27 as having related pages that are not readable with the viewer's permissions, and MOBL-13 and MOBL-18 as having no related page. It did not call the release ready.
- "Is release Version 9.9 of project MOBL ready to ship?" ("Version 9.9" does not exist). The agent answered "Could not be checked": no open work items were found for that release (or none visible), so no readiness verdict could be given. Jira's search returned HTTP 200 with an empty list for the unknown version, not a 400, so the tool's "Jira has no such version" message did not fire; the empty-result wording was used instead.
Not tried: a version whose items have readable pages and contradictions; the MCP tool with the new input; more than 20 open items in one version.

## 2026-11-08, demo data added to the Same Page demo project

The MOBL sample items link to Confluence pages on another site, so most of them showed "not checked" (see the Check the rest entry). To make the overview show real results, six work items and six pages, all labelled "(Same Page demo)", were added to the Same Page demo project (SPD-2 to SPD-7) through Jira and Confluence's REST APIs, in the same way the app's own demo-data button creates its page and epic (links are web links to the page address). They are demo data, not usage by anyone: they exist to show the rules working. Before creating them, the same texts were run through the rules offline and the predicted findings were written down; the live overview then showed the same result: 2 blocked (a stale API version, a deprecated decision on active work), 3 warnings (a session timeout, a release date and a rate limit that differ between the work item and its page), 1 clean, 0 not checked. One item first showed 2 findings because its title shared words with the older ADR-12 page; its title and its page were renamed (both created minutes earlier) and it then showed 1. Nothing that existed before was changed or deleted. Not tried: the second-person permission check (see the internal kit), which still needs another account.

## 2026-11-08, install page and usage check (read-only, in the developer's browser)
- **Install page.** The install link loads and shows "same-page, by Siddhartha bhattarai (Individual)", installed for Jira and Confluence, the privacy and security notice, a support contact, and 18 permissions (Jira work and user data, Confluence content, search, labels, properties and permissions, and app storage). The Install button was not clicked. The permission list matches the manifest, and no scope has been added since the fresh-site install recorded on 2026-11-05 (two modules were added after it: the project overview page and the weekly scan, which need no new consent). A new install on a never-used site was not repeated today.
- **Developer Console.** Distribution status "Sharing"; not listed on the Marketplace; 4 installations (Jira and Confluence on each of two sites); no billing or payment warning on the app's pages.
- **Usage and charges (1 to 8 November).** Extra usage charges $0 and forecast $0. Functions used 0 of the 200,000 GB-seconds included. One line was not zero: Forge LLM input 3,720 credits and output 780 credits, all on 5 November, which is the day the optional model-written fix was tested (see the entry above). Nothing since, no environment variables are set in either environment, and the charge shown was $0. The model path stays off.

## 2026-11-09, design round on the overview, the clean state and the Confluence byline (dev 7.59.0 to 7.61.0)
What was looked at, in the developer's browser, and what changed:
- **Overview.** The table gave "1 finding" per row and listed items in Jira's order, so a reader had to open each item to learn what was wrong. Rows are now sorted worst first, each shows a one-line headline, and there are filter buttons. Seen live on the dev site: "Show: All (2) | Blocked (1) | Clean (1)" and the blocked row carrying "Page documents DELETE /api/v2/charge/42, but the API spec marks DELETE /charge/{id} as deprecated".
- **Clean state.** On a clean work item the green banner said "No contradictions found" and the empty tab repeated it as "All clear", which also overstated what the rules prove. It now says "Nothing to fix" with the caveat. Seen live on dev.
- **Confluence byline.** On a demo page linked to a work item with a blocker the byline said only "Same Page: not checked". The cause was not a bug: the byline checks work items named in the page's own text, and the demo pages did not name theirs. The label now says "names no work item" with a tooltip explaining what to do (seen live on dev). The six demo pages in the Same Page demo project now name their work item.
- **A regression found and explained.** After the demo pages were edited to name their work item, SPD-2 changed from Blocked to Clean. Rule R1 only fires when the page is older than the work item's last status change, so editing the page correctly made it step aside. Moving SPD-2 through To Do and In Progress again restored the Blocked result (overview back to 2 blocked, 3 warnings, 1 clean, 0 not checked). The practical rule for demo data: edit pages first, then make the work item's last transition.
- **Not done:** light mode was not looked at (the theme switch did not take effect in the automated browser session), and the 18 picker entries are unchanged. Production is still on 7.57.0, so none of the changes above are in production yet.
