import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import {
  GoldenError,
  applyEvidenceChunks,
  applyFactEvidence,
  assessRecall,
  autoMatchQuery,
  coverageGaps,
  createEvidence,
  createQueryBundle,
  deleteEntity,
  emptyState,
  evidenceInventory,
  parseSuggestions,
  upsertEntity,
  validateState,
} from '../scripts/lib/golden.mjs';

function fixture() {
  const state = emptyState('test');
  state.queries.push({ query_id: 'Q0001', text: '这个药是药品还是保健品？', variant_type: 'canonical', status: 'draft', expected_behavior: 'answer' });
  state.facts.push({ fact_id: 'F001', statement: 'Rayaldee 是药品。', fact_type: 'product_information', importance: 'P0', status: 'draft' });
  return state;
}

test('upsert creates ids, updates, and rejects duplicate query text', () => {
  const state = fixture();
  const query = upsertEntity(state, 'queries', { text: '请问 Rayaldee 是不是药物？', variant_type: 'colloquial' }).row;
  assert.equal(query.query_id, 'Q0002');
  assert.equal(query.variant_type, 'colloquial');

  upsertEntity(state, 'queries', { query_id: 'Q0002', text: '请告诉我 Rayaldee 是不是药物？', status: 'review' });
  assert.equal(state.queries[1].status, 'review');
  assert.equal(state.queries[1].text, '请告诉我 Rayaldee 是不是药物？');

  const state2 = fixture();
  upsertEntity(state2, 'queries', { text: '请告诉我 Rayaldee 是不是药物？' });
  upsertEntity(state2, 'queries', { text: '请告诉我 Rayaldee 是不是药物？' });
  assert.equal(validateState(state2).length > 0, true);
});

test('delete cascades relations and clears parent references', () => {
  const state = fixture();
  state.facts.push({ fact_id: 'F002', statement: '成人每日 30 μg。', fact_type: 'product_information', importance: 'P1', status: 'draft' });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F001', requirement: 'required' });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F002', requirement: 'optional' });
  deleteEntity(state, 'queries', 'Q0001');
  assert.equal(state.query_facts.length, 0);
  assert.equal(state.facts.length, 2);

  deleteEntity(state, 'facts', 'F001');
  assert.deepEqual(state.query_facts, []);
});

test('parent chain is one level and root deletion detaches every descendant', () => {
  const state = fixture();
  state.queries.push(
    { query_id: 'Q0002', text: '主问的同义句', variant_type: 'paraphrase', parent_query_id: 'Q0001', status: 'draft', expected_behavior: 'answer' },
    { query_id: 'Q0003', text: '同义句的追问', variant_type: 'follow_up', parent_query_id: 'Q0002', status: 'draft', expected_behavior: 'answer' },
  );

  const errors = validateState(state);
  assert.equal(errors.some((error) => error.includes('parent Q0002 is not canonical')), true);
  assert.equal(errors.some((error) => error.includes('parent Q0002 is a variant')), true);

  deleteEntity(state, 'queries', 'Q0001');
  assert.deepEqual(state.queries.map((row) => row.parent_query_id), ['', '']);
  assert.deepEqual(validateState(state), []);
});

test('migration refuses to overwrite an existing seed dataset', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const script = path.join(root, 'scripts', 'migrate-v15-to-golden.mjs');
  assert.throws(
    () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' }),
    (error) => /refusing to overwrite existing (golden dataset|migration cache)/.test(String(error.stderr || '')),
  );
});

test('query bundle creates one canonical root with variants and shared facts', () => {
  const state = fixture();
  state.facts.push({ fact_id: 'F002', statement: '成人每日 30 μg。', fact_type: 'product_information', importance: 'P1', status: 'draft' });
  const result = createQueryBundle(state, {
    queries: [
      { text: 'Rayaldee 是药品还是保健品？', variant_type: 'paraphrase' },
      { text: '这玩意算药吗？', variant_type: 'colloquial' },
      { text: '它是正规药吗？', variant_type: 'canonical' },
    ],
    facts: [
      { fact_id: 'F001', requirement: 'required' },
      { fact_id: 'F002', requirement: 'optional' },
    ],
  });
  assert.equal(result.queries.length, 3);
  assert.equal(result.queries[0].variant_type, 'canonical');
  assert.equal(result.queries[0].parent_query_id, '');
  assert.equal(result.queries[1].parent_query_id, result.main_query_id);
  assert.equal(result.queries[2].variant_type, 'paraphrase');
  assert.equal(result.queries[2].parent_query_id, result.main_query_id);
  assert.equal(state.query_facts.length, 6);
  assert.equal(validateState(state).length, 0);
});

