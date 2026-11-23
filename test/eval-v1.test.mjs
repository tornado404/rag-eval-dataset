import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../scripts/eval-v1/common.mjs';
import { compileSnapshot } from '../scripts/eval-v1/snapshot-compiler.mjs';
import { scoreGoldChunks } from '../scripts/eval-v1/gold-chunk-scorer.mjs';
import { scoreEvidenceText } from '../scripts/eval-v1/evidence-text-scorer.mjs';
import { judgeOne, validateSemanticOutput, JUDGE_VERSION, PROMPT_SHA256 } from '../scripts/eval-v1/query-semantic-judge.mjs';
import { calibrate, makeCalibrationSet } from '../scripts/eval-v1/scorer-calibration.mjs';
import { buildReport } from '../scripts/eval-v1/aggregation-report.mjs';

const chunk = (id, text, rank, order = null) => ({ chunk_id: id, chunk_text: text, rank, source_document_id: 'D', dataset_id: 'DS', source_order: order });
const evidence = (id, text, paths) => ({ evidence_id: id, evidence_text: text, chunk_paths: paths.map((p, i) => ({ path_id: `CP${i + 1}`, chunk_ids: p.map((x) => x.chunk_id), chunks: p.map((x) => ({ chunk_id: x.chunk_id, content_sha256: sha256(x.chunk_text) })) })) });
const query = (...paths) => ({ query_id: 'Q', query_text: '问题', expected_behavior: 'answer', compile_complete: true, reasons: [], evidence_paths: paths.map((ids, i) => ({ path_id: `EP${i + 1}`, evidence_ids: ids })) });
const mockResponse = (label, ids = [], missing = []) => async () => ({ ok: true, json: async () => ({ model: 'mock', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ label, supporting_chunk_ids: ids, missing_information: missing, reason: '测试依据' }) } }] }) });
const judgeConfig = { model: 'mock', endpoint: 'https://localhost/v1/chat/completions' };

test('T01 单 Evidence 单 Chunk，两个确定性评分命中', () => {
  const c = chunk('C1', '证据全文', 1); const e = evidence('E1', '证据全文', [[c]]); const es = new Map([['E1', e]]); const q = query(['E1']);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c] }).hit, true);
  assert.equal(scoreEvidenceText(q, es, { chunks: [c] }).covered, true);
});

test('T02 缺少联合 Chunk 不得算完整', () => {
  const c1 = chunk('C1', '证据', 1, 10); const c2 = chunk('C2', '全文', 2, 11); const es = new Map([['E1', evidence('E1', '证据全文', [[c1, c2]])]]); const q = query(['E1']);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c1] }).hit, false);
  assert.equal(scoreEvidenceText(q, es, { chunks: [c1] }).covered, false);
});

test('T03 多 Chunk 路径与单 Chunk 路径为 OR', () => {
  const c1 = chunk('C1', '证据', 1); const c2 = chunk('C2', '全文', 2); const c8 = chunk('C8', '证据全文', 3); const es = new Map([['E1', evidence('E1', '证据全文', [[c1, c2], [c8]])]]);
  assert.equal(scoreGoldChunks(query(['E1']), es, { chunks: [c8] }).hit, true);
});

test('T04-T06 Evidence Path OR-of-AND 且记录最早完成排名', () => {
  const c1 = chunk('C1', '甲', 8); const c2 = chunk('C2', '乙', 2); const c3 = chunk('C3', '丙', 5);
  const es = new Map([['E1', evidence('E1', '甲', [[c1]])], ['E2', evidence('E2', '乙', [[c2]])], ['E3', evidence('E3', '丙', [[c3]])]]); const q = query(['E1'], ['E2', 'E3']);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c1] }).hit, true);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c2] }).hit, false);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c2, c3] }).earliest_complete_rank, 5);
  assert.equal(scoreEvidenceText(q, es, { chunks: [c2, c3] }).covered, true);
});

