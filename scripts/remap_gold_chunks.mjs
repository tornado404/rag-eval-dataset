import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readJsonl, writeJsonl } from './lib/dataset.mjs';

const VERSION = 'v1.5';
const [chunkDumpPath, ...flags] = process.argv.slice(2);
const write = flags.includes('--write');
const evidencePath = path.join(REPO_ROOT, 'datasets', VERSION, 'evidences.jsonl');
const reportPath = path.join(REPO_ROOT, 'reports', `${VERSION}-gold-mapping-verification.json`);

if (!chunkDumpPath) {
  console.error('usage: node scripts/remap_gold_chunks.mjs current-chunks.jsonl [--write]');
  process.exit(2);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function strongNormalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function charBigrams(text) {
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) {
    result.add(text.slice(index, index + 2));
  }
  return result;
}

function coverage(sourceStrong, chunkStrong) {
  if (sourceStrong.length < 2) return 0;
  const source = charBigrams(sourceStrong);
  const target = charBigrams(chunkStrong);
  let hits = 0;
  for (const gram of source) {
    if (target.has(gram)) hits += 1;
  }
  return Number((hits / source.size).toFixed(4));
}

function basename(value) {
  return String(value || '').split('/').pop();
}

const chunks = readJsonl(chunkDumpPath).map((chunk) => ({
  ...chunk,
  strong: strongNormalize(chunk.content),
}));
const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
const chunksByDataset = new Map();
for (const chunk of chunks) {
  if (!chunksByDataset.has(chunk.dataset_id)) chunksByDataset.set(chunk.dataset_id, []);
  chunksByDataset.get(chunk.dataset_id).push(chunk);
}

const evidences = readJsonl(evidencePath);
const rows = [];
const datasetStats = {};

for (const evidence of evidences) {
  const dataset = datasetStats[evidence.dataset_id] ||= {
    total: 0,
    hash_ok: 0,
    hash_mismatch: 0,
    existing_ids: 0,
    existing_ids_valid: 0,
    existing_ids_missing: 0,
    keep: 0,
    remapped: 0,
    unmapped: 0,
  };
  dataset.total += 1;

  const expectedHash = sha256(String(evidence.source_text || ''));
  const hashOk = expectedHash === String(evidence.source_hash || '');
  dataset[hashOk ? 'hash_ok' : 'hash_mismatch'] += 1;

  const source = strongNormalize(evidence.source_text);
  const currentIds = [
    ...(Array.isArray(evidence.ragflow_chunk_ids) ? evidence.ragflow_chunk_ids : []),
    evidence.ragflow_chunk_id,
  ].filter(Boolean);
  const currentChunks = currentIds.map((id) => chunkById.get(id)).filter(Boolean);
  if (currentIds.length) dataset.existing_ids += 1;
  if (currentChunks.length === currentIds.length && currentIds.length) dataset.existing_ids_valid += 1;
  if (currentIds.length && currentChunks.length !== currentIds.length) dataset.existing_ids_missing += 1;

  const candidates = source.length >= 8
    ? (chunksByDataset.get(evidence.dataset_id) || []).filter((chunk) => chunk.strong.includes(source))
    : [];
  const candidateIds = [...new Set(candidates.map((chunk) => chunk.chunk_id))];

  let action = 'unmapped';
  let chunkIds = [];
  let reason = '';
  if (currentChunks.length === currentIds.length && currentChunks.length) {
    action = 'keep';
    chunkIds = currentIds;
    reason = 'existing_ids_present';
  } else if (candidateIds.length) {
    action = 'remapped';
    chunkIds = candidateIds;
    reason = 'source_text_contained';
  } else if (currentIds.length) {
    reason = 'existing_ids_missing_and_source_not_found';
  } else {
    reason = 'no_existing_id_and_source_not_found';
  }
  dataset[action] += 1;

  rows.push({
    evidence_id: evidence.evidence_id,
    dataset_id: evidence.dataset_id,
    document_name: evidence.document_name,
    source_hash_expected: expectedHash,
    source_hash_stored: String(evidence.source_hash || ''),
    hash_ok: hashOk,
    existing_chunk_ids: currentIds,
    existing_chunk_ids_missing: currentIds.filter((id) => !chunkById.has(id)),
    source_chunk_ids: candidateIds,
    source_chunk_ids_new: candidateIds.filter((id) => !currentIds.includes(id)),
    source_contained: currentChunks.some((chunk) => chunk.strong.includes(source)),
    action,
    reason,
    coverage: currentChunks.length
      ? Math.max(...currentChunks.map((chunk) => coverage(source, chunk.strong)))
      : 0,
  });
}

const summary = {
  evidences: rows.length,
  hash_ok: rows.filter((row) => row.hash_ok).length,
  hash_mismatch: rows.filter((row) => !row.hash_ok).length,
  keep: rows.filter((row) => row.action === 'keep').length,
  remapped: rows.filter((row) => row.action === 'remapped').length,
  unmapped: rows.filter((row) => row.action === 'unmapped').length,
  changed: rows.filter((row) => row.action !== 'keep').length,
  existing_ids_missing: rows.filter((row) => row.existing_chunk_ids_missing.length).length,
  source_contained: rows.filter((row) => row.source_contained).length,
  source_not_contained_but_kept: rows.filter((row) => row.action === 'keep' && !row.source_contained).length,
  datasets: datasetStats,
};

const report = {
  version: VERSION,
  generated_at: new Date().toISOString(),
  chunk_dump: path.basename(chunkDumpPath),
  chunk_count: chunks.length,
  method: [
    '逐条重算 sha256(source_text) 并与 evidence.source_hash 比对，确认标注文本未被改写。',
    '用 strongNormalize（NFKC、去连字符换行、去非字母数字、小写）在目标 dataset 的当前 chunk 中做包含匹配。',
    '已有 chunk_id 且仍在当前语料中存在时保持不动，避免用模糊匹配扩大 Gold 证据面。',
    '已有 chunk_id 失效或原本缺失时，仅在 source_text 被当前 chunk 原文包含时重映射；不做猜测式模糊匹配。',
  ],
  summary,
  action_rows: rows.filter((row) => row.action !== 'keep'),
  rows,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (write) {
  const updated = evidences.map((evidence) => {
    const row = rows.find((item) => item.evidence_id === evidence.evidence_id);
    if (!row || row.action === 'keep') return evidence;
    const next = { ...evidence };
    delete next.ragflow_chunk_id;
    delete next.ragflow_chunk_ids;
    if (row.source_chunk_ids.length === 1) next.ragflow_chunk_id = row.source_chunk_ids[0];
    if (row.source_chunk_ids.length > 1) next.ragflow_chunk_ids = row.source_chunk_ids;
    return next;
  });
  writeJsonl(evidencePath, updated);
}

console.log(JSON.stringify({ summary, report: reportPath, wrote_evidences: write }, null, 2));
