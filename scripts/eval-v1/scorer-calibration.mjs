import path from 'node:path';
import { ensureNewDir, fileHash, readJson, readJsonl, sha256, writeJsonlNew, writeJsonNew, writeNew } from './common.mjs';
import { LABELS, validateSemanticOutput } from './query-semantic-judge.mjs';
import { scoreGoldChunks } from './gold-chunk-scorer.mjs';
import { scoreEvidenceText } from './evidence-text-scorer.mjs';
import { calibrationHtml } from './calibration-ui.mjs';

const REQUIRED_CATEGORIES = ['exact', 'equivalent', 'partial', 'wrong_value_unit', 'population', 'time', 'negation', 'multi_chunk', 'irrelevant', 'contradiction'];

function inputRecord(query, row) { return { query_id: query.query_id, query_text: query.query_text, retrieved_chunks: row.chunks.map((c) => ({ chunk_id: c.chunk_id, text: c.chunk_text })) }; }
function fraction(n, d) { return d ? n / d : null; }

export function makeCalibrationSet({ snapshotPath, retrievalPath, outputDir, count = 120, seed = 'calibration-v1' }) {
  const snapshot = readJson(snapshotPath); const byId = new Map(readJsonl(retrievalPath).map((r) => [r.query_id, r]));
  const evidence = new Map(snapshot.evidences.map((e) => [e.evidence_id, e])); const groups = new Map();
  for (const query of snapshot.queries) {
    const row = byId.get(query.query_id);
    if (query.expected_behavior !== 'answer' || !row || row.error) continue;
    const gold = scoreGoldChunks(query, evidence, row); const text = scoreEvidenceText(query, evidence, row);
    const group = `${gold.status === 'scored' ? Number(gold.hit) : 'U'}-${text.status === 'scored' ? Number(text.covered) : 'U'}`;
    groups.set(group, [...(groups.get(group) || []), { query, row, key: sha256(`${seed}\0${query.query_id}`) }]);
  }
  for (const rows of groups.values()) rows.sort((a, b) => a.key.localeCompare(b.key));
  const selected = []; const groupNames = [...groups.keys()].sort();
  while (selected.length < count && groupNames.some((name) => groups.get(name).length)) {
    for (const name of groupNames) { const candidate = groups.get(name).shift(); if (candidate && selected.length < count) selected.push(candidate); }
  }
  selected.sort((a, b) => a.key.localeCompare(b.key));
  const records = selected.map(({ query, row }) => { const input = inputRecord(query, row); return { ...input, input_sha256: sha256(JSON.stringify(input)), human_label: null, human_supporting_chunk_ids: [], human_missing_information: [], categories: [], annotator_id: null, ambiguous: false, notes: '' }; });
  ensureNewDir(outputDir);
  writeJsonlNew(path.join(outputDir, 'human-calibration-blank.jsonl'), records);
  writeJsonNew(path.join(outputDir, 'manifest.json'), { schema_version: 'query-semantic-calibration-set/1.0', snapshot_sha256: fileHash(snapshotPath), retrieval_sha256: fileHash(retrievalPath), sample_count: records.length, seed, sampling: 'deterministic round-robin across programmatic gold/text score combinations; no model output used', annotation_blinding: 'Model labels are absent from the calibration input.' });
  writeNew(path.join(outputDir, 'human-calibration.html'), calibrationHtml(records, `ragflow-calibration:${fileHash(snapshotPath)}:${fileHash(retrievalPath)}:${seed}`));
  writeNew(path.join(outputDir, 'instructions.md'), '# 语义评分人工校准\n\n逐条只看 Query 和本次返回的 Chunk，独立标注 human_label：完全支持、部分支持、不支持、明确冲突。不得事先查看模型标签。引用 human_supporting_chunk_ids；部分支持记录 human_missing_information。填写 annotator_id 和覆盖类别；持续有分歧的样本设置 ambiguous=true，不用于硬门槛。categories 使用以下代码，可多选：exact 精确命中、equivalent 同义、partial 部分、wrong_value_unit 数值或单位、population 人群、time 时间、negation 否定、multi_chunk 多 Chunk、irrelevant 答非所问、contradiction 冲突。保留 input_sha256 与原始输入。\n');
  return records;
}