test('T07 格式空白不同允许文本覆盖', () => {
  const c = chunk('C1', '甲\n 乙\t丙', 1); const es = new Map([['E1', evidence('E1', '甲乙丙', [[c]])]]);
  assert.equal(scoreEvidenceText(query(['E1']), es, { chunks: [c] }).covered, true);
});

test('T08 数值不同不能通过逐字匹配，语义评分独立接收数值', async () => {
  const c = chunk('C1', '剂量 60 μg', 1); const es = new Map([['E1', evidence('E1', '剂量 30 μg', [[c]])]]);
  assert.equal(scoreEvidenceText(query(['E1']), es, { chunks: [c] }).covered, false);
  const result = await judgeOne(query(['E1']), { chunks: [c] }, judgeConfig, { fetchImpl: mockResponse('明确冲突', ['C1']), maxAttempts: 1 });
  assert.equal(result.label, '明确冲突');
});

test('T09 否定关系的冲突标签与引用被保留', async () => {
  const c = chunk('C1', '不得打开', 1); const result = await judgeOne(query(['E1']), { chunks: [c] }, judgeConfig, { fetchImpl: mockResponse('明确冲突', ['C1']), maxAttempts: 1 });
  assert.equal(result.label, '明确冲突'); assert.deepEqual(result.supporting_chunk_ids, ['C1']);
});

test('T10 Gold 与文本均未命中时，语义结果可独立完全支持', async () => {
  const gold = chunk('C1', '标准原句', 1); const alt = chunk('C8', '同义答案', 1); const q = query(['E1']); const es = new Map([['E1', evidence('E1', '标准原句', [[gold]])]]);
  assert.equal(scoreGoldChunks(q, es, { chunks: [alt] }).hit, false); assert.equal(scoreEvidenceText(q, es, { chunks: [alt] }).covered, false);
  assert.equal((await judgeOne(q, { chunks: [alt] }, judgeConfig, { fetchImpl: mockResponse('完全支持', ['C8']), maxAttempts: 1 })).label, '完全支持');
});

test('T11 Gold 与文本均命中时，语义结果仍可判部分支持', async () => {
  const c = chunk('C1', '部分信息', 1); const q = query(['E1']); const es = new Map([['E1', evidence('E1', '部分信息', [[c]])]]);
  assert.equal(scoreGoldChunks(q, es, { chunks: [c] }).hit, true); assert.equal(scoreEvidenceText(q, es, { chunks: [c] }).covered, true);
  assert.equal((await judgeOne(q, { chunks: [c] }, judgeConfig, { fetchImpl: mockResponse('部分支持', ['C1'], ['缺少条件']), maxAttempts: 1 })).label, '部分支持');
});

test('T12 模拟重复调用固定模型和提示词，真实稳定性须另行校准', async () => {
  const c = chunk('C1', '答案', 1); const options = { fetchImpl: mockResponse('完全支持', ['C1']), maxAttempts: 1 };
  const first = await judgeOne(query(['E1']), { chunks: [c] }, judgeConfig, options); const second = await judgeOne(query(['E1']), { chunks: [c] }, judgeConfig, options);
  assert.equal(first.label, second.label); assert.equal(first.judge_version, JUDGE_VERSION); assert.equal(first.prompt_sha256, PROMPT_SHA256);
});

test('非相邻 source_order 不得拼接；无序时可用已确认的路径约束', () => {
  const c1 = chunk('C1', '前半', 1, 1); const c2 = chunk('C2', '后半', 2, 3); const other = chunk('C9', '不相关', 9);
  const noPath = new Map([['E1', evidence('E1', '前半后半', [[other]])]]);
  assert.equal(scoreEvidenceText(query(['E1']), noPath, { chunks: [c1, c2] }).covered, false);
  c1.source_order = null; c2.source_order = null;
  const es = new Map([['E1', evidence('E1', '前半后半', [[c1, c2]])]]); const result = scoreEvidenceText(query(['E1']), es, { chunks: [c1, c2] });
  assert.equal(result.covered, true); assert.equal(result.evidence[0].method, 'constrained_text_check');
});

