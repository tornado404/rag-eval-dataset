# Automation baseline audit

## Scope

This document records the redacted baseline used to design the GitHub Issue → Multica → coding agent → Draft PR intake MVP for `tornado404/rag-eval-dataset`.

Audit time: 2026-11-20 16:20 Asia/Shanghai.

It contains no tokens, passwords, PATs, webhook URLs, or credentials.

## Repository protections

- The repository is public.
- The `main` branch has no GitHub branch protection: the branch protection API returned `404`.
- No GitHub rulesets are configured.
- Because `main` is unprotected, automation must enforce its own no-`main`-push, no-history-rewrite, no-deploy, and no-auto-merge rules.

## Runners

- `m3-rag-eval-dataset` is a self-hosted runner.
- Status: online.
- Labels: `self-hosted`, `macOS`, `ARM64`, `office`.
- `deploy-m3.yml` uses that runner and is a blocker for autonomous changes.
- On `origin/main`, `validate.yml` uses `ubuntu-latest`; the hosted runner is the intended path for validation and intake.

## Known private-data risk

- PR #6 states that old history and tags retain private data.
- A local history scan found old dataset paths and private-looking terms.
- Treat all historical content as potentially private. Automation must not quote, publish, mirror, or use old history as evidence without human review.

## Repository quality baseline

- The current public `origin/main` works tree contains literal `[REDACTED]` lines in several Node scripts.
- `npm run check`, `npm run validate`, and seven pre-existing test files fail at `origin/main` before these automation changes are loaded.
- `node --check` fails on existing scripts such as `scripts/bootstrap_expected_outputs.mjs`, `scripts/compute_hit.mjs`, `scripts/dump_ragflow_chunks.mjs`, `scripts/lib/golden.mjs`, and `scripts/migrate-v15-to-golden.mjs`.
- This is a baseline blocker for the required full check. Fixing those files or rewriting history is outside this change.

## Baseline decision

The MVP forwards only structured, numeric, and URL metadata from an authorized GitHub issue event. It does not forward issue titles, bodies, comments, labels beyond the approval marker, repository descriptions, or raw webhook payloads.

The intake workflow and script both remain paused unless `AI_INTAKE_ENABLED` is exactly `true`; leave the repository variable unset until manual hardening is complete.

The validation workflow uses `node scripts/automation/check.mjs` when every changed path is limited to the issue-intake feature. Changes outside that scope continue to run `npm run check`, preserving the full project gate while the redacted baseline is repaired separately.
