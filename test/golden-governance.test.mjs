import assert from 'node:assert/strict';
[REDACTED]
[REDACTED]
[REDACTED]
[REDACTED]
import test from 'node:test';
import { FILE_ORDER } from '../scripts/lib/golden.mjs';
import {
  buildSplit,
  digest,
  reviewState,
  subjectDigest,
  upsertReview,
  validateSplit,
} from '../scripts/lib/golden-governance.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function fixtureState() {
  return {
    version: 'golden-test',
    queries: [
      { query_id: 'Q0001', text: 'synthetic question one', notes: 'group alpha', status: 'draft', variant_type: 'canonical', expected_behavior: 'answer' },
      { query_id: 'Q0002', text: 'synthetic question two', notes: 'group alpha', status: 'draft', variant_type: 'canonical', expected_behavior: 'answer' },
      { query_id: 'Q0003', text: 'synthetic question three', notes: 'group beta', status: 'draft', variant_type: 'canonical', expected_behavior: 'answer' },
      { query_id: 'Q0004', text: 'synthetic question four', notes: 'group gamma; shared required item', status: 'draft', variant_type: 'canonical', expected_behavior: 'answer' },
      { query_id: 'Q0005', text: 'synthetic question five', notes: 'group delta', status: 'draft', variant_type: 'canonical', expected_behavior: 'answer' },
    ],
    facts: [
      { fact_id: 'F001', statement: '事实一' },
      { fact_id: 'F002', statement: '事实二' },
      { fact_id: 'F003', statement: '事实三' },
      { fact_id: 'F004', statement: '事实四' },
    ],
    evidences: [
      { evidence_id: 'E001', title: '证据一', excerpt: '摘录一' },
      { evidence_id: 'E002', title: '证据二', excerpt: '摘录二' },
      { evidence_id: 'E003', title: '证据三', excerpt: '摘录三' },
      { evidence_id: 'E004', title: '证据四', excerpt: '摘录四' },
    ],
    chunks: [
      { chunk_id: 'CK001', content: '块一' },
      { chunk_id: 'CK002', content: '块二' },
      { chunk_id: 'CK003', content: '块三' },
      { chunk_id: 'CK004', content: '块四' },
    ],
    query_facts: [
      { query_id: 'Q0001', fact_id: 'F001', requirement: 'required' },
      { query_id: 'Q0002', fact_id: 'F001', requirement: 'required' },
      { query_id: 'Q0003', fact_id: 'F002', requirement: 'required' },
      { query_id: 'Q0004', fact_id: 'F001', requirement: 'required' },
      { query_id: 'Q0005', fact_id: 'F004', requirement: 'required' },
    ],
    fact_evidence: [
      { fact_id: 'F001', evidence_ids: ['E001'], operator: 'OR' },
      { fact_id: 'F004', evidence_ids: ['E004'], operator: 'OR' },
      { fact_id: 'F002', evidence_ids: ['E002'], operator: 'OR' },
      { fact_id: 'F001', evidence_ids: ['E001'], operator: 'OR' },
    ],
    evidence_chunks: [
      { evidence_id: 'E001', chunk_ids: ['CK001'] },
      { evidence_id: 'E002', chunk_ids: ['CK002'] },
      { evidence_id: 'E001', chunk_ids: ['CK001', 'CK003'] },
      { evidence_id: 'E004', chunk_ids: ['CK004'] },
    ],
  };
}

function reviewInput(status = 'approved') {
  return {
    subject_type: 'query_fact',
    subject_id: 'Q0001|F001',
    subject_digest: 'digest-one',
    status,
    reviewer: 'alice',
    note: '',
    reviewedAt: '2026-01-01T00:00:00.000Z',
  };
}

function tempGoldenDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-governance-test-'));
  const dir = path.join(root, 'golden-v1');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

function writeContract(dir) {
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'schemas/golden-governance-contract.json'), path.join(dir, 'governance/contract.json'));
}

function splitByScenario(split, scenario) {
  return split.assignments.filter((row) => row.scenario === scenario);
}

test('upsertReview is idempotent and replaces a changed decision', () => {
  const rows = [];
  const first = upsertReview(rows, reviewInput());
  const second = upsertReview(rows, reviewInput());
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.changed, false);
  assert.equal(rows.length, 1);

  const replacement = upsertReview(rows, reviewInput('rejected'));
  assert.equal(replacement.created, false);
  assert.equal(replacement.changed, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'rejected');
});

test('reviewState reports stale after the subject digest changes', () => {
  const rows = [];
  upsertReview(rows, reviewInput());
  assert.equal(reviewState(rows, 'query_fact', 'Q0001|F001', 'digest-one'), 'approved');
  assert.equal(reviewState(rows, 'query_fact', 'Q0001|F001', 'digest-two'), 'stale');
  assert.equal(reviewState(rows, 'query_fact', 'Q0002|F001', 'digest-one'), 'pending');
});

