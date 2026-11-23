import { normalizeText } from './common.mjs';

function findCoverage(evidence, chunks) {
  const expected = normalizeText(evidence.evidence_text);
  if (!expected) return { covered: null, method: null, chunks: [] };
  for (const chunk of chunks) {
    if (normalizeText(chunk.chunk_text).includes(expected)) return { covered: true, method: 'single_chunk_text', chunks: [chunk.chunk_id], complete_rank: chunk.rank };
  }
  const groups = new Map();
  for (const chunk of chunks) {
    if (!chunk.source_document_id || !chunk.dataset_id || !Number.isInteger(chunk.source_order)) continue;
    const key = `${chunk.dataset_id}\0${chunk.source_document_id}`;
    groups.set(key, [...(groups.get(key) || []), chunk]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.source_order - b.source_order);
    if (new Set(group.map((c) => c.source_order)).size !== group.length) continue;
    for (let start = 0; start < group.length; start += 1) {
      let combined = normalizeText(group[start].chunk_text); const used = [group[start]];
      for (let end = start + 1; end < group.length && group[end].source_order === group[end - 1].source_order + 1; end += 1) {
        used.push(group[end]); combined += normalizeText(group[end].chunk_text);
        if (combined.includes(expected)) return { covered: true, method: 'consecutive_source_order', chunks: used.map((c) => c.chunk_id), complete_rank: Math.max(...used.map((c) => c.rank)) };
      }
    }
  }
  const byId = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
  for (const path of evidence.chunk_paths || []) {
    const selected = path.chunk_ids.map((id) => byId.get(id));
    if (selected.length > 1 && selected.every(Boolean) && selected.every((c) => c.source_document_id && c.source_document_id === selected[0].source_document_id && c.dataset_id === selected[0].dataset_id)
      && selected.map((c) => normalizeText(c.chunk_text)).join('').includes(expected)) {
      return { covered: true, method: 'constrained_text_check', chunks: selected.map((c) => c.chunk_id), complete_rank: Math.max(...selected.map((c) => c.rank)) };
    }
  }
  return { covered: false, method: 'single_and_constrained_text_check', chunks: [] };
}

export function scoreEvidenceText(query, evidenceById, retrieved) {
  if (!query.compile_complete || !query.evidence_paths.length) return { status: 'unscorable', covered: null, reasons: query.reasons.length ? query.reasons : ['no_evidence_paths'] };
  const ids = [...new Set(query.evidence_paths.flatMap((p) => p.evidence_ids))];
  const evidence = ids.map((id) => ({ evidence_id: id, ...findCoverage(evidenceById.get(id) || {}, retrieved.chunks) }));
  const byId = new Map(evidence.map((row) => [row.evidence_id, row]));
  const orderAvailable = retrieved.chunks.every((c) => Number.isInteger(c.source_order) && c.source_document_id && c.dataset_id);
  const missing = ids.filter((id) => !normalizeText(evidenceById.get(id)?.evidence_text) || (!orderAvailable && !evidenceById.get(id)?.chunk_paths?.length));
  const paths = query.evidence_paths.map((p) => ({ path_id: p.path_id, evidence_ids: p.evidence_ids, covered: p.evidence_ids.every((id) => byId.get(id).covered === true) }));
  const matched = paths.find((p) => p.covered);
  return { status: missing.length ? 'unscorable' : 'scored', covered: missing.length ? null : Boolean(matched), observed_covered: Boolean(matched), matched_evidence_path_id: matched?.path_id ?? null, covered_evidence_ids: evidence.filter((e) => e.covered).map((e) => e.evidence_id), missing_evidence_ids: missing, reasons: missing.length ? ['insufficient_text_or_continuity_mapping'] : [], constrained_text_check: !orderAvailable, evidence, paths };
}