test('相同 ID 但正文发生变化不能作为 Gold 命中', () => {
  const original = chunk('C1', '原始', 1); const changed = chunk('C1', '改动', 1); const es = new Map([['E1', evidence('E1', '原始', [[original]])]]);
  assert.equal(scoreGoldChunks(query(['E1']), es, { chunks: [changed] }).status, 'unscorable');
});

test('语义评分仅接收 Query 和检索正文，并拒绝伪造 Chunk 引用', async () => {
  const c = chunk('C1', '内容', 1); let sent;
  const fake = async (_url, options) => { sent = JSON.parse(options.body); return mockResponse('完全支持', ['C1'])(); };
  const q = { ...query(['E1']), secret_gold: 'DO_NOT_SEND_GOLD' };
  assert.equal((await judgeOne(q, { chunks: [c] }, judgeConfig, { fetchImpl: fake, maxAttempts: 1 })).label, '完全支持');
  assert.equal(JSON.stringify(sent).includes('DO_NOT_SEND_GOLD'), false); assert.equal(JSON.stringify(sent).includes('evidence_paths'), false);
  assert.throws(() => validateSemanticOutput({ label: '完全支持', supporting_chunk_ids: ['FAKE'], missing_information: [], reason: 'x' }, new Set(['C1'])), /invalid_supporting_chunk_ids/);
});

test('编译器保留 required 的 AND、required_any 的 OR、Fact 的 AND/OR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragflow-eval-compile-'));
  const tables = {
    queries: [{ query_id: 'Q', text: '问题', expected_behavior: 'answer' }],
    facts: ['F1', 'F2', 'F3', 'F4'].map((fact_id) => ({ fact_id })),
    evidences: ['E1', 'E2', 'E3', 'E4', 'E5'].map((evidence_id) => ({ evidence_id, excerpt: evidence_id })),
    chunks: ['E1', 'E2', 'E3', 'E4', 'E5'].map((id) => ({ chunk_id: `C${id}`, content: id, document_id: 'D' })),
    query_facts: [{ query_id: 'Q', fact_id: 'F1', requirement: 'required' }, { query_id: 'Q', fact_id: 'F2', requirement: 'required_any', group_id: 'A' }, { query_id: 'Q', fact_id: 'F3', requirement: 'required_any', group_id: 'A' }, { query_id: 'Q', fact_id: 'F4', requirement: 'optional' }],
    fact_evidence: [{ fact_id: 'F1', operator: 'OR', evidence_ids: ['E1', 'E2'] }, { fact_id: 'F2', operator: 'OR', evidence_ids: ['E3'] }, { fact_id: 'F3', operator: 'AND', evidence_ids: ['E4', 'E5'] }],
    evidence_chunks: ['E1', 'E2', 'E3', 'E4', 'E5'].map((id) => ({ evidence_id: id, chunk_ids: [`C${id}`] })),
  };
  for (const [name, rows] of Object.entries(tables)) fs.writeFileSync(path.join(dir, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n'));
  const compiled = compileSnapshot(dir); const got = compiled.snapshot.queries[0].evidence_paths.map((p) => p.evidence_ids.join('+')).sort();
  assert.deepEqual(got, ['E1+E3', 'E1+E4+E5', 'E2+E3', 'E2+E4+E5']);
  assert.equal(JSON.stringify(compiled.snapshot).includes('F1'), false);
});