test('buildSplit keeps scenario groups whole and leaks nothing after quarantine', () => {
  const state = fixtureState();
  const split = buildSplit(state, { id: 'split-a', seed: 42, validationRatio: 0.25, createdAt: '2026-01-01T00:00:00.000Z' });
  const validationScenarios = [...new Set(split.assignments.filter((row) => row.split === 'validation').map((row) => row.scenario))];
  for (const scenario of validationScenarios) {
    assert.deepEqual(splitByScenario(split, scenario).map((row) => row.split), Array(splitByScenario(split, scenario).length).fill('validation'));
  }
  assert.ok(split.counts.validation >= Math.round(state.queries.length * 0.25));
  assert.ok(split.counts.quarantined > 0);
  assert.equal(split.counts.train + split.counts.validation + split.counts.quarantined, state.queries.length);
  assert.equal(split.leak_report.scenario_cross, 0);
  assert.equal(split.leak_report.shared_required_fact_cross, 0);
  assert.equal(split.leak_report.shared_required_chunk_cross, 0);
  assert.ok(split.leak_report.quarantined_fact_overlap > 0);
  assert.ok(split.leak_report.quarantined_chunk_overlap > 0);
  assert.deepEqual(validateSplit(state, split), []);
});

test('buildSplit is deterministic by seed and changes with a different seed', () => {
  const state = fixtureState();
  const options = { id: 'split-a', seed: 42, validationRatio: 0.25, createdAt: '2026-01-01T00:00:00.000Z' };
  const first = buildSplit(state, options);
  const second = buildSplit(state, options);
  assert.equal(digest(first), digest(second));
  const changed = buildSplit(state, { ...options, seed: 7 });
  assert.notEqual(digest(first), digest(changed));
});

test('validateSplit rejects hand-modified leaks and digest mismatches', () => {
  const state = fixtureState();
  const split = buildSplit(state, { id: 'split-a', seed: 42, validationRatio: 0.25 });
  const leak = structuredClone(split);
  leak.assignments.find((row) => row.query_id === 'Q0002').split = 'train';
  leak.counts.train += 1;
  leak.counts.validation -= 1;
  const leakErrors = validateSplit(state, leak);
  assert.ok(leakErrors.some((error) => error.includes('shared_required_fact_cross leak')));

  const mismatch = structuredClone(split);
  mismatch.assignments[0].query_id = 'Q9999';
  const mismatchErrors = validateSplit(state, mismatch);
  assert.ok(mismatchErrors.some((error) => error.includes('split_digest mismatch')));
  assert.ok(mismatchErrors.some((error) => error.includes('unknown query Q9999')));
});

function writeFixture(dir, state) {
  for (const name of FILE_ORDER) {
    fs.writeFileSync(path.join(dir, `${name}.jsonl`), state[name].map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
}

function coreBytes(dir) {
  return Object.fromEntries(FILE_ORDER.map((name) => [name, fs.readFileSync(path.join(dir, `${name}.jsonl`))]));
}

function runCommand(file, args, env) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [file, ...args], { cwd: ROOT, env, encoding: 'utf8' }),
    };
  } catch (error) {
    return { status: error.status, stdout: error.stdout || '' };
  }
}

test('CLI status and split propose do not change any core JSONL bytes', () => {
  const { root, dir } = tempGoldenDir();
  try {
    writeFixture(dir, fixtureState());
    writeContract(dir);
    const before = coreBytes(dir);
    const env = { ...process.env, GOLDEN_DATA_DIR: dir };
    const status = execFileSync(process.execPath, [path.join(ROOT, 'scripts/golden-governance.mjs'), 'status'], { cwd: ROOT, env, encoding: 'utf8' });
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/golden-governance.mjs'), 'split', 'propose', '--id', 'split-cli', '--seed', '42', '--validation-ratio', '0.25'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.ok(status.includes('"core_digest"'));
    assert.deepEqual(coreBytes(dir), before);
    assert.ok(fs.existsSync(path.join(dir, 'governance/splits/split-cli.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('subjectDigest changes with subject content', () => {
  assert.notEqual(subjectDigest('query_fact', { a: 1 }), subjectDigest('query_fact', { a: 2 }));
});

test('P0 P1 gate fails while reviews are pending', () => {
  const { root, dir } = tempGoldenDir();
  try {
    writeFixture(dir, fixtureState());
    const env = { ...process.env, GOLDEN_DATA_DIR: dir };
    const gateArgs = [path.join(ROOT, 'scripts/golden-governance.mjs'), 'gate', 'p0-p1', '--split', 'split-gate', '--seed', '42', '--validation-ratio', '0.25'];

    const pending = runCommand(path.join(ROOT, 'scripts/golden-governance.mjs'), gateArgs.slice(1), env);
    assert.equal(pending.status, 2);
    const pendingReport = JSON.parse(pending.stdout);
    assert.equal(pendingReport.passed, false);
    assert.equal(pendingReport.core_jsonl_unchanged, true);
    assert.equal(pendingReport.proposed_split.leak_report.scenario_cross, 0);
    assert.equal(pendingReport.proposed_split.leak_report.shared_required_fact_cross, 0);
    assert.equal(pendingReport.proposed_split.leak_report.shared_required_chunk_cross, 0);
    assert.ok(pendingReport.blockers.some((blocker) => blocker.endsWith('pending reviews')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
