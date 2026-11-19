#!/usr/bin/env node
import { GOLDEN_VERSION } from './lib/golden.mjs';
import { goldenDir } from './lib/golden.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSplit,
  digest,
  governanceStatus,
  loadGovernance,
  reviewState,
  reviewTargets,
  saveReview,
  saveSplit,
  splitReadiness,
  upsertReview,
  validateSplit,
} from './lib/golden-governance.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = args[index + 1];
    if (next == null || next.startsWith('--')) throw new Error(`${token} requires a value`);
    options[key] = next;
    index += 1;
  }
  return { positional, options };
}

function requireOption(options, name) {
  if (options[name] == null || String(options[name]).trim() === '') throw new Error(`--${name} is required`);
  return options[name];
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function coreBytes(dir) {
  return Object.fromEntries(
    ['queries', 'facts', 'evidences', 'chunks', 'query_facts', 'fact_evidence', 'evidence_chunks']
      .map((name) => [name, fs.readFileSync(path.join(dir, `${name}.jsonl`))]),
  );
}

function runGate(version, splitId, seed, ratio) {
  const governance = loadGovernance(version);
  const contract = governance.contract;
  if (contract.schema_version !== 'golden-governance/v1') throw new Error('unsupported governance contract');
  const coreDigest = digest(governance.state);
  const proposed = buildSplit(governance.state, {
    id: splitId,
    datasetId: contract.dataset_id,
    seed,
    validationRatio: ratio,
  });
  const errors = validateSplit(governance.state, proposed);
  if (errors.length) throw new Error(`split validation failed: ${errors.join('; ')}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-gate-'));
  const tempDir = path.join(tempRoot, version);
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    for (const name of contract.core_tables) {
      fs.copyFileSync(path.join(goldenDir(version), `${name}.jsonl`), path.join(tempDir, `${name}.jsonl`));
    }
    const before = coreBytes(tempDir);
    const env = { ...process.env, GOLDEN_DATA_DIR: tempDir };
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/golden-governance.mjs'), 'status'], { cwd: REPO_ROOT, env, stdio: 'pipe' });
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/golden-governance.mjs'), 'split', 'propose', '--id', splitId, '--seed', String(seed), '--validation-ratio', String(ratio)], { cwd: REPO_ROOT, env, stdio: 'pipe' });
    const after = coreBytes(tempDir);
    const coreUnchanged = Object.keys(before).every((name) => before[name].equals(after[name]));
    if (!coreUnchanged) throw new Error('core JSONL bytes changed during gate');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const reviewCounts = { approved: 0, rejected: 0, stale: 0, pending: 0 };
  const validationIds = new Set(proposed.assignments.filter((row) => row.split === 'validation').map((row) => row.query_id));
  const requiredLinks = governance.state.query_facts.filter((row) => ['required', 'required_any'].includes(row.requirement));
  const subjects = [];
  for (const key of [...new Set(requiredLinks.map((row) => `${row.query_id}|${row.fact_id}`))].sort()) {
    const [queryId, factId] = key.split('|');
    if (!validationIds.has(queryId)) continue;
    const governanceSubject = reviewTargets(governance, 'query_fact', { queryId, factId });
    subjects.push(reviewState(governance.reviewRows, 'query_fact', key, governanceSubject.subject_digest));
  }
  for (const fact of governance.state.facts) {
    const governanceSubject = reviewTargets(governance, 'fact_mapping', { factId: fact.fact_id });
    subjects.push(reviewState(governance.reviewRows, 'fact_mapping', fact.fact_id, governanceSubject.subject_digest));
  }
  subjects.push(reviewState(governance.reviewRows, 'split', splitId, digest(proposed)));
  for (const status of subjects) reviewCounts[status] += 1;

  const passed = reviewCounts.stale === 0
    && reviewCounts.pending === 0
    && reviewCounts.rejected === 0
    && reviewCounts.approved === subjects.length
    && proposed.leak_report.scenario_cross === 0
    && proposed.leak_report.shared_required_fact_cross === 0
    && proposed.leak_report.shared_required_chunk_cross === 0;
  const blockers = [];
  if (reviewCounts.stale > 0) blockers.push(`${reviewCounts.stale} stale reviews`);
  if (reviewCounts.pending > 0) blockers.push(`${reviewCounts.pending} pending reviews`);
  if (reviewCounts.rejected > 0) blockers.push(`${reviewCounts.rejected} rejected reviews`);
  if (proposed.leak_report.scenario_cross !== 0
    || proposed.leak_report.shared_required_fact_cross !== 0
    || proposed.leak_report.shared_required_chunk_cross !== 0) blockers.push('split leak report is not clean');
  return {
    gate: 'p0-p1-before-p2',
    passed,
    version,
    core_digest: coreDigest,
    proposed_split: {
      id: proposed.id,
      counts: proposed.counts,
      leak_report: proposed.leak_report,
      split_digest: proposed.split_digest,
    },
    reviews: reviewCounts,
    core_jsonl_unchanged: true,
    blockers,
  };
}

function run() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const version = options.version || GOLDEN_VERSION;
  const [command, second, third] = positional;

  if (command === 'status' && !second) {
    print(governanceStatus(version));
    return;
  }

  if (command === 'gate' && second === 'p0-p1') {
    const splitId = requireOption(options, 'split');
    const seed = Number(requireOption(options, 'seed'));
    const ratio = Number(requireOption(options, 'validationRatio'));
    if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error('--validation-ratio must be between 0 and 1');
    const result = runGate(version, splitId, seed, ratio);
    print(result);
    if (!result.passed) process.exitCode = 2;
    return;
  }

  if (command === 'review' && ['query-fact', 'mapping', 'split'].includes(second)) {
    const type = second === 'query-fact' ? 'query_fact' : second === 'mapping' ? 'fact_mapping' : 'split';
    const input = {
      queryId: options.query,
      factId: options.fact,
      splitId: options.split,
    };
    const governance = loadGovernance(version);
    const target = reviewTargets(governance, type, input);
    const identity = type === 'query_fact'
      ? { query_id: target.query_id, fact_id: target.fact_id }
      : type === 'fact_mapping'
        ? { fact_id: target.fact_id }
        : { split_id: target.split_id };
    const nextRows = [...governance.reviewRows];
    const result = upsertReview(nextRows, {
      ...identity,
      subject_type: target.subject_type,
      subject_id: target.subject_id,
      subject_digest: target.subject_digest,
      status: requireOption(options, 'status'),
      reviewer: requireOption(options, 'reviewer'),
      note: options.note || '',
    });
    saveReview(version, nextRows);
    print(result.row);
    return;
  }

  if (command === 'split' && second === 'propose') {
    const governance = loadGovernance(version);
    const split = buildSplit(governance.state, {
      id: requireOption(options, 'id'),
      datasetId: governance.contract.dataset_id,
      seed: requireOption(options, 'seed'),
      validationRatio: requireOption(options, 'validationRatio'),
    });
    const result = saveSplit(version, split);
    print({ ...result, split });
    return;
  }

  if (command === 'split' && second === 'show') {
    const governance = loadGovernance(version);
    const id = requireOption(options, 'id');
    const split = governance.splitRows.find((row) => row.id === id);
    if (!split) throw new Error(`split ${id} not found`);
    print({ ...split, readiness: splitReadiness(governance, split), validation_errors: validateSplit(governance.state, split) });
    return;
  }

  if (command === 'split' && second === 'validate') {
    const governance = loadGovernance(version);
    const id = requireOption(options, 'id');
    const split = governance.splitRows.find((row) => row.id === id);
    if (!split) throw new Error(`split ${id} not found`);
    const errors = validateSplit(governance.state, split);
    if (errors.length) throw new Error(errors.join('; '));
    print({ id, status: 'valid', readiness: splitReadiness(governance, split) });
    return;
  }

  throw new Error('unknown command; expected status, review, or split');
}

try {
  run();
} catch (error) {
  console.error(`golden-governance: ${error.message}`);
  process.exitCode = 1;
}