test('人工未标注时校准必须保持 incomplete，重复标签只作为模型稳定性', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragflow-eval-calibrate-'));
  const c = chunk('C1', '答案', 1); const q = query(['E1']); const e = evidence('E1', '答案', [[c]]);
  const snapshotPath = path.join(dir, 'snapshot.json'); const retrievalPath = path.join(dir, 'retrieval.jsonl');
  fs.writeFileSync(snapshotPath, JSON.stringify({ queries: [q], evidences: [e] })); fs.writeFileSync(retrievalPath, `${JSON.stringify({ query_id: 'Q', chunks: [c] })}\n`);
  const setDir = path.join(dir, 'set'); const records = makeCalibrationSet({ snapshotPath, retrievalPath, outputDir: setDir, count: 1 });
  const meta = { snapshot_sha256: sha256(fs.readFileSync(snapshotPath)), retrieval_sha256: sha256(fs.readFileSync(retrievalPath)), judge_version: JUDGE_VERSION, judge_code_sha256: 'code', prompt_sha256: PROMPT_SHA256, model: 'mock', endpoint_host: 'local', temperature: 0, max_tokens: 4000 };
  const semantic = path.join(dir, 'semantic.jsonl'); const repeat = path.join(dir, 'repeat.jsonl');
  for (const file of [semantic, repeat]) { fs.writeFileSync(file, `${JSON.stringify({ query_id: 'Q', status: 'scored', label: '完全支持' })}\n`); fs.writeFileSync(`${file}.manifest.json`, JSON.stringify(meta)); }
  const result = calibrate({ snapshotPath, retrievalPath, annotationPath: path.join(setDir, 'human-calibration-blank.jsonl'), semanticPath: semantic, repeatPath: repeat, outputPath: path.join(dir, 'report.json') });
  assert.equal(records[0].human_label, null); assert.equal(result.status, 'incomplete'); assert.equal(result.pending, 1);
  assert.equal(result.sample_repeat_comparison.stability, 1); assert.equal(result.full_support_precision, null);
});

test('补充顺序须绑定回包和正文；HTML 明细转义不可信内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragflow-eval-report-')); const retrievalDir = path.join(dir, 'retrieval'); fs.mkdirSync(retrievalDir);
  const c1 = chunk('C1', '前半', 1); const c2 = chunk('C2', '后半', 2); const source = chunk('C9', '前半后半', 9);
  const q = { ...query(['E1']), query_text: '<img src=x onerror=alert(1)>' }; const e = evidence('E1', '前半后半', [[source]]);
  const snapshotPath = path.join(dir, 'snapshot.json'); fs.writeFileSync(snapshotPath, JSON.stringify({ queries: [q], evidences: [e] }));
  const retrievalPath = path.join(retrievalDir, 'retrieval.jsonl'); fs.writeFileSync(retrievalPath, `${JSON.stringify({ query_id: 'Q', chunks: [c1, c2] })}\n`);
  fs.writeFileSync(path.join(retrievalDir, 'manifest.json'), JSON.stringify({ snapshot_sha256: sha256(fs.readFileSync(snapshotPath)), normalized_retrieval_sha256: sha256(fs.readFileSync(retrievalPath)), experiment_id: 'E', k: 12, ragflow_dataset_version: 'unrecorded', document_versions: 'unrecorded' }));
  const audit = { retrieval_sha256: sha256(fs.readFileSync(retrievalPath)), records: [{ query_id: 'Q', source: 'audit', chunks: [c1, c2].map((c, i) => ({ chunk_id: c.chunk_id, rank: c.rank, source_order: i + 1, chunk_text_sha256: sha256(c.chunk_text) })) }] };
  const auditPath = path.join(dir, 'audit.json'); fs.writeFileSync(auditPath, JSON.stringify(audit));
  const result = buildReport({ snapshotPath, retrievalDir, sourceOrderAuditPath: auditPath, outputDir: path.join(dir, 'report') });
  assert.equal(result.evidence_path_text_coverage.hits, 1);
  const html = fs.readFileSync(path.join(dir, 'report', 'report.html'), 'utf8'); assert.equal(html.includes('<img src=x'), false); assert.equal(html.includes('&lt;img'), true);
  audit.records[0].chunks[0].chunk_text_sha256 = 'wrong'; fs.writeFileSync(auditPath, JSON.stringify(audit));
  assert.throws(() => buildReport({ snapshotPath, retrievalDir, sourceOrderAuditPath: auditPath, outputDir: path.join(dir, 'bad') }), /does not match retrieval/);
});
