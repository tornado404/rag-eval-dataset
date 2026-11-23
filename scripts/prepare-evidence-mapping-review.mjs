#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidenceMappingCandidates, createEvidenceMappingRevision } from './lib/evidence-mappings.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_TABLES = ['queries', 'facts', 'evidences', 'chunks', 'query_facts', 'fact_evidence', 'evidence_chunks'];

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
}

function writeTable(file, rows) {
  writeJsonl(file, rows || []);
}

const options = parseArgs(process.argv.slice(2));
const inputFile = path.resolve(options.inputState || '');
const outputDir = path.resolve(options.outputDir || '');
const experimentVersion = options.experimentVersion || 'source-anchor-v1';
if (!options.inputState) throw new Error('--input-state is required');
if (!options.outputDir) throw new Error('--output-dir is required');
if (!fs.existsSync(inputFile)) throw new Error(`state file not found: ${inputFile}`);
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(experimentVersion)) throw new Error('invalid --experiment-version');
const relativeOutput = path.relative(REPO_ROOT, outputDir);
if (relativeOutput === '' || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput))) {
  throw new Error('--output-dir must be outside the source repository because Golden data is private');
}

const state = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
for (const table of STATE_TABLES) {
  if (!Array.isArray(state[table])) throw new Error(`input state is missing table ${table}`);
}
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
  throw new Error(`output directory must be empty: ${outputDir}`);
}

const { revisions, auditRows } = buildEvidenceMappingCandidates(state, experimentVersion);
const relationEdgeCount = state.evidence_chunks.reduce((count, row) => count + (row.chunk_ids || []).length, 0);
let manualAnchorCount = 0;
if (options.overrides) {
  const overrides = JSON.parse(fs.readFileSync(path.resolve(options.overrides), 'utf8'));
  if (!Array.isArray(overrides)) throw new Error('--overrides must contain a JSON array');
  const seenOverrides = new Set();
  for (const override of overrides) {
    if (seenOverrides.has(override.evidence_id)) throw new Error(`duplicate override for ${override.evidence_id}`);
    seenOverrides.add(override.evidence_id);
    const rowIndex = auditRows.findIndex((row) => row.evidence_id === override.evidence_id);
    if (rowIndex < 0) throw new Error(`override evidence not found: ${override.evidence_id}`);
    const original = auditRows[rowIndex];
    const revision = createEvidenceMappingRevision(state, {
      evidence_id: override.evidence_id,
      experiment_version: experimentVersion,
      excerpt: override.excerpt,
      chunk_ids: override.chunk_ids,
      continuity_confirmed: override.continuity_confirmed === true,
      note: override.note || '人工指定的原文摘录候选；仍需在工作台完成独立审核。',
    });
    const priorRevisionIndex = revisions.findIndex((item) => item.evidence_id === override.evidence_id
      && item.experiment_version === experimentVersion);
    if (priorRevisionIndex >= 0) revisions.splice(priorRevisionIndex, 1);
    revisions.push(revision);
    auditRows[rowIndex] = {
      ...original,
      category: 'manual_anchor',
      candidate_excerpt: revision.excerpt,
      candidate_chunk_ids: revision.chunk_ids,
      match_ratio: 1,
      mapping_revision: revision,
    };
    manualAnchorCount += 1;
  }
}
fs.mkdirSync(path.join(outputDir, 'governance'), { recursive: true });
if (options.overrides) {
  fs.copyFileSync(path.resolve(options.overrides), path.join(outputDir, 'governance', 'evidence-mapping-overrides.json'));
}
for (const table of STATE_TABLES) writeTable(path.join(outputDir, `${table}.jsonl`), state[table]);
writeJsonl(path.join(outputDir, 'governance', 'evidence-mapping-revisions.jsonl'), revisions);
writeJsonl(path.join(outputDir, 'governance', 'evidence-mapping-audit.jsonl'), auditRows);

const counts = Object.fromEntries([...new Set(auditRows.map((row) => row.category))]
  .sort()
  .map((category) => [category, auditRows.filter((row) => row.category === category).length]));
