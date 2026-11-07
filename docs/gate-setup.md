# Setting up the pre-ship gate

The gate stops a Jira transition (usually to Done) while a work item's linked Confluence docs contradict it. It is a Jira
workflow validator named **Same Page contradiction check**. Verified on a real site; every step below was done by hand once.

## What you need
- A **company-managed** project. Team-managed projects cannot use workflow validators. (The project key in Jira's project list is
  "classic" in the REST API; a team-managed one says `next-gen`.)
- Jira administrator rights, because workflows are edited in Jira settings.
- Same Page installed on Jira AND Confluence (`forge install` for each product, or the installation link).

## Steps
1. Jira settings (gear icon) > **Work items** > **Workflows**.
2. Find the workflow your project uses, open its **Actions** menu, choose **Edit**.
3. In the diagram, select the transition you want to guard. For Scrum and Kanban projects there is usually an
   "Any status -> Done" transition.
4. In the side panel open **Validate details** and click **+**.
5. Pick **Same Page contradiction check** (it is also listed under "Marketplace rules" as `same-page`). It needs no configuration.
6. Click **Add**, then **Update workflow**. Jira says it may take a moment to apply.

## What people see
- If the work item's docs contradict it, the transition is refused with a message that names the rule and, **only if the person
  making the transition can read the page**, the page title and the line. For a restricted page it says "A linked page you cannot
  view contradicts this issue; its details are withheld."
- They can fix the page, or open **Same Page** from the work item's apps menu (puzzle icon under the title) and **Dismiss** the
  finding with a written reason. A dismissed finding no longer blocks.
- The gate **fails open**: if anything goes wrong (timeout, error, nothing to check) the transition is allowed.

## What it checks and what it does not
- It needs a target API version on the work item. Put it in the summary ("Migrate to v2"), a component, or set it from the panel
  ("Save target version").
- It checks the pages linked to the work item (web links to Confluence pages) and pages found by search.
- It blocks only on `block`-severity findings (R1 stale version, R2 deprecated decision page). Notes about possibly intentional
  history never block.

## Turning it off
Remove the rule in the same workflow editor (Validate details > the rule > delete), then **Update workflow**.

## Try it without risk: watch only
Before you let the gate stop anyone, open the **Rules and settings** tab in the Same Page panel (as a Jira administrator), then **Gate and pilot**, and choose **Watch only** under Gate mode. The validator then allows every transition and only counts the ones it would have refused; the overview shows "N would have been refused in watch-only mode". After a week or two, review those and the findings behind them, then choose **Enforce**. Enforce is the default.

## Emergencies: break glass
A blocker can be a false alarm at the worst moment. A project administrator (or Jira administrator) can open the work item's Same Page panel, choose **Need to ship anyway? Break glass…**, write a reason (for example "Emergency hotfix for INC-991") and allow that one work item through the gate for 24 hours. The validator cannot ask for input while a transition runs, so this is done beforehand. The reason and who granted it are sealed in the audit chain, each use is sealed too, findings are still shown, and **Revoke it now** ends it.

## Introducing a rule safely: draft, warning, blocker
New rules can start in **Draft** (Rules and settings): they run and are counted, but show nothing and cannot block. The Rules list shows how many findings a draft rule would have raised on your site. Move it to Warning when it looks right, and to Blocker only when you want it to stop transitions.

## If the validator is unavailable
`jira:workflowValidator` is a Preview Forge module. Same Page is designed so that nothing important depends on it:
- **Not attached, or not available on your site:** the panel still finds and explains every contradiction. **Create review task**
  hands each one to the page owner, and **Apply** fixes the page. Enforcement is the only thing missing.
- **Attached but failing:** the gate fails open, so a bug or an outage never stops anyone's work. The `SAME_PAGE_KILL` variable
  turns it off completely.
- **Team-managed projects:** Jira offers no validators there, so the panel and the project overview are the whole product.

## Who decides what blocks
Each rule has a severity, Blocker or Warning. R1, R2 and R5 ship as Blockers; R3, R4, R6 and R7 ship as Warnings. A Jira
administrator can move any rule between the two from **Same Page > Rules** in the panel. Only Blockers can stop a transition.
Rules cannot be switched off, and notes about possible history never block.
