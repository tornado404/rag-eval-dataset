import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, fileHash, normalizeText, readJsonl, sha256, uniqueIndex } from './common.mjs';

const TABLES = ['queries', 'facts', 'evidences', 'chunks', 'query_facts', 'fact_evidence', 'evidence_chunks'];
const MAX_PATHS = 100000;

function minimize(paths) {
  const byKey = new Map();
  for (const pathItems of paths) {
    const ids = [...new Set(pathItems)].sort();
    if (ids.length) byKey.set(JSON.stringify(ids), ids);
  }
  const ordered = [...byKey.values()].sort((a, b) => a.length - b.length || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return ordered.filter((candidate, i) => !ordered.slice(0, i).some((smaller) => smaller.every((id) => candidate.includes(id))));
}

function compileMapping(evidence, row, chunkById, revision, ledgerExists) {
  const result = { evidence_id: evidence.evidence_id, evidence_text: evidence.excerpt || '', source_document_id: null, chunk_paths: [], mapping_status: 'unscorable', reasons: [] };
  if (!normalizeText(result.evidence_text)) result.reasons.push('empty_evidence_text');
  if (!row) { result.reasons.push('missing_evidence_chunk_mapping'); return result; }
  const paths = Array.isArray(row.chunk_paths) ? row.chunk_paths : (Array.isArray(row.chunk_ids) && row.chunk_ids.length ? [row.chunk_ids] : []);
  if (!paths.length || paths.some((p) => !Array.isArray(p) || !p.length || p.some((id) => !chunkById.has(id)))) {
    result.reasons.push('missing_or_invalid_chunk_path'); return result;
  }
  if (revision) {
    if (revision.review_status !== 'approved') { result.reasons.push('mapping_not_approved'); return result; }
    if (revision.excerpt !== result.evidence_text || JSON.stringify(revision.chunk_ids) !== JSON.stringify(row.chunk_ids)) {
      result.reasons.push('mapping_revision_mismatch'); return result;
    }
    const anchor = revision.source_anchor || {};
    if (revision.chunk_ids.length > 1 && (anchor.mode !== 'consecutive_chunks' || anchor.continuity_confirmed !== true)) {
      result.reasons.push('chunk_continuity_unconfirmed'); return result;
    }
    const segments = anchor.segments || [];
    const valid = segments.length === revision.chunk_ids.length && segments.every((segment, i) => {
      const chunk = chunkById.get(segment.chunk_id);
      return chunk && segment.chunk_id === revision.chunk_ids[i]
        && sha256(chunk.content || '') === segment.chunk_sha256
        && Array.from(chunk.content || '').slice(segment.start_offset, segment.end_offset).join('') === segment.quote;
    });
    if (!valid || normalizeText(segments.map((s) => s.quote).join('')) !== normalizeText(result.evidence_text)) {
      result.reasons.push('mapping_anchor_validation_failed'); return result;
    }
    result.mapping_status = 'approved_source_anchor';
    result.mapping_revision = revision.revision;
  } else if (ledgerExists) {
    result.reasons.push('mapping_revision_missing'); return result;
  } else if (Array.isArray(row.chunk_paths)) {
    if (row.continuity_confirmed !== true && paths.some((p) => p.length > 1)) {
      result.reasons.push('chunk_continuity_unconfirmed'); return result;
    }
    result.mapping_status = 'explicit_chunk_paths';
  } else if (paths.length === 1 && paths[0].length === 1 && normalizeText(chunkById.get(paths[0][0]).content).includes(normalizeText(result.evidence_text)) && normalizeText(result.evidence_text)) {
    result.mapping_status = 'single_chunk_verbatim_verified';
  } else {
    result.reasons.push('chunk_path_semantics_unconfirmed'); return result;
  }
  const docIds = [...new Set(paths.flat().map((id) => chunkById.get(id).document_id).filter(Boolean))];
  result.source_document_id = docIds.length === 1 ? docIds[0] : null;
  result.chunk_paths = paths.map((ids, i) => ({ path_id: `CP${i + 1}`, chunk_ids: ids, chunks: ids.map((id) => ({ chunk_id: id, content_sha256: sha256(chunkById.get(id).content || ''), document_id: chunkById.get(id).document_id || null, dataset_id: chunkById.get(id).dataset_id || null })) }));
  return result;
}

export function compileSnapshot(inputDir, options = {}) {
  const tables = Object.fromEntries(TABLES.map((table) => [table, readJsonl(path.join(inputDir, `${table}.jsonl`))]));
  const queries = uniqueIndex(tables.queries, 'query_id', 'queries');
  const facts = uniqueIndex(tables.facts, 'fact_id', 'facts');
  const evidences = uniqueIndex(tables.evidences, 'evidence_id', 'evidences');
  const chunks = uniqueIndex(tables.chunks, 'chunk_id', 'chunks');
  const factEvidence = uniqueIndex(tables.fact_evidence, 'fact_id', 'fact_evidence');
  const evidenceChunks = uniqueIndex(tables.evidence_chunks, 'evidence_id', 'evidence_chunks');
  const ledger = options.ledger || path.join(inputDir, 'governance', 'evidence-mapping-revisions.jsonl');
  const revisions = new Map();
  if (fs.existsSync(ledger)) for (const row of readJsonl(ledger)) {
    if (options.mappingVersion && row.experiment_version !== options.mappingVersion) continue;
    const previous = revisions.get(row.evidence_id);
    if (previous && previous.experiment_version !== row.experiment_version && !options.mappingVersion) throw new Error('Multiple mapping versions in ledger; set --mapping-version');
    if (!previous || row.revision > previous.revision) revisions.set(row.evidence_id, row);
  }
  const compiledEvidence = new Map([...evidences.values()].map((e) => [e.evidence_id, compileMapping(e, evidenceChunks.get(e.evidence_id), chunks, revisions.get(e.evidence_id), fs.existsSync(ledger))]));
  const queryRows = new Map([...queries.keys()].map((id) => [id, []]));
  const duplicateLinks = new Set();
  for (const link of tables.query_facts) {
    if (!queryRows.has(link.query_id)) throw new Error(`Unknown query ${link.query_id}`);
    const key = `${link.query_id}\0${link.fact_id}`;
    if (duplicateLinks.has(key)) throw new Error(`Duplicate query-fact link ${link.query_id}/${link.fact_id}`);
    duplicateLinks.add(key);
    if (['required', 'required_any'].includes(link.requirement)) queryRows.get(link.query_id).push(link);
    else if (!['optional', 'forbidden'].includes(link.requirement)) throw new Error(`Unknown requirement ${link.requirement}`);
  }
  const compiledQueries = [];
  for (const query of queries.values()) {
    const result = { query_id: query.query_id, query_text: query.text, expected_behavior: query.expected_behavior, evidence_paths: [], compile_complete: true, reasons: [] };
    if (query.expected_behavior !== 'answer') { result.reasons.push('outside_answer_cohort'); compiledQueries.push(result); continue; }
    const links = queryRows.get(query.query_id); const required = []; const groups = new Map();
    for (const link of links) {
      const relation = factEvidence.get(link.fact_id);
      let paths = [];
      if (!facts.has(link.fact_id) || !relation || !Array.isArray(relation.evidence_ids) || !relation.evidence_ids.length || relation.evidence_ids.some((id) => !evidences.has(id)) || !['OR', 'AND'].includes(relation.operator)) {
        result.compile_complete = false; result.reasons.push('missing_or_invalid_fact_evidence_relation');
      } else paths = relation.operator === 'AND' ? [relation.evidence_ids] : relation.evidence_ids.map((id) => [id]);
      if (link.requirement === 'required') required.push(paths);
      else {
        const group = link.group_id || 'A1';
        groups.set(group, [...(groups.get(group) || []), ...paths]);
      }
    }
    const conditions = [...required, ...groups.values()];
    if (!conditions.length) { result.compile_complete = false; result.reasons.push('no_required_support_condition'); }
    let paths = conditions.length ? [[]] : [];
    for (const choices of conditions) {
      if (paths.length * choices.length > MAX_PATHS) { result.compile_complete = false; result.reasons.push('path_expansion_limit'); paths = []; break; }
      paths = minimize(paths.flatMap((left) => choices.map((right) => [...left, ...right])));
    }
    result.evidence_paths = paths.map((ids, i) => ({ path_id: `EP${i + 1}`, evidence_ids: ids }));
    if (!paths.length && !result.reasons.length) { result.compile_complete = false; result.reasons.push('no_evidence_paths'); }
    result.reasons = [...new Set(result.reasons)];
    compiledQueries.push(result);
  }
  const inputHashes = Object.fromEntries(TABLES.map((name) => [`${name}.jsonl`, fileHash(path.join(inputDir, `${name}.jsonl`))]));
  if (fs.existsSync(ledger)) inputHashes['evidence-mapping-revisions.jsonl'] = fileHash(ledger);
  const usedEvidenceIds = new Set(compiledQueries.flatMap((q) => q.evidence_paths.flatMap((p) => p.evidence_ids)));
  const selectedEvidence = [...usedEvidenceIds].sort().map((id) => compiledEvidence.get(id));
  const snapshot = { schema_version: SCHEMA_VERSION, compiler_version: 'snapshot-compiler/1.0.0', dataset_version: options.datasetVersion || 'unspecified', mapping_version: options.mappingVersion || 'unspecified', source_hashes: inputHashes, queries: compiledQueries, evidences: selectedEvidence };
  const answerQueries = compiledQueries.filter((q) => q.expected_behavior === 'answer');
  const missingMapping = selectedEvidence.filter((e) => !e.chunk_paths.length);
  const report = { query_count: compiledQueries.length, answer_query_count: answerQueries.length, compiled_answer_queries: answerQueries.filter((q) => q.compile_complete).length, evidence_count: selectedEvidence.length, evidence_with_usable_chunk_paths: selectedEvidence.length - missingMapping.length, unavailable_evidence: missingMapping.map((e) => ({ evidence_id: e.evidence_id, reasons: e.reasons })), incomplete_queries: answerQueries.filter((q) => !q.compile_complete).map((q) => ({ query_id: q.query_id, reasons: q.reasons })), evidence_paths: answerQueries.reduce((n, q) => n + q.evidence_paths.length, 0) };
  const trace = answerQueries.map((q) => ({ query_id: q.query_id, input_links: queryRows.get(q.query_id).map((link) => ({ ...link, fact_evidence: factEvidence.get(link.fact_id) || null })), compiled_evidence_paths: q.evidence_paths }));
  return { snapshot, report, trace };
}
