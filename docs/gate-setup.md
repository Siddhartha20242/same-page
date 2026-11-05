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