export function calibrate({ snapshotPath, retrievalPath, annotationPath, semanticPath, repeatPath = null, outputPath }) {
  const snapshot = readJson(snapshotPath); const queryById = new Map(snapshot.queries.map((q) => [q.query_id, q]));
  const retrievalById = new Map(readJsonl(retrievalPath).map((r) => [r.query_id, r]));
  const judgeMeta = readJson(`${semanticPath}.manifest.json`);
  if (judgeMeta.snapshot_sha256 !== fileHash(snapshotPath) || judgeMeta.retrieval_sha256 !== fileHash(retrievalPath)) throw new Error('Calibration judge inputs mismatch');
  const judgeRows = new Map(readJsonl(semanticPath).map((r) => [r.query_id, r]));
  let repeatRows = new Map();
  if (repeatPath) {
    const repeatMeta = readJson(`${repeatPath}.manifest.json`);
    for (const key of ['snapshot_sha256', 'retrieval_sha256', 'judge_version', 'judge_code_sha256', 'prompt_sha256', 'model', 'endpoint_host', 'temperature', 'max_tokens']) if (repeatMeta[key] !== judgeMeta[key]) throw new Error(`Repeat metadata mismatch: ${key}`);
    repeatRows = new Map(readJsonl(repeatPath).map((r) => [r.query_id, r]));
  }
  const annotations = readJsonl(annotationPath); const seen = new Set(); const matrix = Object.fromEntries(LABELS.map((l) => [l, Object.fromEntries(LABELS.map((p) => [p, 0]))]));
  let pending = 0; let ambiguous = 0; let evaluated = 0; let same = 0; let repeats = 0; let stable = 0; let sampleRepeats = 0; let sampleStable = 0; const missing = []; const categories = {};
  for (const item of annotations) {
    if (seen.has(item.query_id)) throw new Error(`Duplicate calibration query ${item.query_id}`); seen.add(item.query_id);
    const q = queryById.get(item.query_id); const r = retrievalById.get(item.query_id);
    const suppliedInput = { query_id: item.query_id, query_text: item.query_text, retrieved_chunks: item.retrieved_chunks };
    if (!q || !r || item.input_sha256 !== sha256(JSON.stringify(inputRecord(q, r))) || item.input_sha256 !== sha256(JSON.stringify(suppliedInput))) throw new Error(`Calibration input mismatch ${item.query_id}`);
    const sampleModel = judgeRows.get(item.query_id); const sampleRepeat = repeatRows.get(item.query_id);
    if (sampleModel?.status === 'scored' && sampleRepeat?.status === 'scored') { sampleRepeats += 1; if (sampleModel.label === sampleRepeat.label) sampleStable += 1; }
    if (item.ambiguous) { ambiguous += 1; continue; }
    if (!LABELS.includes(item.human_label) || typeof item.annotator_id !== 'string' || !item.annotator_id.trim()) { pending += 1; continue; }
    try {
      validateSemanticOutput({ label: item.human_label, supporting_chunk_ids: item.human_supporting_chunk_ids, missing_information: item.human_missing_information, reason: item.notes || '人工标注' }, new Set(r.chunks.map((chunk) => chunk.chunk_id)));
      if (!Array.isArray(item.categories) || item.categories.some((category) => !REQUIRED_CATEGORIES.includes(category))) throw new Error('invalid_categories');
    } catch { pending += 1; continue; }
    for (const category of item.categories || []) categories[category] = (categories[category] || 0) + 1;
    const model = judgeRows.get(item.query_id);
    if (!model || model.status !== 'scored' || !LABELS.includes(model.label)) { missing.push(item.query_id); continue; }
    matrix[item.human_label][model.label] += 1; evaluated += 1; if (item.human_label === model.label) same += 1;
    const repeat = repeatRows.get(item.query_id);
    if (repeat?.status === 'scored' && LABELS.includes(repeat.label)) { repeats += 1; if (repeat.label === model.label) stable += 1; }
  }
  const tp = matrix['完全支持']['完全支持'];
  const predictedFull = LABELS.reduce((n, label) => n + matrix[label]['完全支持'], 0);
  const actualFull = LABELS.reduce((n, label) => n + matrix['完全支持'][label], 0);
  const precision = fraction(tp, predictedFull); const recall = fraction(tp, actualFull); const accuracy = fraction(same, evaluated); const stability = fraction(stable, repeats);
  const missingCategories = REQUIRED_CATEGORIES.filter((category) => !categories[category]);
  const enough = evaluated >= 100 && pending === 0 && missing.length === 0 && repeats === evaluated && missingCategories.length === 0;
  const passed = enough && precision !== null && precision >= 0.95 && recall !== null && recall >= 0.90 && accuracy >= 0.90 && stability >= 0.99;
  const result = { schema_version: 'query-semantic-calibration-report/1.0', status: passed ? 'passed' : enough ? 'failed' : 'incomplete', sample_count: annotations.length, evaluated, pending, ambiguous, missing_model_results: missing, confusion_matrix: matrix, full_support_precision: precision, full_support_recall: recall, agreement: accuracy, repeat_stability: stability, repeated_items: repeats, sample_repeat_comparison: { repeated_items: sampleRepeats, stable_items: sampleStable, stability: fraction(sampleStable, sampleRepeats), note: 'Model-to-model comparison only; independent human calibration remains required.' }, categories, missing_required_categories: missingCategories, model: judgeMeta.model, endpoint_host: judgeMeta.endpoint_host, judge_version: judgeMeta.judge_version, judge_code_sha256: judgeMeta.judge_code_sha256, prompt_sha256: judgeMeta.prompt_sha256, snapshot_sha256: judgeMeta.snapshot_sha256, retrieval_sha256: judgeMeta.retrieval_sha256, annotation_sha256: fileHash(annotationPath), semantic_sha256: fileHash(semanticPath), repeat_sha256: repeatPath ? fileHash(repeatPath) : null, thresholds: { min_human_labels: 100, full_precision: 0.95, full_recall: 0.90, agreement: 0.90, repeat_stability: 0.99, repeated_items: 'all evaluated items', required_categories: REQUIRED_CATEGORIES } };
  writeJsonNew(outputPath, result); return result;
}