test('evidence chunk relation is many-to-many and recall respects operator', () => {
  const state = fixture();
  createEvidence(state, {
    title: '产品定位',
    excerpt: 'Rayaldee 是缓释胶囊药品。',
    chunks: [{ chunk_id: 'ck-a', content: 'Rayaldee 是药品。', document_name: 'C01.txt', page: 1 }],
  });
  createEvidence(state, {
    title: '另一证据',
    excerpt: '第二份摘录',
    chunks: [{ chunk_id: 'ck-b', content: '它不是保健品。', document_name: 'C02.txt' }],
  });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F001', requirement: 'required' });
  applyFactEvidence(state, 'F001', ['E001', 'E002'], 'OR');
  applyEvidenceChunks(state, 'E001', ['ck-a', 'ck-b']);

  assert.deepEqual(state.evidence_chunks[0].chunk_ids, ['ck-a', 'ck-b']);
  assert.deepEqual(state.evidence_chunks[1].chunk_ids, ['ck-b']);
  assert.equal(validateState(state).length, 0);

  const miss = assessRecall(state, 'Q0001', ['customer_service'], 12, 10);
  assert.equal(miss.hit_total, 0);
  assert.equal(miss.recall, 0);
  const partial = assessRecall(state, 'Q0001', ['ck-a'], 12, 10);
  assert.equal(partial.hit_total, 1);
  const hit = assessRecall(state, 'Q0001', ['ck-b'], 12, 10);
  assert.equal(hit.hit_total, 1);
  assert.deepEqual(hit.facts[0].matched_chunk_ids, ['ck-b']);
});

test('unscored required facts are reported separately', () => {
  const state = fixture();
  state.facts.push({ fact_id: 'F002', statement: '无证据事实', fact_type: 'customer_service', importance: 'P1', status: 'draft' });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F001', requirement: 'required' });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F002', requirement: 'required' });
  createEvidence(state, { title: '证据', excerpt: '内容', chunks: [{ chunk_id: 'ck-a', content: '内容' }] });
  state.fact_evidence.push({ fact_id: 'F001', evidence_ids: ['E001'], operator: 'OR' });

  const report = assessRecall(state, 'Q0001', ['ck-a']);
  assert.equal(report.required_total, 2);
  assert.equal(report.scorable_total, 1);
  assert.equal(report.coverage, 0.5);
  assert.equal(report.recall, 1);
  assert.deepEqual(coverageGaps(state).facts_without_chunks, ['F002']);
});

test('AND evidence groups require every chunk-bearing evidence to hit', () => {
  const state = fixture();
  createEvidence(state, { title: 'A', excerpt: 'A', chunks: [{ chunk_id: 'ck-a', content: 'A' }] });
  createEvidence(state, { title: 'B', excerpt: 'B', chunks: [{ chunk_id: 'ck-b', content: 'B' }] });
  state.query_facts.push({ query_id: 'Q0001', fact_id: 'F001', requirement: 'required' });
  applyFactEvidence(state, 'F001', ['E001', 'E002'], 'AND');
  state.evidences.push({ evidence_id: 'E003', title: '待补 Chunk', excerpt: 'C', status: 'draft' });
  state.fact_evidence[0].evidence_ids.push('E003');

  assert.equal(assessRecall(state, 'Q0001', ['ck-a']).hit_total, 0);
  assert.equal(assessRecall(state, 'Q0001', ['ck-b']).hit_total, 0);
  assert.equal(assessRecall(state, 'Q0001', ['customer_service']).hit_total, 0);
  assert.equal(assessRecall(state, 'Q0001', ['ck-a', 'ck-b']).hit_total, 1);
});

test('deleting an evidence cleans fact and chunk relations', () => {
  const state = fixture();
  createEvidence(state, { title: 'A', excerpt: 'A', chunks: [{ chunk_id: 'ck-a', content: 'A' }] });
  state.fact_evidence.push({ fact_id: 'F001', evidence_ids: ['E001'], operator: 'OR' });
  deleteEntity(state, 'evidences', 'E001');
  assert.deepEqual(state.fact_evidence, []);
  assert.deepEqual(state.evidence_chunks, []);
  assert.equal(state.chunks.length, 1);
});

test('invalid JSON returns a remote error', () => {
  assert.throws(() => parseSuggestions('not json'), GoldenError);
});

test('parseSuggestions accepts bare JSON and fenced JSON', () => {
  const bare = parseSuggestions('{"canonical":"它是药品还是保健品？","variants":[{"text":"Rayaldee 算不算药物？","variant_type":"paraphrase"}]}', []);
  assert.equal(bare.length, 2);
  assert.equal(bare[0].variant_type, 'canonical');
  assert.equal(bare[1].variant_type, 'paraphrase');

  const fenced = parseSuggestions('```json\n[{"text":"多少钱一盒？","variant_type":"follow_up","rationale":"价格追问"}]\n```', []);
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].variant_type, 'follow_up');
});

test('parseSuggestions removes duplicates against existing queries', () => {
  const result = parseSuggestions('{"canonical":"它是药品？","variants":[{"text":"它是药品吗？","variant_type":"colloquial"}]}', ['它是药品']);
  assert.deepEqual(result, [{ text: '它是药品吗？', variant_type: 'colloquial', rationale: '' }]);
});

