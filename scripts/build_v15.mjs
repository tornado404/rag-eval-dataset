import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readJsonl, writeJsonl } from './lib/dataset.mjs';

const SOURCE_VERSION = 'v1.4';
const TARGET_VERSION = 'v1.5';
const [oldDumpPath, newDumpPath] = process.argv.slice(2);

if (!oldDumpPath || !newDumpPath) {
  console.error('usage: node scripts/build_v15.mjs old-chunks.jsonl new-chunks.jsonl');
  process.exit(2);
}

const DATASET_MAP = {
  DS01: {
    id: '6fc656c4dc4811f182a97bfda9b37d41',
    name: 'Customer Service Scripts-qwen',
    document_count: 13,
    chunk_count: 131,
  },
  DS02: {
    id: '7131ca20dc4811f182a97bfda9b37d41',
    name: 'Medical Research Paper-qwen',
    document_count: 245,
    chunk_count: 21599,
  },
  DS03: {
    id: '73843970dc4811f182a97bfda9b37d41',
    name: 'Medication Guide-qwen',
    document_count: 3,
    chunk_count: 263,
  },
};

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function basename(value) {
  return String(value || '').split('/').pop();
}

function strongNormalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function words(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/-\s*\n\s*/g, '')
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function bigrams(tokens) {
  const result = new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    result.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return result;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function loadChunks(filePath) {
  const rows = readJsonl(filePath);
  return rows.map((row) => ({
    ...row,
    strong: strongNormalize(row.content),
  }));
}

const evidence = readJsonl(path.join(REPO_ROOT, 'datasets', SOURCE_VERSION, 'evidences.jsonl'));
const sourceDatasets = readJsonl(path.join(REPO_ROOT, 'datasets', SOURCE_VERSION, 'datasets.jsonl'));
const oldChunks = loadChunks(oldDumpPath);
const newChunks = loadChunks(newDumpPath);
const oldById = new Map(oldChunks.map((chunk) => [chunk.chunk_id, chunk]));
const newByDataset = new Map();
for (const chunk of newChunks) {
  if (!newByDataset.has(chunk.dataset_id)) newByDataset.set(chunk.dataset_id, []);
  newByDataset.get(chunk.dataset_id).push(chunk);
}

function exactCandidates(chunks, anchor) {
  const target = strongNormalize(anchor);
  if (target.length < 8) return [];
  return chunks.filter((chunk) => chunk.strong === target);
}

function containingCandidates(chunks, anchor) {
  const target = strongNormalize(anchor);
  if (target.length < 8) return [];
  return chunks.filter((chunk) => chunk.strong.includes(target));
}

function fuzzyCandidates(chunks, documentName, sourceText) {
  const document = strongNormalize(basename(documentName));
  const sameDocument = chunks.filter((chunk) => strongNormalize(basename(chunk.document_name)) === document);
  if (!sameDocument.length || sourceText.length < 40) return [];
  const sourceBigrams = bigrams(words(sourceText));
  if (sourceBigrams.size < 8) return [];
  const scored = sameDocument.map((chunk) => {
    const chunkBigrams = bigrams(words(chunk.content));
    let hits = 0;
    for (const gram of sourceBigrams) {
      if (chunkBigrams.has(gram)) hits += 1;
    }
    return { chunk, score: hits / sourceBigrams.size };
  }).sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best || best.score < 0.55) return [];
  const cutoff = Math.max(0.55, best.score - 0.08);
  return scored.filter((item) => item.score >= cutoff).slice(0, 3);
}

function describeCandidates(candidates) {
  return uniq(candidates.map((candidate) => candidate.chunk?.chunk_id || candidate.chunk_id));
}

const mappedEvidence = [];
const reportRows = [];
const methodCounts = {};
const datasetCounts = {};

