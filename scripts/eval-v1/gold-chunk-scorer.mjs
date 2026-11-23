import { sha256 } from './common.mjs';

export function scoreGoldChunks(query, evidenceById, retrieved) {
  if (!query.compile_complete || !query.evidence_paths.length) return { status: 'unscorable', hit: null, reasons: query.reasons.length ? query.reasons : ['no_evidence_paths'] };
  const missing = [...new Set(query.evidence_paths.flatMap((p) => p.evidence_ids).filter((id) => !evidenceById.get(id)?.chunk_paths?.length))];
  const byId = new Map(retrieved.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const evidence = new Map();
  for (const id of new Set(query.evidence_paths.flatMap((p) => p.evidence_ids))) {
    const mapping = evidenceById.get(id); const paths = mapping?.chunk_paths || [];
    const matches = paths.map((path) => {
      const actual = path.chunk_ids.map((chunkId) => byId.get(chunkId));
      const versionMismatch = path.chunks?.some((expected, i) => actual[i] && sha256(actual[i].chunk_text) !== expected.content_sha256) || false;
      return { path_id: path.path_id, chunk_ids: path.chunk_ids, hit: actual.every(Boolean) && !versionMismatch, version_mismatch: versionMismatch, complete_rank: actual.every(Boolean) && !versionMismatch ? Math.max(...actual.map((c) => c.rank)) : null };
    });
    const best = matches.filter((p) => p.hit).sort((a, b) => a.complete_rank - b.complete_rank)[0];
    evidence.set(id, { evidence_id: id, hit: Boolean(best), complete_rank: best?.complete_rank ?? null, matched_chunk_path: best || null, paths: matches });
  }
  const paths = query.evidence_paths.map((path) => ({ path_id: path.path_id, evidence_ids: path.evidence_ids, hit: path.evidence_ids.every((id) => evidence.get(id)?.hit), complete_rank: path.evidence_ids.every((id) => evidence.get(id)?.hit) ? Math.max(...path.evidence_ids.map((id) => evidence.get(id).complete_rank)) : null }));
  const best = paths.filter((p) => p.hit).sort((a, b) => a.complete_rank - b.complete_rank)[0];
  const mismatches = [...evidence.values()].flatMap((e) => e.paths.filter((p) => p.version_mismatch).map((p) => ({ evidence_id: e.evidence_id, path_id: p.path_id })));
  const reasons = [...(missing.length ? ['incomplete_gold_chunk_mapping'] : []), ...(mismatches.length ? ['retrieved_chunk_content_version_mismatch'] : [])];
  return { status: reasons.length ? 'unscorable' : 'scored', hit: reasons.length ? null : Boolean(best), observed_hit: Boolean(best), earliest_complete_rank: best?.complete_rank ?? null, matched_evidence_path_id: best?.path_id ?? null, matched_chunk_paths: best ? best.evidence_ids.map((id) => evidence.get(id).matched_chunk_path) : [], missing_evidence_ids: missing, version_mismatches: mismatches, reasons, evidence: [...evidence.values()], paths };
}
