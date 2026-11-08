# Deploying Same Page

How a change gets from this repository to the Forge environments, and the failure modes that were actually hit. Written from the real deploys, not from the docs.

## The chain
1. Edit `src/` (the checks) or `same-page-app/` (the Forge app).
2. `npm run sync` copies `src/` into `same-page-app/src/core` (it rewrites the `.ts` imports). The test `coresync` fails if the copy is stale.
3. `npm run typecheck && npm test`. CI runs the same two commands on every push (`.github/workflows/ci.yml`).
4. `bash scripts/copy-to-deploy.sh <deploy folder>` copies the sources into the folder that holds your registered app id.
5. `forge lint`, then `forge deploy -e development`, then check the change on a dev site.
6. `forge deploy -e production`, once, and wait for "Deployed".

## Things that are easy to get wrong
- **The manifest is not copied.** `copy-to-deploy.sh` leaves the deploy folder's `manifest.yml` alone because that copy carries the app id. A change to modules, agents or prompts must be made in both manifests. They should differ only by the app id and one comment line.
- **Agent starter prompts are limited to 85 characters.** `forge lint` rejects longer ones, and the manifest test checks the same limit.
- **Do not run the production deploy twice.** A second run while the first is still packaging fails with "Environment is blocked by other deployment". It changes nothing. Check with `forge deploy list -e production`.
- **Production is a separate install.** Forge storage is per installation, so Jira and Confluence each have their own data in each environment, and dev data does not appear in production.
- **Scope changes force a re-consent.** Adding a permission scope needs a new major version and every installation must approve it. Avoid this unless a feature needs it.
- **Rovo agents can only be tried where Rovo is enabled.** The dev site used for this project has no Rovo, so agents are checked on the production demo site.

## After a production deploy
1. Confirm the new version in `forge deploy list -e production`.
2. Check that the install link still answers HTTP 200. It follows the latest production deploy; generate a new link in the Developer Console if it ever goes stale.
3. Try the changed path on the demo site and record what was observed in `docs/live-results.md`, including what was not tried.

## Going back
Check out the earlier commit, repeat steps 2, 4 and 6. There is no separate rollback command in this repository.

## What is not automated, and why
Deploys are run by a person, not by CI. A production deploy needs a Forge login and changes what installed sites run, so it stays a deliberate step. CI only proves that the code type-checks and the offline tests pass; it never touches an Atlassian site.
