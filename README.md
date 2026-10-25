# PATCHGUARD v1

A Next.js application with repository-scoped npm monitoring and remediation through GitHub Actions, n8n and optional Telegram alerts. No AI models, paid APIs, n8n AI credits, automatic merging or deployment.

**Status:** the Next.js app and guarded Actions workflow have been published to `slvdrvncntjvr/patchguard`; Dependabot alerts are enabled. The app uses Next.js 16.4.3, React/React DOM 19.3.1 and Node.js 24. A clean `npm ci --ignore-scripts`, 66 tests, production build, HTTP smoke check and full npm audit passed; the audit reported zero known vulnerabilities. The n8n monitor was published with explicit approval on 25 October 2026 after a successful manual monitor execution. Its six-hour schedule is active, Telegram is configured, and automatic patch dispatch remains blocked. The remediation-to-PR path remains unverified.

## Run the Next.js app

The app follows the [Next.js App Router setup](https://nextjs.org/docs/app/getting-started/installation) with only three runtime dependencies and no extra service credentials.

```sh
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
npm run dev
```

Open http://127.0.0.1:3000. On Windows PowerShell, use `npm.cmd` instead of `npm` if execution policy blocks npm.ps1. For a production-mode local preview, run `npm run build` followed by `npm start`.

The homepage shows repository setup, pipeline stages and the remaining setup checklist. It reads only approved public fields from `n8n/saved-workflow.json` at build time; it does not expose credential IDs, tokens or Telegram chat IDs. The public snapshot records Telegram readiness as booleans; its chat ID remains a placeholder, while the real chat ID is configured only in n8n. This is a saved-configuration overview, not a live CVE dashboard. The website does not display live scan counts. Rebuild after refreshing the saved snapshot to reflect configuration changes.

`GET /api/health` checks application availability and explicitly reports that monitoring is unverified. Baseline response headers disable framing and content sniffing. The app does not dispatch, merge or deploy anything and needs no environment secrets to start.

## Website deployment

The app is configured for Vercel's Next.js preset and Node.js 24. The production install uses the committed npm lockfile with lifecycle scripts disabled. No Telegram, GitHub or n8n token belongs in the hosting environment.

`vercel.json` sets `git.deploymentEnabled=false`, so branch pushes and patch PRs do not automatically deploy. Website releases are explicit manual Vercel deployments. The website shows saved setup status; Telegram receives live monitoring results. The public site does not provide remote workflow controls or live scan storage.

## What remains before automatic patching

1. Rotate the bot token shared in chat before production use, and update the encrypted Telegram credential in n8n. Do not store tokens in the repository or app.
2. Complete the disposable-repository patch-to-PR tests and verify repository permissions/settings for draft PR creation. The GitHub Actions approval variable remains unset.
3. Establish serialized n8n execution and review the deduplication crash/concurrency limitation before approving dispatch. Monitoring activation does not approve unverified automatic patching.
4. Vercel deployment is optional and requires a separate deployment decision; it is not needed for n8n to inspect GitHub dependencies.

## Saved n8n workflow

- Name: **PATCHGUARD — Autonomous CVE Monitoring & Remediation**
- Workflow ID: `vsZKzBRf7cYRZeub`
- Project: personal project `blRJOXvScj61n0cp`
- Editor: https://workcybercentcurity.app.n8n.cloud/workflow/vsZKzBRf7cYRZeub
- Published and active. Manual Trigger previews only; Schedule Trigger runs every six hours with dispatch disabled.
- 21 nodes organized into five named canvas sections. A source copy is in `n8n/patchguard-v1.sdk.js`; n8n execution settings are in the saved workflow snapshot.
- SDK validation passed before creation. The saved graph and disabled approval flags were retrieved for comparison after edits.
- Live monitor verification: execution `1` completed successfully with a complete repository scan, confirmed Telegram delivery, and no execution of the GitHub dispatch node. The published version is `1550eded-159a-4b41-960f-edf4f8ec75f6`.

The pipeline reads open npm Dependabot alerts from the configured repository, the official CISA KEV feed, root manifests and PATCHGUARD Actions history. It reports missing, forbidden, stale, malformed and truncated data as incomplete. Only confirmed direct root npm dependencies with a stable, newer, same-major fix and a canonical GHSA ID can become patch candidates. KEV findings rank first, then critical/high findings. Other cases require manual review.

At most one patch dispatch is reserved per scan. A key based on repository, package and fixed version is checked against a static-data ledger and matching Actions run titles. Accepted or ambiguous attempts are never automatically retried. The workflow does not monitor the eventual Actions result: accepted dispatch is not proof of a successful build, patch or PR.

### Credential setup in n8n

The saved `GitHub account` credential is attached to all five GitHub HTTP nodes. Only its ID and name appear in the saved workflow snapshot; no token is stored in workflow parameters or project files. Live API permissions have not yet been tested.

| Credential label | n8n type | Minimum access |
| --- | --- | --- |
| GitHub account | GitHub API | Attached to the four GET nodes and the gated dispatch node. Reads require Dependabot alerts, Contents and Actions read; eventual dispatch requires Actions write. |
| Telegram account | Telegram API | Configured and connection-tested in n8n; real token and chat ID are excluded from the public snapshot |

The current setup reuses the GitHub credential you saved; assigning it did not approve or enable dispatch. Configure Telegram's credential and numeric chat ID before setting `telegramEnabled=true`. Tokens belong exclusively in encrypted n8n credentials, never Code nodes, environment examples, exported workflow parameters or Git.

Current configuration: `dryRun=true`; `dispatchEnabled`, `authSetupApproved`, `testsApproved`, `serializedExecutionApproved` remain false; `telegramEnabled=true`. Manual source remains preview-only even if approval flags change. The schedule was published after explicit approval.

### n8n limits before live use

- This instance permits a maximum execution time of 180 seconds. A slow API or a large paginated scan can time out. Inspect failed executions; a failed execution never proves zero vulnerabilities.
- Intake is capped at ten pages per paginated endpoint and fails closed when pagination is incomplete.
- [Static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/) is experimental, saves only after a successful published trigger execution, does not persist during manual tests, and is not an atomic cross-execution lock. Enforce one execution at a time before approving `serializedExecutionApproved`; use an atomic durable store if concurrency is needed. Exactly-once dispatch across crashes/concurrent executions is not guaranteed.
- The ledger stops new automatic attempts at 5,000 keys instead of silently expiring old suppression records. Reconcile it manually. Missing history, uncertain delivery and failed requests require review before any retry.
- Private registries, workspaces, nested manifests, indirect dependencies, prerelease fixes, major upgrades and CVE-only inputs need manual work in v1.
- Built-in HTTP/Code behavior, credentials, live APIs, schedule execution and Telegram delivery have not been tested in this instance. Isolated tests do not verify the full n8n runtime.

## GitHub Actions implementation

`.github/workflows/patchguard.yml` accepts `package`, `fixed_version` and `advisory_id` through `workflow_dispatch` only. It is gated by the repository variable `PATCHGUARD_TESTS_APPROVED=true` and by the default branch ref. Neither that variable nor repository settings were changed.

The read-only job validates the inputs, requires a root Next.js npm app and real existing tests, checks the direct locked dependency, verifies official GitHub advisory metadata and exact public npm version/tarball/integrity, and switches to a deterministic patch branch. It resolves the lockfile with install scripts disabled, validates registry URLs and integrity, runs `npm ci`, `npm run build`, every existing `test` / `test:*` script, and `npm audit --audit-level=low` including dev dependencies. Missing tests, failed checks and any audit finding stop PR creation. No `npm audit fix` is used.

Only successful checks upload package.json and package-lock.json. A fresh publisher job downloads that run's artifact outside its trusted checkout, independently validates the exact manifest change and target metadata, refuses a moved default branch, and creates a new branch and **draft PR** with the GitHub API. It never installs packages or executes artifact code. Existing branches are never overwritten or force-pushed. An interrupted PR creation can leave a branch requiring manual reconciliation.

The publisher alone has `contents: write` and `pull-requests: write`; the build job has `contents: read`. Checkout does not persist credentials. Inputs enter scripts through environment variables and subprocesses use argument arrays with `shell:false`. Official actions are pinned to full commit SHAs. No secrets, AI-generated commands, merge actions or deployment steps are included.

### Security review and limitations

- The workflow uses no `pull_request_target`, fork checkout, dynamic shell commands, write token during dependency execution, npm auth token, or user-controlled executable path. All three inputs are revalidated in the publisher.
- Package registry metadata and integrity are not proof that package code is safe. Build and test scripts run code on a disposable GitHub-hosted runner. Install lifecycle scripts and pre/post npm hooks are disabled, which can break packages needing native compilation or generated files. Do not add production secrets to make tests pass.
- Registry restrictions reject .npmrc, npm-shrinkwrap.json, Git/URL/local/workspace/alias/tag dependencies, non-public resolved URLs and lock entries without SHA-512 integrity. Conservative rejection is intentional; some legitimate projects will need manual adaptation.
- Advisory matching accepts the exact first patched npm version reported by GitHub. It is not a general semver advisory-range solver and does not guarantee that this is the latest safe version or that all advisories for the package are fixed. The strict full npm audit can block a PR because of unrelated advisories, including vulnerabilities in Next.js or dev tooling.
- Artifacts are treated as untrusted: only two package files can enter the commit, and manifest identity, direct version, registry URL and integrity are checked again. Transitive lockfile changes still need human review. A malicious dependency or repository test can tamper with its own job; passing tests are not a proof against compromised build code.
- [`GITHUB_TOKEN`-created pushes](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow) do not start push workflows; opened/synchronized/reopened PR workflows can enter an approval-required state. A user with repository write access must approve those runs. Allowing GitHub Actions to create PRs is a repository setting that the owner must approve.
- This workflow has no Vercel or production credentials. Existing external Vercel/GitHub integrations might react to a branch or PR; keep the disposable demo disconnected from deployments and inspect integration rules before real use.
- [Public-repository standard GitHub-hosted runners](https://docs.github.com/en/actions/concepts/billing-and-usage) avoid additional Actions charges under GitHub's current offering. Existing n8n execution limits still apply. No paid service or AI credits are requested.

The YAML review follows GitHub's [secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use), including SHA pinning, limited token permissions and avoiding input interpolation in shell scripts. Dependency lifecycle-script restrictions follow [npm's ignore-scripts behavior](https://docs.npmjs.com/cli/v11/using-npm/config#ignore-scripts).

See [docs/safe-test-plan.md](docs/safe-test-plan.md) before testing automatic remediation. The repository is published and monitoring is active; no Actions dispatch, PR, merge or deployment has been performed.

## Local verification

Run from this folder with Node.js:

```sh
npm test
npm run build
npm run test:smoke
npm audit --audit-level=low --registry=https://registry.npmjs.org/
node --check .github/scripts/patchguard.mjs
actionlint -shellcheck= -pyflakes= .github/workflows/patchguard.yml
```

The 66 tests exercise the app's privacy and configuration behavior, the real app lockfile, policy, n8n Code snippets and the publisher with synthetic data and mocked HTTP responses; they make no real API writes. The separate smoke test starts an owned production server on a temporary loopback port, checks the homepage, health JSON, security/cache headers, credential privacy and 404 handling, then stops it. `npm run check` runs the tests, build, production smoke check and full audit in order. Browser visual QA was not performed. `actionlint` checked the Actions workflow and expressions; ShellCheck/Pyflakes were unavailable and disabled. A live n8n monitor execution completed successfully before publication. A real GitHub Actions patch run, PR creation and deployment remain untested.
