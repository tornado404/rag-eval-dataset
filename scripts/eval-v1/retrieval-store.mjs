import fs from 'node:fs';
import path from 'node:path';
import { ensureNewDir, fileHash, readJson, readJsonl, sha256, writeJsonlNew, writeJsonNew } from './common.mjs';

export function freezeRetrieval({ snapshotPath, rawPath, manifestPath, outputDir, experimentId, k }) {
  if (!Number.isInteger(k) || k < 1) throw new Error('k must be a positive integer');
  const snapshot = readJson(snapshotPath); const sourceManifest = manifestPath ? readJson(manifestPath) : {};
  const byId = new Map(snapshot.queries.map((q) => [q.query_id, q])); const seen = new Set(); const rows = []; let commonRequest = null;
  for (const record of readJsonl(rawPath)) {
    const query = byId.get(record.query_id);
    if (!query || seen.has(record.query_id)) throw new Error(`Unknown or duplicate retrieval query ${record.query_id}`);
    seen.add(record.query_id);
    if (record.query !== query.query_text || record.request?.question !== query.query_text) throw new Error(`Query mismatch: ${record.query_id}`);
    if (record.request?.top_k < k || record.request?.page_size < k) throw new Error(`Insufficient requested K: ${record.query_id}`);
    const requestParameters = Object.fromEntries(Object.entries(record.request).filter(([key]) => key !== 'question').sort(([a], [b]) => a.localeCompare(b)));
    if (!commonRequest) commonRequest = requestParameters;
    if (JSON.stringify(commonRequest) !== JSON.stringify(requestParameters)) throw new Error(`Inconsistent retrieval parameters: ${record.query_id}`);
    for (const [key, value] of Object.entries(sourceManifest.request_parameters || {})) if (JSON.stringify(requestParameters[key]) !== JSON.stringify(value)) throw new Error(`Retrieval parameter ${key} differs from manifest: ${record.query_id}`);
    const list = record.response?.data?.chunks;
    const error = record.error || (record.response?.code !== 0 || !Array.isArray(list) ? 'invalid_retrieval_response' : null);
    const chunks = error ? [] : list.slice(0, k).map((chunk, index) => ({
      rank: index + 1, chunk_id: chunk.id || chunk.chunk_id || null, chunk_text: chunk.content,
      source_document_id: chunk.document_id || null, dataset_id: chunk.dataset_id || null,
      source_order: Number.isInteger(chunk.source_order) ? chunk.source_order : null,
      source_positions: chunk.positions || null, score: chunk.similarity ?? chunk.score ?? null,
      rerank_score: chunk.rerank_score ?? null,
    }));
    if (!error && chunks.some((chunk) => !chunk.chunk_id || typeof chunk.chunk_text !== 'string')) throw new Error(`Missing chunk ID or text: ${record.query_id}`);
    rows.push({ experiment_id: experimentId, query_id: record.query_id, query_text: query.query_text, k, error, chunks });
  }
  ensureNewDir(outputDir);
  try {
    fs.copyFileSync(rawPath, path.join(outputDir, 'retrieval-raw.jsonl'), fs.constants.COPYFILE_EXCL);
    writeJsonlNew(path.join(outputDir, 'retrieval.jsonl'), rows);
    writeJsonNew(path.join(outputDir, 'manifest.json'), {
      schema_version: 'retrieval-result-store/1.0', experiment_id: experimentId, k,
      snapshot_sha256: fileHash(snapshotPath), raw_retrieval_sha256: fileHash(rawPath),
      normalized_retrieval_sha256: fileHash(path.join(outputDir, 'retrieval.jsonl')),
      source_manifest_sha256: manifestPath ? fileHash(manifestPath) : null,
      source_retrieval_manifest: sourceManifest, verified_request_parameters: commonRequest,
      ragflow_dataset_version: sourceManifest.ragflow_dataset_version || sourceManifest.dataset_version || 'unrecorded', document_versions: sourceManifest.document_versions || 'unrecorded',
      source_order_note: 'Only explicit source_order is treated as sequential; source_positions are retained but do not establish adjacency.',
      query_count: rows.length, errors: rows.filter((r) => r.error).length,
      missing_query_ids: snapshot.queries.filter((q) => !seen.has(q.query_id)).map((q) => q.query_id),
      retrieval_content_sha256: sha256(rows.map((row) => JSON.stringify(row)).join('\n')),
    });
  } catch (error) { throw new Error(`Incomplete frozen retrieval at ${outputDir}: ${error.message}`); }
  return rows;
}