const changedExcerptCount = auditRows.filter((row) => row.candidate_excerpt && row.candidate_excerpt !== row.original_excerpt).length;
const changedChunkCount = auditRows.filter((row) => JSON.stringify(row.candidate_chunk_ids) !== JSON.stringify(row.original_chunk_ids)).length;
const unresolved = auditRows.filter((row) => row.category === 'unresolved');
const report = [
  '# Evidence–Chunk 原文锚点复核准备报告',
  '',
  `- Evidence：${state.evidences.length}`,
  `- Chunk 快照：${state.chunks.length}`,
  `- 原有 Evidence–Chunk 关系行：${state.evidence_chunks.length}`,
  `- 原有 Evidence–Chunk 关系边：${relationEdgeCount}`,
  `- 待复核映射候选：${revisions.length}`,
  `- 实验版本：${experimentVersion}`,
  `- 摘录文本已重摘：${changedExcerptCount}`,
  `- Chunk 来源发生变化：${changedChunkCount}`,
  '',
  '## 候选分类',
  '',
  '| 分类 | 数量 | 说明 |',
  '|---|---:|---|',
  `| exact_linked | ${counts.exact_linked || 0} | 原摘录可在当前关联 Chunk 中逐字定位 |`,
  `| exact_relinked | ${counts.exact_relinked || 0} | 原摘录在其他快照 Chunk 中逐字定位 |`,
  `| normalized_linked | ${counts.normalized_linked || 0} | 忽略断行、标点及全半角差异定位后，从当前关联 Chunk 重摘原始文本 |`,
  `| normalized_relinked | ${counts.normalized_relinked || 0} | 在其他 Chunk 中经上述归一化定位并重摘原始文本 |`,
  `| exact_multichunk | ${counts.exact_multichunk || 0} | 摘录横跨同文档的相邻快照 Chunk，连续性尚待人工确认 |`,
  `| normalized_multichunk | ${counts.normalized_multichunk || 0} | 多 Chunk 归一化候选，原文连续性尚待人工确认 |`,
  `| manual_anchor | ${counts.manual_anchor || 0} | 人工指定的精确原文摘录候选，仍需工作台审核 |`,
  `| partial_linked | ${counts.partial_linked || 0} | 当前关联 Chunk 中找到与原摘录最长连续匹配片段；候选范围需要人工确认 |`,
  `| partial_relinked | ${counts.partial_relinked || 0} | 其他快照 Chunk 中找到与原摘录最长连续匹配片段；来源及候选范围需要人工确认 |`,
  `| unresolved | ${unresolved.length} | 未找到完整摘录候选，需人工重新选取原文范围 |`,
  '',
  '所有生成映射的审核状态均为 pending。自动定位只用于形成复核候选，不代表语义审核或通过。部分匹配候选会把旧摘录缩小为原文中可逐字定位的片段，范围和语义需要人工确认。多 Chunk 候选的连续性均未确认。',
  '',
  '## 未找到完整候选的 Evidence',
  '',
  ...(unresolved.length
    ? unresolved.map((row) => `- ${row.evidence_id} · 当前关联 Chunk：${row.original_chunk_ids.join(', ') || '无'}`)
    : ['- 无']),
  '',
  '逐条候选及原文摘录保存在私有文件 `governance/evidence-mapping-audit.jsonl`；候选映射修订保存在 `governance/evidence-mapping-revisions.jsonl`。如果使用了覆盖文件，其副本保存在 `governance/evidence-mapping-overrides.json`。将此目录作为 `GOLDEN_DATA_DIR` 可在本地审核工作台中查看；批准默认实验版本的映射时，才会更新此私有快照的 Evidence 摘录与 Chunk 关系。',
  '',
];
fs.writeFileSync(path.join(outputDir, 'governance', 'evidence-mapping-audit-report.md'), `${report.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  output_dir: outputDir,
  experiment_version: experimentVersion,
  evidence_count: state.evidences.length,
  chunk_count: state.chunks.length,
  original_relation_edge_count: relationEdgeCount,
  candidate_revision_count: revisions.length,
  changed_excerpt_count: changedExcerptCount,
  changed_chunk_count: changedChunkCount,
  manual_anchor_count: manualAnchorCount,
  counts,
}, null, 2));