test('evidenceInventory counts m:n links and unlinked rows', () => {
  const state = fixture();
  state.chunks.push(
    { chunk_id: 'ck-a', content: 'Rayaldee 产品定位', source: 'ragflow' },
    { chunk_id: 'ck-b', content: 'Rayaldee 剂量', source: 'ragflow' },
    { chunk_id: 'ck-c', content: '骨化二醇背景', source: 'ragflow' },
  );
  state.evidences.push(
    { evidence_id: 'E001', title: '说明书', excerpt: 'Rayaldee 药品', status: 'draft' },
    { evidence_id: 'E002', title: '剂量资料', excerpt: '成人每日 30 μg', status: 'draft' },
    { evidence_id: 'E003', title: '待补证据', excerpt: '尚缺 Chunk', status: 'draft' },
  );
  state.evidence_chunks.push(
    { evidence_id: 'E001', chunk_ids: ['ck-a', 'ck-b'] },
    { evidence_id: 'E002', chunk_ids: ['ck-b', 'ck-c'] },
    { evidence_id: 'E003', chunk_ids: ['missing'] },
  );

  assert.deepEqual(evidenceInventory(state), {
    evidence_count: 3,
    chunk_count: 3,
    linked_chunk_count: 3,
    unlinked_chunk_count: 0,
    evidence_without_chunk_count: 1,
  });

  state.evidence_chunks[1].chunk_ids = [];
  assert.deepEqual(evidenceInventory(state), {
    evidence_count: 3,
    chunk_count: 3,
    linked_chunk_count: 2,
    unlinked_chunk_count: 1,
    evidence_without_chunk_count: 2,
  });
});

test('autoMatchQuery ranks deterministically, filters, and does not mutate state', () => {
  const state = fixture();
  state.facts.push({ fact_id: 'F002', statement: '成人每日 30 μg 骨化二醇。', topic: '用法用量', source_note: 'Rayaldee 说明书', fact_type: 'usage', importance: 'P0', status: 'draft' });
  state.query_facts.push(
    { query_id: 'Q0001', fact_id: 'F001', requirement: 'required' },
    { query_id: 'Q0001', fact_id: 'F002', requirement: 'required' },
  );
  state.evidences.push(
    { evidence_id: 'E001', title: '产品定位证据', excerpt: 'Rayaldee 是药品。', status: 'draft' },
    { evidence_id: 'E002', title: '剂量证据', excerpt: '成人每日 30 μg。', status: 'draft' },
  );
  state.fact_evidence.push(
    { fact_id: 'F001', evidence_ids: ['E001'], operator: 'OR' },
    { fact_id: 'F002', evidence_ids: ['E002'], operator: 'OR' },
  );
  state.chunks.push(
    { chunk_id: 'ck-b', content: 'Rayaldee 是药品。', source: 'ragflow' },
    { chunk_id: 'ck-a', content: '成人每日 30 μg 骨化二醇。', source: 'ragflow' },
    { chunk_id: 'ck-c', content: '与骨化二醇无关的储存条件。', source: 'ragflow' },
  );
  state.evidence_chunks.push({ evidence_id: 'E001', chunk_ids: ['ck-b'] });

  const before = JSON.stringify(state);
  const candidates = [
    { chunk_id: 'ck-a', content: '成人每日 30 μg 骨化二醇。', similarity: 0.4 },
    { chunk_id: 'ck-z', content: 'Rayaldee 是药品。', similarity: 0.8 },
    { chunk_id: 'ck-b', content: 'Rayaldee 是药品。', similarity: 0.8 },
    { chunk_id: 'ck-c', content: '与骨化二醇无关的储存条件。', similarity: 0.2 },
  ];
  const result = autoMatchQuery(state, 'Q0001', candidates, { topK: 2, minSimilarity: 0.5 });

  assert.deepEqual(result.fact_ids, ['F001', 'F002']);
  assert.equal(result.query_text, '这个药是药品还是保健品？');
  assert.deepEqual(result.candidates.map((row) => row.chunk_id), ['ck-b', 'ck-z']);
  assert.deepEqual(result.candidates[0].matched_fact_ids, ['F001', 'F002']);
  assert.deepEqual(result.candidates[0].matched_evidence_ids, ['E001']);
  assert.equal(result.candidates[0].is_linked, true);
  assert.equal(result.candidates[1].is_linked, false);
  assert.equal(candidates[0].matched_fact_ids, undefined);
  assert.equal(JSON.stringify(state), before);

  const lexical = autoMatchQuery(state, 'Q0001', [
    { chunk_id: 'ck-a', content: '成人每日 30 μg 骨化二醇。' },
    { chunk_id: 'ck-c', content: '与骨化二醇无关的储存条件。' },
  ], { minSimilarity: 0.6 });
  assert.deepEqual(lexical.candidates.map((row) => row.chunk_id), ['ck-a']);
  assert.equal(lexical.candidates[0].similarity, 1);
  assert.throws(() => autoMatchQuery(state, 'Q9999', []), GoldenError);
});
