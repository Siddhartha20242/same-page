# Same Page: start here

Same Page is a Forge app for Jira and Confluence. It finds contradictions between a Jira work item and its linked Confluence pages that it can prove with fixed rules (no model decides), shows both lines side by side, and offers a verified one-line fix that a person applies. It can also stop a Jira transition while a contradiction is open.

Pick the path that matches why you are here. Each path is short.

## "I want to see what it does" (5 minutes)

1. Read the one-page picture in the [README](../README.md#what-it-is) (two screenshots).
2. Follow [Try it](../README.md#try-it) to install it and open a finding.
3. See what was seen on a real site, with dates, in [live-results.md](live-results.md).

## "I want to know if it is trustworthy"

| Question | Read |
|---|---|
| Why is no model used for detection? | [README: Why detection has no model](../README.md#why-detection-has-no-model) |
| What data does it read, keep and send? | [security.md](security.md), [privacy-policy.md](privacy-policy.md) |
| What does it do when something fails or is too big? | [limits.md](limits.md) |
| How accurate is it? | [public-data-probe.md](public-data-probe.md) (hand-labelled, with its false positives) and [impact.md](impact.md) (what is not yet measured) |
| What do the tests cover? | [tests.md](tests.md) |
| Where do I look for each judging criterion? | [judging-map.md](judging-map.md) |

## "I run Jira or Confluence for a team"

| Question | Read |
|---|---|
| How would my team adopt it? | [business-case.md](business-case.md), [pilot-kit.md](pilot-kit.md) |
| What is the agent firewall idea? | [firewall.md](firewall.md) |
| What else is on the Marketplace? | [alternatives.md](alternatives.md) |
| What is the three-minute demo? | [demo-script.md](demo-script.md) |
| How accurate is it, honestly? | [accuracy.md](accuracy.md) |
| How do I attach the gate to a transition? | [gate-setup.md](gate-setup.md) |
| We must explain decisions to auditors | [regulated-teams.md](regulated-teams.md) |
| Is it usable with a keyboard and a screen reader? | [accessibility.md](accessibility.md) |

## "I want to use it from an agent or my own tools"

| Question | Read |
|---|---|
| What can the five Rovo agents do, and what was verified? | [agent.md](agent.md) |
| How do I call the checks over MCP? | [mcp.md](mcp.md) |
| How would I add my own rules or sources? | [extending.md](extending.md) |

## "I am reviewing the project"

| Question | Read |
|---|---|
| What exists already, and how is this different? | [prior-art.md](prior-art.md) |
| Is it feasible on Forge? | [feasibility.md](feasibility.md) |
| What changed, and when? | [changelog.md](changelog.md) |
| How is it deployed? | [deploy.md](deploy.md) |
| Terms of use | [terms.md](terms.md) |

## The ideas in one minute

- **A ticket states facts and pages repeat them.** A page that says `/api/v1/charge` next to an epic that targets `v2` is a contradiction a person can be harmed by.
- **Fixed rules decide.** The same inputs always give the same finding, so a block can be explained and repeated. Ten built-in rules cover stale versions, deprecated decisions, missing fields, stale status claims, API spec mismatches, closed tickets cited as open, pages that disagree with each other, and differing durations, limits and dates.
- **A person approves.** A suggested edit is offered only after checking it changes nothing but the stated reference, and nothing is edited until someone clicks Apply.
- **Everything is recorded.** Findings and decisions are sealed in a hash chain that anyone can verify.
- **Agents can ask before they act.** The same checks are Rovo actions and MCP tools, so a person or an agent can check a runbook before following it.

## What is not claimed

No real team has used it yet, so accuracy on real documents is unmeasured. Every finding carries "real" and "false alarm" buttons so that a pilot can measure it. See [impact.md](impact.md) and [limits.md](limits.md).
