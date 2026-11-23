import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNewDir, fileHash, readJson, readJsonl, SCORER_VERSION, sha256, writeJsonlNew, writeJsonNew, writeNew } from './common.mjs';
import { scoreGoldChunks } from './gold-chunk-scorer.mjs';
import { scoreEvidenceText } from './evidence-text-scorer.mjs';
import { normalizeText } from './common.mjs';

function ratio(n, d) { return d ? n / d : null; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function csvCell(value) {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function bucket(gold, text, semantic) {
  if (gold.status !== 'scored' || text.status !== 'scored' || semantic.status !== 'scored') return 'UNSCORABLE_OR_SEMANTIC_UNAVAILABLE';
  if (!gold.hit && !text.covered && semantic.label === '完全支持') return 'GOLD_MISS_BUT_SEMANTIC_SUPPORTED';
  if (!gold.hit && !text.covered && ['部分支持', '不支持'].includes(semantic.label)) return 'GOLD_AND_SEMANTIC_NOT_FULL';
  if (gold.hit && text.covered && semantic.label === '完全支持') return 'ALL_AGREE_SUPPORTED';
  if (gold.hit && !text.covered && semantic.label === '完全支持') return 'GOLD_HIT_TEXT_MISS_SEMANTIC_SUPPORTED';
  if (gold.hit && text.covered && ['部分支持', '不支持'].includes(semantic.label)) return 'GOLD_HIT_SEMANTIC_NOT_FULL';
  if (!gold.hit && text.covered && semantic.label === '完全支持') return 'TEXT_COVERED_GOLD_ID_MISS';
  return `G${Number(gold.hit)}_T${Number(text.covered)}_${semantic.label}`;
}

export function buildReport({ snapshotPath, retrievalDir, semanticPath = null, sourceOrderAuditPath = null, calibrationPath = null, outputDir }) {
  const snapshot = readJson(snapshotPath); const retrievalPath = path.join(retrievalDir, 'retrieval.jsonl');
  const retrievalManifest = readJson(path.join(retrievalDir, 'manifest.json'));
  if (retrievalManifest.snapshot_sha256 !== fileHash(snapshotPath)) throw new Error('Retrieval snapshot hash mismatch');
  if (retrievalManifest.normalized_retrieval_sha256 !== fileHash(retrievalPath)) throw new Error('Retrieval data hash mismatch');
  const retrieval = new Map(readJsonl(retrievalPath).map((r) => [r.query_id, r]));
  const sourceOrderAudit = sourceOrderAuditPath ? readJson(sourceOrderAuditPath) : null;
  if (sourceOrderAudit && sourceOrderAudit.retrieval_sha256 !== fileHash(retrievalPath)) throw new Error('Source order audit retrieval hash mismatch');
  for (const item of sourceOrderAudit?.records || []) {
    const row = retrieval.get(item.query_id);
    if (!row || !Array.isArray(item.chunks) || item.chunks.length < 2) throw new Error(`Invalid source order audit for ${item.query_id}`);
    const ordered = item.chunks.map((entry) => {
      const found = row.chunks.find((chunk) => chunk.chunk_id === entry.chunk_id && chunk.rank === entry.rank);
      if (!found || !Number.isInteger(entry.source_order) || entry.chunk_text_sha256 !== sha256(found.chunk_text) || (entry.quote && !normalizeText(found.chunk_text).includes(normalizeText(entry.quote)))) throw new Error(`Source order audit does not match retrieval ${item.query_id}/${entry.chunk_id}`);
      return { entry, found };
    });
    ordered.sort((a, b) => a.entry.source_order - b.entry.source_order);
    if (ordered.some(({ found }, i) => !found.source_document_id || !found.dataset_id || found.source_document_id !== ordered[0].found.source_document_id || found.dataset_id !== ordered[0].found.dataset_id || (i > 0 && ordered[i].entry.source_order !== ordered[i - 1].entry.source_order + 1))) throw new Error(`Source order audit is not a consecutive same-document sequence: ${item.query_id}`);
    for (const { entry, found } of ordered) {
      if (found.source_order !== null && found.source_order !== entry.source_order) throw new Error(`Conflicting source order for ${item.query_id}/${entry.chunk_id}`);
      found.source_order = entry.source_order;
      found.source_order_provenance = item.source;
    }
  }
  let semantic = new Map(); let semanticManifest = null;
  if (semanticPath) {
    semanticManifest = readJson(`${semanticPath}.manifest.json`);
    if (semanticManifest.snapshot_sha256 !== fileHash(snapshotPath) || semanticManifest.retrieval_sha256 !== fileHash(retrievalPath)) throw new Error('Semantic results do not match snapshot/retrieval');
    for (const row of readJsonl(semanticPath)) {
      if (semantic.has(row.query_id)) throw new Error(`Duplicate semantic result: ${row.query_id}`);
      semantic.set(row.query_id, row);
    }
  }
  const calibration = calibrationPath ? readJson(calibrationPath) : null;
  if (calibration && (!semanticPath || calibration.snapshot_sha256 !== fileHash(snapshotPath) || calibration.retrieval_sha256 !== fileHash(retrievalPath) || calibration.semantic_sha256 !== fileHash(semanticPath))) throw new Error('Calibration results do not match experiment inputs');
  const evidence = new Map(snapshot.evidences.map((e) => [e.evidence_id, e])); const details = [];
  for (const query of snapshot.queries.filter((q) => q.expected_behavior === 'answer')) {
    const row = retrieval.get(query.query_id);
    const missing = !row || row.error;
    const gold = missing ? { status: 'unscorable', hit: null, reasons: [row ? 'retrieval_error' : 'retrieval_missing'] } : scoreGoldChunks(query, evidence, row);
    const text = missing ? { status: 'unscorable', covered: null, reasons: [row ? 'retrieval_error' : 'retrieval_missing'] } : scoreEvidenceText(query, evidence, row);
    const model = semantic.get(query.query_id) || { status: 'unavailable', label: null, error: 'semantic_result_not_available' };
    details.push({ experiment_id: retrievalManifest.experiment_id, query_id: query.query_id, query_text: query.query_text, k: retrievalManifest.k, retrieved_chunks: row?.chunks || [], retrieval_error: row?.error || (row ? null : 'retrieval_missing'), gold_chunk_score: gold, evidence_coverage_score: text, semantic_score: model, diagnosis_bucket: bucket(gold, text, model) });
  }
  const goldRows = details.filter((r) => r.gold_chunk_score.status === 'scored');
  const textRows = details.filter((r) => r.evidence_coverage_score.status === 'scored');
  const semanticRows = details.filter((r) => r.semantic_score.status === 'scored');
  const completeDiff = details.filter((r) => r.diagnosis_bucket !== 'UNSCORABLE_OR_SEMANTIC_UNAVAILABLE');
  const buckets = {}; const reasons = {};
  for (const row of details) {
    buckets[row.diagnosis_bucket] = (buckets[row.diagnosis_bucket] || 0) + 1;
    for (const [name, score] of [['gold', row.gold_chunk_score], ['text', row.evidence_coverage_score]]) {
      if (score.status !== 'scored') for (const reason of score.reasons || []) reasons[`${name}:${reason}`] = (reasons[`${name}:${reason}`] || 0) + 1;
    }
    if (row.semantic_score.status !== 'scored') reasons[`semantic:${row.semantic_score.error || 'unavailable'}`] = (reasons[`semantic:${row.semantic_score.error || 'unavailable'}`] || 0) + 1;
  }
  const semanticCounts = Object.fromEntries(['完全支持', '部分支持', '不支持', '明确冲突'].map((label) => [label, semanticRows.filter((r) => r.semantic_score.label === label).length]));
  const goldEvidence = goldRows.flatMap((r) => r.gold_chunk_score.evidence);
  const goldHits = goldRows.filter((r) => r.gold_chunk_score.hit);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleHashes = Object.fromEntries(['common.mjs', 'snapshot-compiler.mjs', 'retrieval-store.mjs', 'gold-chunk-scorer.mjs', 'evidence-text-scorer.mjs', 'query-semantic-judge.mjs', 'aggregation-report.mjs', 'scorer-calibration.mjs', 'calibration-ui.mjs'].map((name) => [name, fileHash(path.join(moduleDir, name))]));
  const summary = {
    schema_version: 'ragflow-eval-report/1.0', experiment_id: retrievalManifest.experiment_id, k: retrievalManifest.k,
    snapshot_sha256: fileHash(snapshotPath), retrieval_manifest_sha256: fileHash(path.join(retrievalDir, 'manifest.json')),
    semantic_sha256: semanticPath ? fileHash(semanticPath) : null, source_order_audit_sha256: sourceOrderAuditPath ? fileHash(sourceOrderAuditPath) : null, scorer_version: SCORER_VERSION, scorer_module_sha256: moduleHashes, semantic_manifest: semanticManifest,
    calibration: calibration ? { report_sha256: fileHash(calibrationPath), status: calibration.status, human_evaluated: calibration.evaluated, sample_repeat_comparison: calibration.sample_repeat_comparison } : null,
    status: 'experimental', formal_baseline_blockers: [...(!calibration || calibration.status !== 'passed' ? ['semantic_judge_not_human_calibrated'] : []), ...(calibration?.sample_repeat_comparison?.stability != null && calibration.sample_repeat_comparison.stability < 0.99 ? ['semantic_sample_repeat_stability_below_99_percent'] : []), ...(retrievalManifest.ragflow_dataset_version === 'unrecorded' ? ['ragflow_dataset_version_unrecorded'] : []), ...(retrievalManifest.document_versions === 'unrecorded' ? ['document_versions_unrecorded'] : [])],
    answer_queries: details.length,
    gold_chunk_path_hit: { hits: goldRows.filter((r) => r.gold_chunk_score.hit).length, scorable: goldRows.length, rate: ratio(goldRows.filter((r) => r.gold_chunk_score.hit).length, goldRows.length), coverage: ratio(goldRows.length, details.length) },
    evidence_chunk_diagnostic: { hits: goldEvidence.filter((e) => e.hit).length, evaluated_query_evidence_pairs: goldEvidence.length, rate: ratio(goldEvidence.filter((e) => e.hit).length, goldEvidence.length), note: 'Diagnostic only: alternative Evidence paths are separate entries.' },
    earliest_complete_rank_counts: Object.fromEntries([...new Set(goldHits.map((r) => r.gold_chunk_score.earliest_complete_rank))].sort((a, b) => a - b).map((rank) => [rank, goldHits.filter((r) => r.gold_chunk_score.earliest_complete_rank === rank).length])),
    evidence_path_text_coverage: { hits: textRows.filter((r) => r.evidence_coverage_score.covered).length, scorable: textRows.length, rate: ratio(textRows.filter((r) => r.evidence_coverage_score.covered).length, textRows.length), coverage: ratio(textRows.length, details.length), constrained_queries: textRows.filter((r) => r.evidence_coverage_score.constrained_text_check).length },
    semantic: { scored: semanticRows.length, eligible: details.length, coverage: ratio(semanticRows.length, details.length), counts: semanticCounts, full_support_rate: ratio(semanticCounts['完全支持'], semanticRows.length), partial_support_rate: ratio(semanticCounts['部分支持'], semanticRows.length), conflict_rate: ratio(semanticCounts['明确冲突'], semanticRows.length), calibrated: calibration?.status === 'passed' },
    diagnosis: { comparable_queries: completeDiff.length, buckets: Object.fromEntries(Object.entries(buckets).map(([key, count]) => [key, { count, proportion_of_answer_queries: ratio(count, details.length), proportion_of_comparable_queries: key === 'UNSCORABLE_OR_SEMANTIC_UNAVAILABLE' ? null : ratio(count, completeDiff.length) }])) },
    unscorable_reasons: reasons,
  };
  ensureNewDir(outputDir);
  writeJsonlNew(path.join(outputDir, 'query-results.jsonl'), details);
  writeJsonNew(path.join(outputDir, 'report.json'), summary);
  const columns = ['query_id', 'query_text', 'gold_status', 'gold_hit', 'gold_evidence_path', 'earliest_rank', 'text_status', 'text_covered', 'text_evidence_path', 'semantic_status', 'semantic_label', 'supporting_chunk_ids', 'missing_information', 'semantic_reason', 'diagnosis_bucket', 'retrieved_chunks'];
  const csv = [columns.map(csvCell).join(','), ...details.map((r) => [r.query_id, r.query_text, r.gold_chunk_score.status, r.gold_chunk_score.hit, r.gold_chunk_score.matched_evidence_path_id, r.gold_chunk_score.earliest_complete_rank, r.evidence_coverage_score.status, r.evidence_coverage_score.covered, r.evidence_coverage_score.matched_evidence_path_id, r.semantic_score.status, r.semantic_score.label, r.semantic_score.supporting_chunk_ids, r.semantic_score.missing_information, r.semantic_score.reason, r.diagnosis_bucket, r.retrieved_chunks].map(csvCell).join(','))].join('\r\n');
  writeNew(path.join(outputDir, 'query-results.csv'), `\ufeff${csv}\r\n`);
  const p = (item) => item.rate === null ? '不可评分' : `${item.hits}/${item.scorable} = ${(100 * item.rate).toFixed(2)}%`;
  const semP = (n) => semanticRows.length ? `${n}/${semanticRows.length} = ${(100 * n / semanticRows.length).toFixed(2)}%` : '不可评分';
  const repeatSummary = calibration?.sample_repeat_comparison?.repeated_items ? `；校准样本重复标签一致 ${calibration.sample_repeat_comparison.stable_items}/${calibration.sample_repeat_comparison.repeated_items}` : '';
  writeNew(path.join(outputDir, 'report.md'), `# RAGFlow 第一版评测重算\n\n实验：${summary.experiment_id}；Top-${summary.k}；答案型 Query：${details.length}。本报告为实验性结果，不可作为正式 KPI。\n\n| 指标 | 结果 |\n| --- | ---: |\n| 标准文本块路径命中率 | ${p(summary.gold_chunk_path_hit)} |\n| 标准证据完整覆盖率 | ${p(summary.evidence_path_text_coverage)} |\n| 语义完全支持率 | ${semP(semanticCounts['完全支持'])} |\n| 语义部分支持率 | ${semP(semanticCounts['部分支持'])} |\n| 语义冲突率 | ${semP(semanticCounts['明确冲突'])} |\n| 语义评分覆盖 | ${semanticRows.length}/${details.length} |\n\n可比较差异桶：${completeDiff.length}/${details.length}。完整桶计数、可评分原因、版本和哈希见 report.json；实际 Top-K、路径和逐题结果见 query-results.jsonl。\n\n跨 Chunk 文本结果中 ${summary.evidence_path_text_coverage.constrained_queries} 个可评分 Query 因大部分返回结果缺少可靠原文顺序，未独立确认的序列使用受 Gold 路径约束的检查。${sourceOrderAudit ? '已有核查的相邻 Chunk 顺序以独立审计文件补充。' : ''}RAGFlow 数据集和文档的历史版本${retrievalManifest.ragflow_dataset_version === 'unrecorded' ? '未记录' : '见清单'}；语义评分${calibration?.status === 'passed' ? '已通过本次人工校准' : '未经人工校准'}${repeatSummary}。\n`);
  const sections = details.map((r) => {
    const gold = r.gold_chunk_score.status !== 'scored' ? '不可评分' : r.gold_chunk_score.hit ? '命中' : '未命中';
    const text = r.evidence_coverage_score.status !== 'scored' ? '不可评分' : r.evidence_coverage_score.covered ? '完整覆盖' : '未完整覆盖';
    const sem = r.semantic_score.label || '不可评分';
    const scoreDetails = { gold_chunk_score: r.gold_chunk_score, evidence_coverage_score: r.evidence_coverage_score, semantic_score: r.semantic_score };
    const chunks = r.retrieved_chunks.map((c) => `<details class="chunk"><summary>第 ${c.rank} 名 · ${escapeHtml(c.chunk_id)} · ${escapeHtml(c.source_document_id || '未记录文档')}</summary><pre>${escapeHtml(c.chunk_text)}</pre></details>`).join('');
    return `<details class="query" data-search="${escapeHtml(`${r.query_id} ${r.query_text} ${r.diagnosis_bucket}`.toLowerCase())}"><summary><strong>${escapeHtml(r.query_id)}</strong> ${escapeHtml(r.query_text)} <span>Chunk：${gold} · Evidence：${text} · 语义：${escapeHtml(sem)}</span></summary><p>诊断：${escapeHtml(r.diagnosis_bucket)}</p><details><summary>评分路径与语义依据</summary><pre>${escapeHtml(JSON.stringify(scoreDetails, null, 2))}</pre></details><h3>本次 Top-${r.k}</h3>${chunks || '<p>没有返回 Chunk</p>'}</details>`;
  }).join('\n');
  writeNew(path.join(outputDir, 'report.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAGFlow 评测明细</title><style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#172333;background:#f5f7fa;margin:0}main{max-width:1100px;margin:0 auto;padding:28px}h1{font-size:26px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #a6b4c4;border-radius:5px;font:inherit}details.query{background:#fff;border:1px solid #d4dce5;border-radius:6px;margin:9px 0;padding:10px 14px}summary{cursor:pointer}summary span{display:block;color:#4a5b70}details.chunk{margin:8px 0 8px 14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f4f6f8;border-radius:4px}h3{font-size:15px;margin-bottom:5px}.note{color:#526276}</style></head><body><main><h1>RAGFlow 评测明细</h1><p>实验 ${escapeHtml(summary.experiment_id)} · Top-${summary.k} · ${details.length} 个答案型 Query</p><p class="note">Gold 路径 ${p(summary.gold_chunk_path_hit)}；Evidence 路径 ${p(summary.evidence_path_text_coverage)}；语义完全支持 ${semP(semanticCounts['完全支持'])}。${calibration?.status === 'passed' ? '语义评分已通过本次人工校准。' : '语义结果尚未经人工校准。'}</p><input id="filter" type="search" placeholder="搜索 Query ID、问题或诊断桶" aria-label="搜索评测明细"><div id="rows">${sections}</div></main><script>document.getElementById('filter').addEventListener('input',function(){const q=this.value.trim().toLowerCase();document.querySelectorAll('details.query').forEach(function(row){row.hidden=!row.dataset.search.includes(q)})})</script></body></html>`);
  return summary;
}
