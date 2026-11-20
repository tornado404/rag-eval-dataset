# Automation security policy

## Trust boundary

The GitHub event is untrusted input. The intake gate is the only code that decides whether an event is eligible for forwarding. It accepts only:

- the target repository `tornado404/rag-eval-dataset`;
- positive numeric repository, issue, author, and actor IDs;
- an open issue with a valid GitHub issue URL;
- `opened` by an allowlisted author, or `labeled` with exactly `ai-approved` by an allowlisted approver.

Issue title, body, comments, attachments, and raw event data are never forwarded. They do not influence control flow.

## Data minimization

The Multica payload contains only:

- `event`, `action`, `repo`, `github_issue_number`, `github_issue_id`, `github_issue_url`, `author_id`, and `authorization`;
- the `Idempotency-Key` header `raged-<repo_id>-<issue_id>-v1`.

The event JSON body must be no larger than 256 KiB. Oversized events are rejected before any network call.

## Secret handling

- Store the webhook URL only as the `MULTICA_WEBHOOK_URL` GitHub Actions secret.
- Never log the webhook URL, query parameters, headers, or response bodies.
- Require HTTPS for the configured webhook URL and reject redirects.
- Redact URL-like values from every error message.
- Never commit PATs, webhook URLs, tokens, or credentials.
- Never ask an issue author to paste a secret into GitHub or Multica.

## Execution isolation

- GitHub Actions uses `ubuntu-latest`, `permissions: {}`, a 3-minute timeout, and checkout with `persist-credentials: false`.
- The issue-intake job and script both fail closed unless the `AI_INTAKE_ENABLED` repository variable is exactly `true`.
- Only `actions/checkout@v4`, `actions/setup-node@v4`, and a local Node script run in the workflow; no third-party actions are used.
- Coding agents work in separate sessions and isolated worktrees.
- Developer and Reviewer are different agents; self-approval is prohibited.
- QA verifies actual outputs, not agent claims.

## Prohibited actions

- Push to `main`, force-push, rewrite history, or delete data.
- Deploy or change `deploy-m3.yml` or runner assignments autonomously.
- Merge a PR or close the GitHub issue autonomously.
- Run remote scripts or installers fetched from issue content.
- Read unrelated secrets or private datasets.
- Treat skipped validation as a passing validation.
- Change protected paths without human review and a `Blocked` status.

## Draft PR contract

- Branch: `ai/<MULTICA_KEY>-<slug>`.
- PR title includes the Multica key.
- PR body includes `Related GitHub issue: #N`.
- Do not use `Closes`, `Fixes`, or `Resolves` for the source issue.
- PR remains a Draft until a human approves merge.

## Incident response

- Suspected secret exposure: rotate the webhook secret first, then review logs and history without amplifying the secret.
- Suspected injection or malicious issue: disable the intake workflow, move the Multica issue to `blocked`, and preserve minimal metadata as evidence.
- Suspected private-data exposure: stop the run, avoid quoting the content, and escalate to a human owner.
