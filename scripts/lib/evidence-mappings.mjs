import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyEvidenceChunks,
  chunkIdsOfEvidence,
  goldenDir,
  mutate,
  readState,
  upsertEntity,
} from './golden.mjs';
import { readJsonl } from './dataset.mjs';

export const EVIDENCE_MAPPING_SCHEMA_VERSION = 'golden-evidence-mapping/v1';
export const DEFAULT_EVIDENCE_MAPPING_EXPERIMENT = 'source-anchor-v1';
export const EVIDENCE_MAPPING_STATUSES = ['pending', 'approved', 'rejected'];

function mappingFile(version) {
  return path.join(goldenDir(version), 'governance', 'evidence-mapping-revisions.jsonl');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonDigest(value) {
  return sha256(JSON.stringify(value));
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function codePointOffset(value, utf16Offset) {
  return Array.from(value.slice(0, utf16Offset)).length;
}

function codePointSlice(value, start, end) {
  return Array.from(value).slice(start, end).join('');
}

function requireText(value, label, maxLength = 160) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required`);
  if (result.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return result;
}

function sourceAnchor(state, excerpt, chunkIds, continuityConfirmed = false) {
  const ids = unique(chunkIds);
  const chunks = ids.map((id) => state.chunks.find((row) => row.chunk_id === id));
  if (!chunks.length || chunks.some((chunk) => !chunk)) throw new Error('每个来源 Chunk 都必须存在于本地快照中');
  if (chunks.length > 1) {
    const { document_id: documentId, dataset_id: datasetId } = chunks[0];
    if (chunks.some((chunk) => chunk.document_id !== documentId || chunk.dataset_id !== datasetId)) {
      throw new Error('连续多 Chunk 必须来自同一数据集和同一文档');
    }
  }

  const combined = chunks.map((chunk) => chunk.content).join('');
  const start = combined.indexOf(excerpt);
  if (start < 0) throw new Error('Evidence 摘录必须逐字出现在所选 Chunk 原文中');
  const end = start + excerpt.length;
  let cursor = 0;
  const segments = [];
  for (const chunk of chunks) {
    const chunkStart = cursor;
    const chunkEnd = cursor + chunk.content.length;
    const segmentStart = Math.max(start, chunkStart);
    const segmentEnd = Math.min(end, chunkEnd);
    if (segmentEnd > segmentStart) {
      const localStart = segmentStart - chunkStart;
      const localEnd = segmentEnd - chunkStart;
      const quote = chunk.content.slice(localStart, localEnd);
      segments.push({
        chunk_id: chunk.chunk_id,
        start_offset: codePointOffset(chunk.content, localStart),
        end_offset: codePointOffset(chunk.content, localEnd),
        quote,
        chunk_sha256: sha256(chunk.content),
      });
    }
    cursor = chunkEnd;
  }
  if (segments.length !== chunks.length || segments.map((segment) => segment.quote).join('') !== excerpt) {
    throw new Error('摘录没有覆盖全部关联 Chunk 的连续原文范围，请移除不参与摘录的 Chunk');
  }
  return {
    mode: segments.length === 1 ? 'single_chunk' : 'consecutive_chunks',
    continuity_confirmed: segments.length > 1 && Boolean(continuityConfirmed),
    segments,
  };
}

function revisionDigest(revision) {
  return jsonDigest({
    schema_version: EVIDENCE_MAPPING_SCHEMA_VERSION,
    evidence_id: revision.evidence_id,
    experiment_version: revision.experiment_version,
    excerpt: revision.excerpt,
    chunk_ids: unique(revision.chunk_ids),
    source_anchor: revision.source_anchor,
  });
}

export function readEvidenceMappingRevisions(version = 'golden-v1') {
  const file = mappingFile(version);
  return fs.existsSync(file) ? readJsonl(file) : [];
}

function writeEvidenceMappingRevisions(version, rows) {
  const file = mappingFile(version);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const body = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  fs.writeFileSync(temporary, body, 'utf8');
  fs.renameSync(temporary, file);
}

export function latestEvidenceMapping(revisions, evidenceId, experimentVersion = DEFAULT_EVIDENCE_MAPPING_EXPERIMENT) {
  return (revisions || [])
    .filter((row) => row.evidence_id === evidenceId && row.experiment_version === experimentVersion)
    .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))[0] || null;
}

export function validateEvidenceMappingRevision(revision, state) {
  const errors = [];
  if (revision?.schema_version !== EVIDENCE_MAPPING_SCHEMA_VERSION) errors.push('unsupported mapping schema_version');
  if (!state.evidences.some((row) => row.evidence_id === revision.evidence_id)) errors.push(`unknown evidence ${revision.evidence_id}`);
  if (!EVIDENCE_MAPPING_STATUSES.includes(revision.review_status)) errors.push(`invalid review_status ${revision.review_status}`);
  if (!revision.experiment_version) errors.push('missing experiment_version');
  const chunkIds = unique(revision.chunk_ids);
  const segments = revision.source_anchor?.segments || [];
  if (!chunkIds.length) errors.push('mapping needs at least one chunk');
  if (!segments.length) errors.push('mapping needs source anchor segments');
  if (segments.map((segment) => segment.quote).join('') !== revision.excerpt) errors.push('anchor quotes do not equal evidence excerpt');
  if (JSON.stringify(segments.map((segment) => segment.chunk_id)) !== JSON.stringify(chunkIds)) {
    errors.push('anchor segment order does not match chunk_ids');
  }
  if (segments.length > 1 && revision.source_anchor?.mode !== 'consecutive_chunks') errors.push('multi-chunk mapping has invalid mode');
  if (segments.length === 1 && revision.source_anchor?.mode !== 'single_chunk') errors.push('single-chunk mapping has invalid mode');
  if (revision.source_anchor?.mode === 'consecutive_chunks' && revision.review_status === 'approved'
    && revision.source_anchor?.continuity_confirmed !== true) errors.push('multi-chunk continuity has not been confirmed');
  if (revision.source_digest !== revisionDigest(revision)) errors.push('source digest does not match mapping content');

  const anchorChunks = segments.map((segment) => state.chunks.find((row) => row.chunk_id === segment.chunk_id)).filter(Boolean);
  if (anchorChunks.length > 1) {
    const first = anchorChunks[0];
    if (anchorChunks.some((chunk) => chunk.dataset_id !== first.dataset_id || chunk.document_id !== first.document_id)) {
      errors.push('multi-chunk mapping crosses documents or datasets');
    }
  }

  for (const segment of segments) {
    const chunk = state.chunks.find((row) => row.chunk_id === segment.chunk_id);
    if (!chunk) {
      errors.push(`unknown anchor chunk ${segment.chunk_id}`);
      continue;
    }
    const quote = codePointSlice(chunk.content, segment.start_offset, segment.end_offset);
    if (quote !== segment.quote) errors.push(`anchor offsets do not match ${segment.chunk_id}`);
    if (sha256(chunk.content) !== segment.chunk_sha256) errors.push(`stale chunk digest ${segment.chunk_id}`);
    const length = Array.from(chunk.content).length;
    if (segment.start_offset < 0 || segment.end_offset > length || segment.end_offset <= segment.start_offset) {
      errors.push(`invalid anchor offsets ${segment.chunk_id}`);
    }
  }
  return errors;
}

export function inspectEvidenceMapping(state, revisions, evidenceId, experimentVersion = DEFAULT_EVIDENCE_MAPPING_EXPERIMENT) {
  const evidence = state.evidences.find((row) => row.evidence_id === evidenceId);
  if (!evidence) return null;
  const revision = latestEvidenceMapping(revisions, evidenceId, experimentVersion);
  if (!revision) {
    return {
      evidence_id: evidenceId,
      experiment_version: experimentVersion,
      revision: 0,
      review_status: 'pending',
      anchor_status: 'missing',
      anchor_error: '',
      reviewer: '',
      reviewed_at: '',
      note: '',
      source_anchor: null,
      excerpt: evidence.excerpt || '',
      chunk_ids: chunkIdsOfEvidence(state, evidenceId),
    };
  }

  const errors = validateEvidenceMappingRevision(revision, state);
  const approvedDefaultOutOfSync = experimentVersion === DEFAULT_EVIDENCE_MAPPING_EXPERIMENT
    && revision.review_status === 'approved'
    && (String(evidence.excerpt || '').trim() !== revision.excerpt
      || JSON.stringify(chunkIdsOfEvidence(state, evidenceId)) !== JSON.stringify(revision.chunk_ids));
  if (approvedDefaultOutOfSync) errors.push('approved mapping differs from the current Evidence excerpt or Chunk links');
  const isStale = errors.some((error) => error.startsWith('stale chunk digest'))
    || approvedDefaultOutOfSync
    || (revision.review_status === 'approved' && errors.length > 0);
  const status = isStale ? 'stale' : revision.review_status;
  return {
    evidence_id: evidenceId,
    experiment_version: experimentVersion,
    revision: revision.revision,
    review_status: status,
    anchor_status: errors.some((error) => error.startsWith('unknown anchor chunk') || error.startsWith('anchor offsets')
      || error.startsWith('anchor quotes') || error.startsWith('mapping needs') || error.startsWith('anchor segment')
      || error.startsWith('source digest') || error.startsWith('multi-chunk mapping crosses'))
      ? 'missing'
      : revision.source_anchor?.mode === 'consecutive_chunks' && !revision.source_anchor.continuity_confirmed
        ? 'continuity_unconfirmed'
        : 'anchored',
    anchor_error: errors.join('; '),
    reviewer: revision.reviewer || '',
    reviewed_at: revision.reviewed_at || '',
    note: revision.note || '',
    source_anchor: revision.source_anchor,
    source_digest: revision.source_digest,
    excerpt: revision.excerpt,
    chunk_ids: [...revision.chunk_ids],
  };
}

export function createEvidenceMappingRevision(state, input = {}, options = {}) {
  const evidenceId = requireText(input.evidence_id, 'evidence_id', 80);
  const experimentVersion = requireText(input.experiment_version || DEFAULT_EVIDENCE_MAPPING_EXPERIMENT, 'experiment_version', 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(experimentVersion)) {
    throw new Error('experiment_version 只能包含字母、数字、点、下划线、斜线和连字符');
  }
  const excerpt = String(input.excerpt ?? '').trim();
  if (!excerpt) throw new Error('Evidence 摘录不能为空');
  const chunkIds = unique(input.chunk_ids);
  if (!chunkIds.length) throw new Error('至少需要一个来源 Chunk');
  if (!state.evidences.some((row) => row.evidence_id === evidenceId)) throw new Error(`evidence ${evidenceId} not found`);
  const anchor = sourceAnchor(state, excerpt, chunkIds, input.continuity_confirmed === true);
  const revision = {
    schema_version: EVIDENCE_MAPPING_SCHEMA_VERSION,
    mapping_id: `${experimentVersion}:${evidenceId}`,
    revision: Number(options.revision || 1),
    evidence_id: evidenceId,
    experiment_version: experimentVersion,
    excerpt,
    chunk_ids: chunkIds,
    source_anchor: anchor,
    review_status: 'pending',
    reviewer: '',
    reviewed_at: '',
    note: String(input.note || '').trim(),
    updated_at: options.updatedAt || new Date().toISOString(),
  };
  revision.source_digest = revisionDigest(revision);
  return revision;
}

export function saveEvidenceMapping(version, input = {}) {
  const evidenceId = requireText(input.evidence_id, 'evidence_id', 80);
  const experimentVersion = requireText(input.experiment_version || DEFAULT_EVIDENCE_MAPPING_EXPERIMENT, 'experiment_version', 80);
  const requestedStatus = String(input.review_status || 'pending');
  if (!EVIDENCE_MAPPING_STATUSES.includes(requestedStatus)) throw new Error(`invalid review_status ${requestedStatus}`);
  const reviewer = String(input.reviewer ?? '').trim();
  if (requestedStatus !== 'pending' && !reviewer) throw new Error('批准或驳回映射时必须填写审核人');

  const state = readState(version);
  const revisions = readEvidenceMappingRevisions(version);
  const previous = latestEvidenceMapping(revisions, evidenceId, experimentVersion);
  const candidate = createEvidenceMappingRevision(state, input, { revision: Number(previous?.revision || 0) + 1 });
  const sourceChanged = !previous || previous.source_digest !== candidate.source_digest;
  if (sourceChanged && requestedStatus !== 'pending') {
    throw new Error('摘录或 Chunk 关联已变化；保存为待复核后，再单独批准或驳回');
  }
  if (candidate.source_anchor.mode === 'consecutive_chunks' && requestedStatus === 'approved'
    && !candidate.source_anchor.continuity_confirmed) {
    throw new Error('批准多 Chunk 映射前必须确认原文连续');
  }

  const sameDecision = !sourceChanged && previous.review_status === requestedStatus
    && previous.reviewer === (requestedStatus === 'pending' ? '' : reviewer)
    && String(previous.note || '') === candidate.note;
  const currentEvidence = state.evidences.find((row) => row.evidence_id === evidenceId);
  const currentChunkIds = chunkIdsOfEvidence(state, evidenceId);
  const canonicalNeedsSync = experimentVersion === DEFAULT_EVIDENCE_MAPPING_EXPERIMENT
    && (requestedStatus === 'approved'
      ? String(currentEvidence?.excerpt || '').trim() !== candidate.excerpt
        || JSON.stringify(currentChunkIds) !== JSON.stringify(candidate.chunk_ids)
      : requestedStatus === 'rejected' && currentChunkIds.length > 0);
  if (sameDecision && !canonicalNeedsSync) return { revision: previous, created: false, changed: false };

  const syncCanonical = (revision) => mutate(version, (current) => {
    if (requestedStatus === 'approved') {
      upsertEntity(current, 'evidences', {
        ...current.evidences.find((row) => row.evidence_id === evidenceId),
        excerpt: revision.excerpt,
      });
      applyEvidenceChunks(current, evidenceId, revision.chunk_ids);
      return { evidence_id: evidenceId, chunk_ids: revision.chunk_ids };
    }
    applyEvidenceChunks(current, evidenceId, []);
    return { evidence_id: evidenceId, chunk_ids: [] };
  });
  if (sameDecision) {
    const core = canonicalNeedsSync ? syncCanonical(previous) : undefined;
    return { revision: previous, created: false, changed: false, core };
  }

  candidate.review_status = requestedStatus;
  candidate.reviewer = requestedStatus === 'pending' ? '' : reviewer;
  candidate.reviewed_at = requestedStatus === 'pending' ? '' : new Date().toISOString();
  candidate.updated_at = new Date().toISOString();
  candidate.source_digest = revisionDigest(candidate);

  revisions.push(candidate);
  writeEvidenceMappingRevisions(version, revisions);
  const core = canonicalNeedsSync ? syncCanonical(candidate) : undefined;
  return { revision: candidate, created: !previous, changed: true, core };
}

function normalizeSearch(value) {
  return Array.from(String(value || '').normalize('NFKC').toLocaleLowerCase())
    .filter((character) => !/[\s\p{P}\p{S}]/u.test(character))
    .join('');
}

function normalizedTextWithOffsets(value) {
  const normalized = [];
  const offsets = [];
  let codePointOffsetValue = 0;
  for (const character of String(value || '')) {
    const mapped = Array.from(character.normalize('NFKC').toLocaleLowerCase())
      .filter((item) => !/[\s\p{P}\p{S}]/u.test(item));
    for (const item of mapped) {
      normalized.push(item);
      for (let unit = 0; unit < item.length; unit += 1) offsets.push(codePointOffsetValue);
    }
    codePointOffsetValue += 1;
  }
  return { text: normalized.join(''), offsets, sourceLength: codePointOffsetValue };
}

function boundaryPunctuationCount(value, atStart) {
  const characters = Array.from(String(value || '').trim());
  let count = 0;
  if (atStart) {
    for (const character of characters) {
      if (!/[\p{P}\p{S}]/u.test(character)) break;
      count += 1;
    }
    return count;
  }
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    if (!/[\p{P}\p{S}]/u.test(characters[index])) break;
    count += 1;
  }
  return count;
}

function extendNormalizedSourceRange(value, targetExcerpt, start, end, options = {}) {
  const characters = Array.from(value);
  let sourceStart = start;
  let sourceEnd = end;
  if (options.includeLeading !== false) {
    let remaining = boundaryPunctuationCount(targetExcerpt, true);
    while (remaining > 0 && sourceStart > 0 && /[\p{P}\p{S}]/u.test(characters[sourceStart - 1])) {
      sourceStart -= 1;
      remaining -= 1;
    }
  }
  if (options.includeTrailing !== false) {
    let remaining = boundaryPunctuationCount(targetExcerpt, false);
    while (remaining > 0 && sourceEnd < characters.length && /[\p{P}\p{S}]/u.test(characters[sourceEnd])) {
      sourceEnd += 1;
      remaining -= 1;
    }
  }
  return { start: sourceStart, end: sourceEnd };
}

function longestNormalizedOverlap(target, source) {
  if (!target || !source.text) return { length: 0, targetStart: 0, sourceStart: 0 };
  const previous = new Uint32Array(source.text.length + 1);
  let best = { length: 0, targetStart: 0, sourceStart: 0 };
  for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
    let diagonal = 0;
    for (let sourceIndex = 1; sourceIndex <= source.text.length; sourceIndex += 1) {
      const above = previous[sourceIndex];
      if (target[targetIndex - 1] === source.text[sourceIndex - 1]) {
        previous[sourceIndex] = diagonal + 1;
        if (previous[sourceIndex] > best.length) {
          best = {
            length: previous[sourceIndex],
            targetStart: targetIndex - previous[sourceIndex],
            sourceStart: sourceIndex - previous[sourceIndex],
          };
        }
      } else {
        previous[sourceIndex] = 0;
      }
      diagonal = above;
    }
  }
  return best;
}

function findSourceMatch(state, evidence, linkedIds, normalizedByChunk) {
  const original = String(evidence.excerpt || '').trim();
  const targetNormalized = normalizeSearch(original);
  const linked = new Set(linkedIds);
  const rank = (chunkIds, normalized) => {
    const isLinked = chunkIds.every((id) => linked.has(id));
    return (normalized ? 100 : 0) + (isLinked ? 0 : 10) + chunkIds.length;
  };
  const candidates = [];

  for (const chunk of state.chunks) {
    const start = chunk.content.indexOf(original);
    if (original && start >= 0) {
      candidates.push({
        category: linked.has(chunk.chunk_id) ? 'exact_linked' : 'exact_relinked',
        excerpt: original,
        chunk_ids: [chunk.chunk_id],
        continuity_confirmed: false,
        rank: rank([chunk.chunk_id], false),
      });
      continue;
    }
    if (!targetNormalized) continue;
    const source = normalizedByChunk.get(chunk.chunk_id);
    const normalizedStart = source.text.indexOf(targetNormalized);
    if (normalizedStart < 0) continue;
    const startOffset = source.offsets[normalizedStart];
    const lastOffset = source.offsets[normalizedStart + targetNormalized.length - 1];
    const range = extendNormalizedSourceRange(chunk.content, original, startOffset, lastOffset + 1);
    const excerpt = codePointSlice(chunk.content, range.start, range.end);
    candidates.push({
      category: linked.has(chunk.chunk_id) ? 'normalized_linked' : 'normalized_relinked',
      excerpt,
      chunk_ids: [chunk.chunk_id],
      continuity_confirmed: false,
      rank: rank([chunk.chunk_id], true),
    });
  }

  if (candidates.length) return candidates.sort((left, right) => left.rank - right.rank)[0];

  const targetExact = original;
  for (let startIndex = 0; startIndex < state.chunks.length; startIndex += 1) {
    const first = state.chunks[startIndex];
    for (let count = 2; count <= 3 && startIndex + count <= state.chunks.length; count += 1) {
      const window = state.chunks.slice(startIndex, startIndex + count);
      if (window.some((chunk) => chunk.dataset_id !== first.dataset_id || chunk.document_id !== first.document_id)) break;
      const ids = window.map((chunk) => chunk.chunk_id);
      const combined = window.map((chunk) => chunk.content).join('');
      const exactAt = combined.indexOf(targetExact);
      if (targetExact && exactAt >= 0) {
        return {
          category: 'exact_multichunk',
          excerpt: targetExact,
          chunk_ids: ids,
          continuity_confirmed: false,
          rank: rank(ids, false),
        };
      }
      if (!targetNormalized) continue;
      let sourceOffset = 0;
      const source = { text: '', offsets: [] };
      for (const chunk of window) {
        const normalized = normalizedByChunk.get(chunk.chunk_id);
        source.text += normalized.text;
        source.offsets.push(...normalized.offsets.map((offset) => offset + sourceOffset));
        sourceOffset += normalized.sourceLength;
      }
      const normalizedStart = source.text.indexOf(targetNormalized);
      if (normalizedStart < 0) continue;
      const startOffset = source.offsets[normalizedStart];
      const lastOffset = source.offsets[normalizedStart + targetNormalized.length - 1];
      const range = extendNormalizedSourceRange(combined, original, startOffset, lastOffset + 1);
      const excerpt = codePointSlice(combined, range.start, range.end);
      return {
        category: 'normalized_multichunk',
        excerpt,
        chunk_ids: ids,
        continuity_confirmed: false,
        rank: rank(ids, true),
      };
    }
  }

  const scorePartial = (chunkRows) => chunkRows.map((chunk) => {
    const source = normalizedByChunk.get(chunk.chunk_id);
    const match = longestNormalizedOverlap(targetNormalized, source);
    return { chunk, source, match, ratio: match.length / Math.max(1, targetNormalized.length) };
  }).sort((left, right) => right.ratio - left.ratio || right.match.length - left.match.length)[0];
  let partial = scorePartial(state.chunks.filter((chunk) => linked.has(chunk.chunk_id)));
  if (!partial || partial.ratio < 0.75) partial = scorePartial(state.chunks);
  if (!partial || partial.match.length < 24 || partial.ratio < 0.35) return null;
  const startOffset = partial.source.offsets[partial.match.sourceStart];
  const lastOffset = partial.source.offsets[partial.match.sourceStart + partial.match.length - 1];
  const range = extendNormalizedSourceRange(
    partial.chunk.content,
    original,
    startOffset,
    lastOffset + 1,
    {
      includeLeading: partial.match.targetStart === 0,
      includeTrailing: partial.match.targetStart + partial.match.length === targetNormalized.length,
    },
  );
  return {
    category: linked.has(partial.chunk.chunk_id) ? 'partial_linked' : 'partial_relinked',
    excerpt: codePointSlice(partial.chunk.content, range.start, range.end),
    chunk_ids: [partial.chunk.chunk_id],
    continuity_confirmed: false,
    match_ratio: partial.ratio,
    rank: 200 - partial.ratio,
  };
}

export function buildEvidenceMappingCandidates(state, experimentVersion = DEFAULT_EVIDENCE_MAPPING_EXPERIMENT) {
  const revisions = [];
  const auditRows = [];
  const normalizedByChunk = new Map(state.chunks.map((chunk) => [chunk.chunk_id, normalizedTextWithOffsets(chunk.content)]));
  for (const evidence of state.evidences) {
    const linkedIds = chunkIdsOfEvidence(state, evidence.evidence_id);
    const candidate = findSourceMatch(state, evidence, linkedIds, normalizedByChunk);
    if (!candidate) {
      auditRows.push({
        evidence_id: evidence.evidence_id,
        original_excerpt: evidence.excerpt || '',
        original_chunk_ids: linkedIds,
        category: 'unresolved',
        candidate_excerpt: '',
        candidate_chunk_ids: [],
        mapping_revision: null,
      });
      continue;
    }
    const revision = createEvidenceMappingRevision(state, {
      evidence_id: evidence.evidence_id,
      experiment_version: experimentVersion,
      excerpt: candidate.excerpt,
      chunk_ids: candidate.chunk_ids,
      continuity_confirmed: false,
      note: candidate.category.startsWith('normalized_')
        ? '自动定位建议：已从原始 Chunk 重摘精确文本；请人工复核 OCR、断行及语义范围。'
        : candidate.category.startsWith('partial_')
          ? '自动部分匹配建议：已缩小为 Chunk 中逐字存在的连续片段；请人工核对摘录范围及语义是否仍充分。'
        : candidate.category.endsWith('multichunk')
          ? '自动定位建议：请人工确认 Chunk 顺序及其在原文中的连续性。'
          : '自动定位建议：请人工确认摘录范围与 Evidence 语义。',
    });
    revisions.push(revision);
    auditRows.push({
      evidence_id: evidence.evidence_id,
      original_excerpt: evidence.excerpt || '',
      original_chunk_ids: linkedIds,
      category: candidate.category,
      candidate_excerpt: candidate.excerpt,
      candidate_chunk_ids: candidate.chunk_ids,
      match_ratio: candidate.match_ratio ?? 1,
      mapping_revision: revision,
    });
  }
  return { revisions, auditRows };
}
