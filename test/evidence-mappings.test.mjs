import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assessRecall, emptyState, readState } from '../scripts/lib/golden.mjs';
import {
  buildEvidenceMappingCandidates,
  inspectEvidenceMapping,
  readEvidenceMappingRevisions,
  saveEvidenceMapping,
  validateEvidenceMappingRevision,
} from '../scripts/lib/evidence-mappings.mjs';

function fixture() {
  const state = emptyState('test');
  state.evidences.push({ evidence_id: 'E001', title: 'Source', excerpt: 'Old excerpt', status: 'review' });
  state.chunks.push(
    { chunk_id: 'C1', dataset_id: 'D1', document_id: 'doc1', content: 'Before abc', source: 'ragflow' },
    { chunk_id: 'C2', dataset_id: 'D1', document_id: 'doc1', content: 'def after', source: 'ragflow' },
  );
  state.evidence_chunks.push({ evidence_id: 'E001', chunk_ids: ['C1'] });
  return state;
}

function privateDataset(t, state) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-mapping-'));
  const previous = process.env.GOLDEN_DATA_DIR;
  process.env.GOLDEN_DATA_DIR = directory;
  for (const [name, rows] of Object.entries(state)) {
    if (Array.isArray(rows)) fs.writeFileSync(path.join(directory, `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  t.after(() => {
    if (previous === undefined) delete process.env.GOLDEN_DATA_DIR;
    else process.env.GOLDEN_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
}

test('normalized candidates keep source punctuation and Unicode character boundaries', () => {
  const state = fixture();
  state.evidences[0].excerpt = '𠀀测试，结论。';
  state.chunks[0].content = '起始𠀀测试,结论。结束';
  const { revisions, auditRows } = buildEvidenceMappingCandidates(state);

  assert.equal(auditRows[0].category, 'normalized_linked');
  assert.equal(revisions[0].excerpt, '𠀀测试,结论。');
  assert.equal(revisions[0].review_status, 'pending');
  assert.equal(revisions[0].source_anchor.segments[0].start_offset, 2);
  assert.deepEqual(validateEvidenceMappingRevision(revisions[0], state), []);
});

test('approval records a reviewed multi-Chunk anchor and notices changed source text', (t) => {
  const state = fixture();
  privateDataset(t, state);
  const input = { evidence_id: 'E001', excerpt: 'abcdef', chunk_ids: ['C1', 'C2'] };
  const pending = saveEvidenceMapping('test', input).revision;
  assert.equal(pending.review_status, 'pending');
  assert.deepEqual(pending.source_anchor.segments.map((segment) => segment.quote), ['abc', 'def']);
  assert.equal(readState('test').evidences[0].excerpt, 'Old excerpt');
  assert.throws(() => saveEvidenceMapping('test', { ...input, review_status: 'approved', reviewer: 'Reviewer' }), /确认原文连续/);

  saveEvidenceMapping('test', { ...input, continuity_confirmed: true });
  const approved = saveEvidenceMapping('test', { ...input, continuity_confirmed: true, review_status: 'approved', reviewer: 'Reviewer' }).revision;
  assert.equal(approved.review_status, 'approved');
  const updated = readState('test');
  assert.equal(updated.evidences[0].excerpt, 'abcdef');
  assert.equal(updated.evidences[0].status, 'review');
  assert.deepEqual(updated.evidence_chunks[0].chunk_ids, ['C1', 'C2']);

  updated.chunks[1].content = 'changed source';
  assert.equal(inspectEvidenceMapping(updated, readEvidenceMappingRevisions('test'), 'E001').review_status, 'stale');
});

test('an alternative experiment approval does not change the canonical Evidence', (t) => {
  const state = fixture();
  privateDataset(t, state);
  const input = { evidence_id: 'E001', experiment_version: 'experiment-2', excerpt: 'abc', chunk_ids: ['C1'] };
  assert.throws(() => saveEvidenceMapping('test', { ...input, review_status: 'approved', reviewer: 'Reviewer' }), /保存为待复核/);
  saveEvidenceMapping('test', input);
  saveEvidenceMapping('test', { ...input, review_status: 'approved', reviewer: 'Reviewer' });

  const updated = readState('test');
  assert.equal(updated.evidences[0].excerpt, 'Old excerpt');
  assert.deepEqual(updated.evidence_chunks[0].chunk_ids, ['C1']);
  assert.equal(inspectEvidenceMapping(updated, readEvidenceMappingRevisions('test'), 'E001', 'experiment-2').review_status, 'approved');
});

test('recall excludes pending mapping requirements while retaining approved alternatives', () => {
  const state = fixture();
  state.queries.push({ query_id: 'Q1', text: 'Question?', variant_type: 'canonical', expected_behavior: 'answer', status: 'approved' });
  state.facts.push({ fact_id: 'F1', statement: 'Fact', fact_type: 'general', importance: 'P1', status: 'approved' });
  state.evidences.push({ evidence_id: 'E002', title: 'Other source', excerpt: 'def', status: 'review' });
  state.query_facts.push({ query_id: 'Q1', fact_id: 'F1', requirement: 'required' });
  state.fact_evidence.push({ fact_id: 'F1', evidence_ids: ['E001', 'E002'], operator: 'AND' });
  const context = { experiment_version: 'test', byEvidence: {
    E001: { review_status: 'approved', chunk_ids: ['C1'] },
    E002: { review_status: 'pending', chunk_ids: ['C2'] },
  } };

  const andReport = assessRecall(state, 'Q1', ['C1'], 12, null, context);
  assert.equal(andReport.scorable_total, 0);
  assert.equal(andReport.hit_total, 0);
  state.fact_evidence[0].operator = 'OR';
  const orReport = assessRecall(state, 'Q1', ['C1'], 12, null, context);
  assert.equal(orReport.scorable_total, 1);
  assert.equal(orReport.hit_total, 1);
});