for (const row of evidence) {
  const dataset = DATASET_MAP[row.dataset_id];
  if (!dataset) throw new Error(`unknown dataset ${row.dataset_id}`);
  const chunks = newByDataset.get(dataset.id) || [];
  const oldChunk = row.ragflow_chunk_id ? oldById.get(row.ragflow_chunk_id) : null;
  let candidates = [];
  let method = '';

  if (oldChunk) {
    candidates = exactCandidates(chunks, oldChunk.content);
    if (candidates.length) {
      method = 'chunk_exact';
    } else {
      candidates = containingCandidates(chunks, oldChunk.content);
      if (candidates.length) method = 'chunk_contains';
    }
  }
  if (!candidates.length) {
    candidates = exactCandidates(chunks, row.source_text);
    if (candidates.length) method = 'source_exact';
  }
  if (!candidates.length) {
    candidates = containingCandidates(chunks, row.source_text);
    if (candidates.length) method = 'source_contains';
  }
  const fuzzy = !candidates.length ? fuzzyCandidates(chunks, row.document_name, row.source_text) : [];
  if (fuzzy.length) {
    candidates = fuzzy.map((item) => item.chunk);
    method = 'source_fuzzy_page';
  }

  const chunkIds = describeCandidates(candidates);
  const mapped = { ...row };
  delete mapped.ragflow_chunk_id;
  delete mapped.ragflow_chunk_ids;
  if (chunkIds.length === 1) mapped.ragflow_chunk_id = chunkIds[0];
  if (chunkIds.length > 1) mapped.ragflow_chunk_ids = chunkIds;
  mappedEvidence.push(mapped);

  const resolvedMethod = chunkIds.length ? method : 'unmapped';
  methodCounts[resolvedMethod] = (methodCounts[resolvedMethod] || 0) + 1;
  datasetCounts[row.dataset_id] ||= {
    total: 0,
    mapped: 0,
    unmapped: 0,
    mapped_with_multiple_chunks: 0,
    methods: {},
  };
  const datasetStats = datasetCounts[row.dataset_id];
  datasetStats.total += 1;
  datasetStats.methods[resolvedMethod] = (datasetStats.methods[resolvedMethod] || 0) + 1;
  if (chunkIds.length) {
    datasetStats.mapped += 1;
    if (chunkIds.length > 1) datasetStats.mapped_with_multiple_chunks += 1;
  } else {
    datasetStats.unmapped += 1;
  }

  reportRows.push({
    evidence_id: row.evidence_id,
    dataset_id: row.dataset_id,
    document_name: row.document_name,
    section: row.section,
    source_text: row.source_text,
    method: resolvedMethod,
    chunk_count: chunkIds.length,
  });
}

const targetDir = path.join(REPO_ROOT, 'datasets', TARGET_VERSION);
fs.mkdirSync(targetDir, { recursive: true });
writeJsonl(path.join(targetDir, 'evidences.jsonl'), mappedEvidence);

const targetDatasets = sourceDatasets.map((row) => {
  const target = DATASET_MAP[row.dataset_id];
  return {
    ...row,
    document_count: target.document_count,
    ragflow_dataset_name: target.name,
    ragflow_dataset_id: target.id,
    ragflow_chunk_count: target.chunk_count,
    dataset_version_note: 'v1.5 对齐 2026-11-17 M3 的 qwen 解析库；旧 v1.4 chunk ID 仅用于离线映射，不参与评测。',
  };
});
writeJsonl(path.join(targetDir, 'datasets.jsonl'), targetDatasets);

const unmapped = reportRows.filter((row) => row.method === 'unmapped');
const mappingReport = {
  source_version: SOURCE_VERSION,
  target_version: TARGET_VERSION,
  generated_at: new Date().toISOString(),
  source_chunk_dump: path.basename(oldDumpPath),
  target_chunk_dump: path.basename(newDumpPath),
  target_datasets: Object.fromEntries(Object.entries(DATASET_MAP).map(([id, value]) => [id, value])),
  summary: {
    evidences: reportRows.length,
    mapped: reportRows.length - unmapped.length,
    unmapped: unmapped.length,
    mapped_with_multiple_chunks: reportRows.filter((row) => row.chunk_count > 1).length,
    unique_target_chunks: new Set(mappedEvidence.flatMap((row) => (
      row.ragflow_chunk_ids || (row.ragflow_chunk_id ? [row.ragflow_chunk_id] : [])
    ))).size,
    methods: methodCounts,
    datasets: datasetCounts,
  },
  rules: [
    '优先使用旧 chunk 正文在新 qwen 库中做规范化精确匹配或包含匹配。',
    '旧 chunk 无法匹配时，回退到 evidence.source_text 的精确/包含匹配。',
    '仅对同文档名、长文本且 bigram 覆盖率不低于 0.55 的页级分块做保守模糊匹配。',
    '未匹配 evidence 不保留旧 chunk ID，并在评测中按不可评分处理。',
  ],
  unmapped,
};
fs.writeFileSync(
  path.join(targetDir, 'mapping_report.json'),
  `${JSON.stringify(mappingReport, null, 2)}\n`,
  'utf8',
);

const hashedFiles = [
  'cases.jsonl',
  'facts.jsonl',
  'evidences.jsonl',
  'fact_evidence_relations.jsonl',
  'expected_outputs.jsonl',
  'datasets.jsonl',
  'mapping_report.json',
];
const files = {};
for (const name of hashedFiles) {
  const content = fs.readFileSync(path.join(targetDir, name));
  files[name] = { sha256: sha256(content), bytes: content.byteLength };
}
const manifest = {
  version: 'v1.5.0',
  kind: 'qwen-target-mapping',
  generated_at: mappingReport.generated_at,
  base_version: 'v1.4.0',
  source_version: SOURCE_VERSION,
  target_environment: {
    backend: 'M3',
    api_base_url: 'https://api.nicoyabio.com',
    qa_endpoint: '/api/v1/qa/turns',
    deliver: 'auto',
  },
  files,
  summary: mappingReport.summary,
  unmapped_evidence_ids: unmapped.map((row) => row.evidence_id),
};
fs.writeFileSync(path.join(targetDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  target_dir: targetDir,
  ...mappingReport.summary,
  unmapped_evidence_ids: unmapped.map((row) => row.evidence_id),
}, null, 2));
