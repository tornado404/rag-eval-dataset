import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readJsonl } from './dataset.mjs';

export const GOLDEN_VERSION = 'golden-v1';
export const FILE_ORDER = ['queries', 'facts', 'evidences', 'chunks', 'query_facts', 'fact_evidence', 'evidence_chunks'];
export const STATUSES = ['draft', 'review', 'approved'];
export const VARIANT_TYPES = ['canonical', 'paraphrase', 'colloquial', 'follow_up'];
export const BEHAVIORS = ['answer', 'refuse', 'clarify'];
export const REQUIREMENTS = ['required', 'required_any', 'optional', 'forbidden'];
export const LEGACY_ALTERNATIVE_GROUP_ID = 'A1';
export const FACT_TYPES = [
  'product_information',
  'population',
  'usage',
  'safety',
  'special_population',
  'ingredients',
  'usage_safety',
  'plain_language',
  'customer_service',
  'research_evidence',
  'cross_source',
];
export const FACT_TYPE_LABELS = {
  product_information: '产品信息',
  population: '适用性判断',
  usage: '用法用量',
  safety: '安全警示',
  special_population: '特殊人群',
  ingredients: '成分规格',
  usage_safety: '漏用误用',
  plain_language: '术语解释',
  customer_service: '客服口径',
  research_evidence: '科研证据',
  cross_source: '跨源核对',
};
export const TOPICS = [
  { id: 'S001', name: '手中产品信息核对' },
  { id: 'S002', name: '个人适用性确认' },
  { id: 'S003', name: '日常用法与用量' },
  { id: 'S004', name: '使用前限制与警示' },
  { id: 'S005', name: '特殊人群使用条件' },
  { id: 'S006', name: '成分与规格查询' },
  { id: 'S007', name: '漏用或误用后的处理' },
  { id: 'S008', name: '使用后不适的求助指引' },
  { id: 'S009', name: '与其他药物或补充剂同用' },
  { id: 'S010', name: '说明书术语通俗解释' },
  { id: 'S011', name: '查找匹配的客服答复' },
  { id: 'S012', name: '补充信息以澄清咨询' },
  { id: 'S013', name: '无匹配话术时转交核实' },
  { id: 'S014', name: '研究对象与适用条件' },
  { id: 'S015', name: '研究方法与干预安排' },
  { id: 'S016', name: '研究指标与报告结果' },
  { id: 'S017', name: '研究结果能否外推到个人' },
  { id: 'S018', name: '研究结论的局限与不确定性' },
  { id: 'S019', name: '不同研究结果的差异' },
  { id: 'S020', name: '产品资料与科研证据核对' },
  { id: 'S024', name: '长期用药与依从性' },
  { id: 'S025', name: '产品真伪与批号核验' },
  { id: 'S026', name: '价格、优惠与购买渠道' },
];
export const IMPORTANCE = ['P0', 'P1', 'P2'];
export const OPERATORS = ['OR', 'AND'];

const SPECS = {
  queries: { idField: 'query_id', prefix: 'Q', width: 4 },
  facts: { idField: 'fact_id', prefix: 'F', width: 3 },
  evidences: { idField: 'evidence_id', prefix: 'E', width: 3 },
  chunks: { idField: 'chunk_id', prefix: 'CK-', width: 4 },
};

const FIELDS = {
  queries: ['text', 'variant_type', 'parent_query_id', 'expected_behavior', 'status', 'notes'],
  facts: ['statement', 'topic', 'fact_type', 'importance', 'source_note', 'status'],
  evidences: ['title', 'excerpt', 'status'],
  chunks: ['dataset_id', 'document_id', 'document_name', 'page', 'content', 'source'],
};

export class GoldenError extends Error {
  constructor(message, status = 422, details = []) {
    super(message);
    this.name = 'GoldenError';
    this.status = status;
    this.details = details;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function oneOf(value, allowed, fallback) {
  const normalized = text(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizedGroupId(requirement, value) {
  const groupId = text(value);
  if (requirement === 'required_any') return groupId || LEGACY_ALTERNATIVE_GROUP_ID;
  return requirement === 'required' ? groupId : '';
}

export function goldenDir(version = GOLDEN_VERSION) {
  const override = text(process.env.GOLDEN_DATA_DIR);
  return override || path.join(REPO_ROOT, 'datasets', version);
}

function filePath(version, name) {
  return path.join(goldenDir(version), `${name}.jsonl`);
}

function writeRows(filePath, rows) {
  const content = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  fs.writeFileSync(filePath, content, 'utf8');
}

export function emptyState(version = GOLDEN_VERSION) {
  return { version, ...Object.fromEntries(FILE_ORDER.map((name) => [name, []])) };
}

export function readState(version = GOLDEN_VERSION) {
  const state = emptyState(version);
  for (const name of FILE_ORDER) {
    const file = filePath(version, name);
    state[name] = fs.existsSync(file) ? readJsonl(file) : [];
  }
  return state;
}

function serialized(state) {
  return Object.fromEntries(FILE_ORDER.map((name) => [name, JSON.stringify(state[name] || [])]));
}

function persist(state) {
  const dir = goldenDir(state.version);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of FILE_ORDER) writeRows(path.join(dir, `${name}.jsonl`), state[name] || []);
}

export function mutate(version, fn) {
  const state = readState(version);
  const before = serialized(state);
  const result = fn(state);
  const errors = validateState(state);
  if (errors.length) throw new GoldenError('validation failed', 422, errors);
  const after = serialized(state);
  for (const name of FILE_ORDER) {
    if (before[name] !== after[name]) writeRows(filePath(version, name), state[name]);
  }
  return result;
}

export function nextId(state, type) {
  const spec = SPECS[type];
  if (!spec) throw new GoldenError(`unknown entity type ${type}`, 400);
  const idField = spec.idField;
  const max = state[type].reduce((acc, row) => {
    const match = String(row[idField] || '').match(/(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `${spec.prefix}${String(max + 1).padStart(spec.width, '0')}`;
}

function copyFields(target, input, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) target[field] = input[field];
  }
}

function normalizeQuery(row, input) {
  copyFields(row, input, ['text', 'notes']);
  row.text = text(row.text);
  row.notes = text(row.notes);
  row.variant_type = oneOf(input.variant_type ?? row.variant_type, VARIANT_TYPES, 'canonical');
  row.parent_query_id = text(input.parent_query_id ?? row.parent_query_id);
  row.expected_behavior = oneOf(input.expected_behavior ?? row.expected_behavior, BEHAVIORS, 'answer');
  row.status = oneOf(input.status ?? row.status, STATUSES, 'draft');
}

function normalizeFact(row, input) {
  copyFields(row, input, ['statement', 'topic', 'source_note']);
  row.statement = text(row.statement);
  row.topic = text(row.topic);
  row.source_note = text(row.source_note);
  row.fact_type = oneOf(input.fact_type ?? row.fact_type, FACT_TYPES, FACT_TYPES[0]);
  row.importance = oneOf(input.importance ?? row.importance, IMPORTANCE, 'P1');
  row.status = oneOf(input.status ?? row.status, STATUSES, 'draft');
}

function normalizeEvidence(row, input) {
  copyFields(row, input, ['title', 'excerpt']);
  row.title = text(row.title);
  row.excerpt = text(row.excerpt);
  row.status = oneOf(input.status ?? row.status, STATUSES, 'draft');
}

function normalizeChunk(row, input) {
  copyFields(row, input, FIELDS.chunks);
  row.chunk_id = text(row.chunk_id);
  row.dataset_id = text(row.dataset_id);
  row.document_id = text(row.document_id);
  row.document_name = text(row.document_name);
  row.page = text(row.page);
  row.content = String(row.content ?? '');
  row.source = oneOf(row.source, ['ragflow', 'manual'], 'manual');
}

const NORMALIZERS = {
  queries: normalizeQuery,
  facts: normalizeFact,
  evidences: normalizeEvidence,
  chunks: normalizeChunk,
};

export function upsertEntity(state, type, input = {}) {
  const spec = SPECS[type];
  if (!spec || !NORMALIZERS[type]) throw new GoldenError(`unknown entity type ${type}`, 400);
  const idField = spec.idField;
  const inputId = text(input[idField]);
  let row = inputId ? state[type].find((item) => item[idField] === inputId) : null;
  const created = !row;

  if (created && type === 'chunks') row = { ...input, chunk_id: inputId || nextId(state, 'chunks') };
  else if (created) row = { [idField]: nextId(state, type), created_at: new Date().toISOString() };
  if (!row) throw new GoldenError(`${type} ${inputId} not found`, 404);

  if (created) state[type].push(row);
  row.updated_at = new Date().toISOString();
  NORMALIZERS[type](row, input);
  if (!row[idField]) throw new GoldenError(`${idField} is required`, 422);
  return { row, created };
}

export function deleteEntity(state, type, id) {
  const spec = SPECS[type];
  if (!spec) throw new GoldenError(`unknown entity type ${type}`, 400);
  const idField = spec.idField;
  const index = state[type].findIndex((row) => row[idField] === id);
  if (index < 0) throw new GoldenError(`${type} ${id} not found`, 404);
  state[type].splice(index, 1);

  if (type === 'queries') {
    state.query_facts = state.query_facts.filter((row) => row.query_id !== id);
    const removedRootIds = new Set([id, ...state.queries
      .filter((row) => row.parent_query_id === id)
      .map((row) => row.query_id)]);
    for (const child of state.queries) {
      if (removedRootIds.has(child.parent_query_id)) {
        child.parent_query_id = '';
        child.updated_at = new Date().toISOString();
      }
    }
  }
  if (type === 'facts') {
    state.query_facts = state.query_facts.filter((row) => row.fact_id !== id);
    state.fact_evidence = state.fact_evidence.filter((row) => row.fact_id !== id);
  }
  if (type === 'evidences') {
    state.fact_evidence = state.fact_evidence
      .map((row) => ({ ...row, evidence_ids: (row.evidence_ids || []).filter((evidenceId) => evidenceId !== id) }))
      .filter((row) => row.evidence_ids.length > 0);
    state.evidence_chunks = state.evidence_chunks.filter((row) => row.evidence_id !== id);
  }
  if (type === 'chunks') {
    state.evidence_chunks = state.evidence_chunks
      .map((row) => ({ ...row, chunk_ids: (row.chunk_ids || []).filter((chunkId) => chunkId !== id) }))
      .filter((row) => row.chunk_ids.length > 0);
  }
  return { deleted: id };
}

export function applyQueryFacts(state, queryId, facts) {
  if (!state.queries.some((row) => row.query_id === queryId)) throw new GoldenError(`query ${queryId} not found`, 404);
  const seen = new Set();
  const rows = [];
  for (const item of Array.isArray(facts) ? facts : []) {
    const factId = text(typeof item === 'string' ? item : item.fact_id);
    if (!factId || seen.has(factId)) continue;
    seen.add(factId);
    const requirement = oneOf(typeof item === 'string' ? '' : item.requirement, REQUIREMENTS, 'required');
    const rawGroupId = typeof item === 'string' ? '' : text(item.group_id);
    if (rawGroupId && !['required', 'required_any'].includes(requirement)) {
      throw new GoldenError(`only scoring requirements can have a group_id for ${factId}`, 422);
    }
    if (rawGroupId && !/^[A-Z][A-Z0-9_-]{0,15}$/.test(rawGroupId)) {
      throw new GoldenError(`invalid group_id for ${factId}`, 422);
    }
    const groupId = normalizedGroupId(requirement, rawGroupId);
    rows.push({
      query_id: queryId,
      fact_id: factId,
      requirement,
      ...(groupId ? { group_id: groupId } : {}),
    });
  }
  state.query_facts = state.query_facts.filter((row) => row.query_id !== queryId).concat(rows);
  return rows;
}

export function applyQueryFactManagement(state, queryId, facts, factStatuses = []) {
  const links = applyQueryFacts(state, queryId, facts);
  const seen = new Set();
  for (const item of Array.isArray(factStatuses) ? factStatuses : []) {
    const factId = text(item?.fact_id);
    if (!factId || seen.has(factId)) continue;
    seen.add(factId);
    const fact = state.facts.find((row) => row.fact_id === factId);
    if (!fact) throw new GoldenError(`fact ${factId} not found`, 404);
    const status = text(item.status);
    if (!STATUSES.includes(status)) throw new GoldenError(`invalid fact status for ${factId}`, 422);
    if (fact.status !== status) {
      fact.status = status;
      fact.updated_at = new Date().toISOString();
    }
  }
  return { links, updated_fact_statuses: [...seen] };
}

export function createQueryBundle(state, input = {}) {
  const items = (Array.isArray(input.queries) ? input.queries : []).filter((item) => item && typeof item === 'object');
  if (!items.length) throw new GoldenError('至少需要一条 Query', 400);
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const created = [];
  let mainQueryId = '';

  items.forEach((item, index) => {
    const kind = oneOf(item.variant_type, VARIANT_TYPES, 'paraphrase');
    const { row } = upsertEntity(state, 'queries', {
      text: item.text,
      variant_type: index === 0 ? 'canonical' : kind === 'canonical' ? 'paraphrase' : kind,
      parent_query_id: index === 0 ? '' : mainQueryId,
      expected_behavior: item.expected_behavior,
      status: item.status || 'draft',
      notes: item.notes,
    });
    if (index === 0) mainQueryId = row.query_id;
    if (facts.length) applyQueryFacts(state, row.query_id, facts);
    created.push(row);
  });

  return { main_query_id: mainQueryId, queries: created };
}

export function applyFactEvidence(state, factId, evidenceIds, operator = 'OR') {
  if (!state.facts.some((row) => row.fact_id === factId)) throw new GoldenError(`fact ${factId} not found`, 404);
  const ids = unique(Array.isArray(evidenceIds) ? evidenceIds : []);
  const existing = state.fact_evidence.find((row) => row.fact_id === factId);
  const row = { fact_id: factId, evidence_ids: ids, operator: oneOf(operator, OPERATORS, 'OR') };
  if (existing) Object.assign(existing, row);
  else state.fact_evidence.push(row);
  return row;
}

export function addFactEvidence(state, factId, evidenceId) {
  const existing = state.fact_evidence.find((row) => row.fact_id === factId);
  if (!existing) {
    state.fact_evidence.push({ fact_id: factId, evidence_ids: [evidenceId], operator: 'OR' });
    return;
  }
  if (!existing.evidence_ids.includes(evidenceId)) existing.evidence_ids.push(evidenceId);
}

export function applyEvidenceChunks(state, evidenceId, chunkIds) {
  if (!state.evidences.some((row) => row.evidence_id === evidenceId)) throw new GoldenError(`evidence ${evidenceId} not found`, 404);
  const ids = unique(Array.isArray(chunkIds) ? chunkIds : []);
  const existing = state.evidence_chunks.find((row) => row.evidence_id === evidenceId);
  if (existing) existing.chunk_ids = ids;
  else state.evidence_chunks.push({ evidence_id: evidenceId, chunk_ids: ids });
  return { evidence_id: evidenceId, chunk_ids: ids };
}

export function createEvidence(state, input = {}) {
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  for (const chunk of chunks) upsertEntity(state, 'chunks', chunk);
  const chunkIds = unique([
    ...(Array.isArray(input.chunk_ids) ? input.chunk_ids : []),
    ...chunks.map((chunk) => chunk.chunk_id),
  ]);

  for (const chunkId of chunkIds) {
    if (!state.chunks.some((row) => row.chunk_id === chunkId)) throw new GoldenError(`chunk ${chunkId} not found`, 404);
  }

  const { row: evidence } = upsertEntity(state, 'evidences', {
    evidence_id: input.evidence_id,
    title: input.title,
    excerpt: input.excerpt,
    status: input.status || 'draft',
  });
  applyEvidenceChunks(state, evidence.evidence_id, chunkIds);
  if (text(input.fact_id)) addFactEvidence(state, text(input.fact_id), evidence.evidence_id);
  return { evidence, chunk_ids: chunkIds };
}

export function queryFactsOf(state, queryId) {
  return state.query_facts.filter((row) => row.query_id === queryId).map((row) => {
    const groupId = normalizedGroupId(row.requirement, row.group_id);
    return groupId ? { ...row, group_id: groupId } : row;
  });
}

export function evidenceIdsOfFact(state, factId) {
  const relation = state.fact_evidence.find((row) => row.fact_id === factId);
  return relation ? unique(relation.evidence_ids) : [];
}

export function chunkIdsOfEvidence(state, evidenceId) {
  const relation = state.evidence_chunks.find((row) => row.evidence_id === evidenceId);
  return relation ? unique(relation.chunk_ids) : [];
}

export function chunkIdsOfFact(state, factId) {
  return unique(evidenceIdsOfFact(state, factId).flatMap((evidenceId) => chunkIdsOfEvidence(state, evidenceId)));
}

export function assessRecall(state, queryId, retrievedChunkIds, topK = 12, latencyMs = null) {
  if (!state.queries.some((row) => row.query_id === queryId)) throw new GoldenError(`query ${queryId} not found`, 404);
  const retrieved = new Set(retrievedChunkIds);
  const scoredLinks = queryFactsOf(state, queryId).filter((row) => ['required', 'required_any'].includes(row.requirement));
  const linkByFact = new Map(scoredLinks.map((row) => [row.fact_id, row]));
  const factRows = unique(scoredLinks.map((row) => row.fact_id)).map((factId) => {
    const link = linkByFact.get(factId);
    const fact = state.facts.find((row) => row.fact_id === factId);
    const relation = state.fact_evidence.find((row) => row.fact_id === factId);
    const operator = oneOf(relation?.operator, OPERATORS, 'OR');
    const evidenceIds = evidenceIdsOfFact(state, factId);
    const perEvidence = evidenceIds.map((evidenceId) => {
      const chunkIds = chunkIdsOfEvidence(state, evidenceId);
      const matched = chunkIds.filter((chunkId) => retrieved.has(chunkId));
      return { evidence_id: evidenceId, chunk_ids: chunkIds, hit: matched.length > 0, matched_chunk_ids: matched };
    });
    const chunkBearing = perEvidence.filter((item) => item.chunk_ids.length > 0);
    const factHit = operator === 'AND'
      ? chunkBearing.length > 0 && chunkBearing.every((item) => item.hit)
      : chunkBearing.some((item) => item.hit);
    return {
      fact_id: factId,
      statement: fact?.statement || '',
      requirement: link.requirement,
      group_id: normalizedGroupId(link.requirement, link.group_id),
      status: fact?.status || 'draft',
      operator,
      evidence_ids: evidenceIds,
      chunk_ids: unique(perEvidence.flatMap((item) => item.chunk_ids)),
      matched_chunk_ids: unique(perEvidence.flatMap((item) => item.matched_chunk_ids)),
      scorable: chunkBearing.length > 0,
      hit: factHit,
      evidence: perEvidence,
    };
  });

  const requiredFacts = factRows.filter((row) => row.requirement === 'required');
  const groupBuckets = new Map();
  for (const row of factRows) {
    if (row.requirement === 'required' && !row.group_id) continue;
    const key = `${row.requirement}\u0000${row.group_id}`;
    const bucket = groupBuckets.get(key) || { requirement: row.requirement, group_id: row.group_id, facts: [] };
    bucket.facts.push(row);
    groupBuckets.set(key, bucket);
  }
  const groups = [...groupBuckets.values()].map((group) => {
    const scorableFacts = group.facts.filter((row) => row.scorable);
    const hitFacts = scorableFacts.filter((row) => row.hit);
    const isRequiredAll = group.requirement === 'required';
    const conditionTotal = isRequiredAll ? group.facts.length : 1;
    const scorableTotal = isRequiredAll ? scorableFacts.length : Number(scorableFacts.length > 0);
    const hitTotal = isRequiredAll ? hitFacts.length : Number(hitFacts.length > 0);
    return {
      requirement: group.requirement,
      group_id: group.group_id,
      fact_ids: group.facts.map((row) => row.fact_id),
      condition_total: conditionTotal,
      scorable_total: scorableTotal,
      hit_total: hitTotal,
      scorable_fact_ids: scorableFacts.map((row) => row.fact_id),
      hit_fact_ids: hitFacts.map((row) => row.fact_id),
      complete: isRequiredAll
        ? group.facts.every((row) => row.scorable && row.hit)
        : hitFacts.length > 0,
    };
  });
  const requiredGroups = groups.filter((group) => group.requirement === 'required');
  const alternativeGroups = groups.filter((group) => group.requirement === 'required_any');
  const requiredSingles = requiredFacts.filter((row) => !row.group_id);
  const requiredTotal = requiredFacts.length + alternativeGroups.length;
  const scorableTotal = requiredFacts.filter((row) => row.scorable).length
    + alternativeGroups.filter((group) => group.scorable_total > 0).length;
  const hitTotal = requiredFacts.filter((row) => row.scorable && row.hit).length
    + alternativeGroups.filter((group) => group.hit_total > 0).length;
  return {
    query_id: queryId,
    top_k: topK,
    latency_ms: latencyMs,
    required_total: requiredTotal,
    required_fact_count: factRows.length,
    required_group_count: requiredGroups.length,
    required_single_count: requiredSingles.length,
    alternative_group_count: alternativeGroups.length,
    scorable_total: scorableTotal,
    hit_total: hitTotal,
    recall: scorableTotal ? hitTotal / scorableTotal : null,
    coverage: requiredTotal ? hitTotal / requiredTotal : null,
    groups,
    facts: factRows,
  };
}

export function validateState(state) {
  const errors = [];
  const ids = { queries: new Set(), facts: new Set(), evidences: new Set(), chunks: new Set() };

  const checkIds = (type, idField) => {
    state[type].forEach((row, index) => {
      const id = text(row[idField]);
      if (!id) errors.push(`${type}:${index + 1}: missing ${idField}`);
      else if (ids[type].has(id)) errors.push(`${type}:${index + 1}: duplicate ${idField} ${id}`);
      else ids[type].add(id);
    });
  };
  checkIds('queries', 'query_id');
  checkIds('facts', 'fact_id');
  checkIds('evidences', 'evidence_id');
  checkIds('chunks', 'chunk_id');

  const normalizedText = (value) => text(value).toLowerCase().replace(/[\s，。？?！!,.]/g, '');
  const seenText = new Map();
  for (const row of state.queries) {
    if (!text(row.text)) errors.push(`queries:${row.query_id}: empty text`);
    const key = normalizedText(row.text);
    if (key && seenText.has(key)) errors.push(`queries:${row.query_id}: duplicate text of ${seenText.get(key)}`);
    else if (key) seenText.set(key, row.query_id);
    if (!VARIANT_TYPES.includes(row.variant_type)) errors.push(`queries:${row.query_id}: invalid variant_type`);
    if (!STATUSES.includes(row.status)) errors.push(`queries:${row.query_id}: invalid status`);
    if (!BEHAVIORS.includes(row.expected_behavior)) errors.push(`queries:${row.query_id}: invalid expected_behavior`);
    if (row.parent_query_id) {
      if (row.parent_query_id === row.query_id) errors.push(`queries:${row.query_id}: parent is self`);
      else if (!ids.queries.has(row.parent_query_id)) errors.push(`queries:${row.query_id}: unknown parent ${row.parent_query_id}`);
    }
  }

  const queryById = new Map(state.queries.map((row) => [row.query_id, row]));
  for (const row of state.queries) {
    if (!row.parent_query_id) continue;
    const parent = queryById.get(row.parent_query_id);
    if (!parent) continue;
    if (parent.variant_type !== 'canonical') {
      errors.push(`queries:${row.query_id}: parent ${parent.query_id} is not canonical`);
    }
    if (parent.parent_query_id) {
      errors.push(`queries:${row.query_id}: parent ${parent.query_id} is a variant`);
    }
  }

  for (const row of state.facts) {
    if (!text(row.statement)) errors.push(`facts:${row.fact_id}: empty statement`);
    if (!FACT_TYPES.includes(row.fact_type)) errors.push(`facts:${row.fact_id}: invalid fact_type`);
    if (!IMPORTANCE.includes(row.importance)) errors.push(`facts:${row.fact_id}: invalid importance`);
    if (!STATUSES.includes(row.status)) errors.push(`facts:${row.fact_id}: invalid status`);
  }

  for (const row of state.evidences) {
    if (!text(row.title)) errors.push(`evidences:${row.evidence_id}: empty title`);
    if (!text(row.excerpt)) errors.push(`evidences:${row.evidence_id}: empty excerpt`);
    if (!STATUSES.includes(row.status)) errors.push(`evidences:${row.evidence_id}: invalid status`);
  }

  for (const row of state.chunks) {
    if (!text(row.content)) errors.push(`chunks:${row.chunk_id}: empty content`);
    if (!['ragflow', 'manual'].includes(row.source)) errors.push(`chunks:${row.chunk_id}: invalid source`);
  }

  const seenQueryFact = new Set();
  const queryGroupRequirements = new Map();
  for (const row of state.query_facts) {
    if (!ids.queries.has(row.query_id)) errors.push(`query_facts: unknown query ${row.query_id}`);
    if (!ids.facts.has(row.fact_id)) errors.push(`query_facts: unknown fact ${row.fact_id}`);
    if (!REQUIREMENTS.includes(row.requirement)) errors.push(`query_facts:${row.query_id}: invalid requirement`);
    const rawGroupId = text(row.group_id);
    const groupId = normalizedGroupId(row.requirement, row.group_id);
    if (row.group_id != null && typeof row.group_id !== 'string') {
      errors.push(`query_facts:${row.query_id}:${row.fact_id}: group_id must be a string`);
    }
    if (typeof row.group_id === 'string' && rawGroupId !== row.group_id) {
      errors.push(`query_facts:${row.query_id}:${row.fact_id}: group_id must be trimmed`);
    }
    if (groupId && !/^[A-Z][A-Z0-9_-]{0,15}$/.test(groupId)) {
      errors.push(`query_facts:${row.query_id}:${row.fact_id}: invalid group_id ${groupId}`);
    }
    if (rawGroupId && !['required', 'required_any'].includes(row.requirement)) {
      errors.push(`query_facts:${row.query_id}:${row.fact_id}: only scoring requirements can have a group_id`);
    }
    if (groupId && ['required', 'required_any'].includes(row.requirement)) {
      const groupKey = `${row.query_id}\u0000${groupId}`;
      const priorRequirement = queryGroupRequirements.get(groupKey);
      if (priorRequirement && priorRequirement !== row.requirement) {
        errors.push(`query_facts:${row.query_id}: group ${groupId} mixes requirements`);
      } else {
        queryGroupRequirements.set(groupKey, row.requirement);
      }
    }
    const key = `${row.query_id}\u0000${row.fact_id}`;
    if (seenQueryFact.has(key)) errors.push(`query_facts: duplicate ${row.query_id} ${row.fact_id}`);
    seenQueryFact.add(key);
  }

  const seenFactEvidence = new Set();
  for (const row of state.fact_evidence) {
    if (!ids.facts.has(row.fact_id)) errors.push(`fact_evidence: unknown fact ${row.fact_id}`);
    if (seenFactEvidence.has(row.fact_id)) errors.push(`fact_evidence: duplicate fact ${row.fact_id}`);
    seenFactEvidence.add(row.fact_id);
    if (!OPERATORS.includes(row.operator)) errors.push(`fact_evidence:${row.fact_id}: invalid operator`);
    for (const evidenceId of row.evidence_ids || []) {
      if (!ids.evidences.has(evidenceId)) errors.push(`fact_evidence:${row.fact_id}: unknown evidence ${evidenceId}`);
    }
  }

  const seenEvidenceChunk = new Set();
  for (const row of state.evidence_chunks) {
    if (!ids.evidences.has(row.evidence_id)) errors.push(`evidence_chunks: unknown evidence ${row.evidence_id}`);
    if (seenEvidenceChunk.has(row.evidence_id)) errors.push(`evidence_chunks: duplicate evidence ${row.evidence_id}`);
    seenEvidenceChunk.add(row.evidence_id);
    for (const chunkId of row.chunk_ids || []) {
      if (!ids.chunks.has(chunkId)) errors.push(`evidence_chunks:${row.evidence_id}: unknown chunk ${chunkId}`);
    }
  }

  return errors;
}

const normalizeSuggestionText = (value) => text(value).toLowerCase().replace(/[\s，。？?！!,.]/g, '');

export function parseSuggestions(raw, existingTexts = []) {
  const source = String(raw ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = source.search(/[[{]/);
  const end = Math.max(source.lastIndexOf('}'), source.lastIndexOf(']'));
  if (start < 0 || end <= start) throw new GoldenError('LLM 返回的内容不是 JSON', 502);

  let payload;
  try {
    payload = JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new GoldenError('LLM 返回的 JSON 无法解析', 502);
  }

  const candidates = [];
  if (!Array.isArray(payload) && text(payload?.canonical)) {
    candidates.push({ text: text(payload.canonical), variant_type: 'canonical', rationale: '' });
  }
  const variants = Array.isArray(payload) ? payload : Array.isArray(payload?.variants) ? payload.variants : [];
  for (const item of variants) {
    if (!item || typeof item !== 'object') continue;
    candidates.push({
      text: text(item.text),
      variant_type: oneOf(item.variant_type, VARIANT_TYPES.filter((type) => type !== 'canonical'), 'paraphrase'),
      rationale: text(item.rationale),
    });
  }

  const seen = new Set((existingTexts || []).map(normalizeSuggestionText).filter(Boolean));
  return candidates.filter((candidate) => {
    const key = normalizeSuggestionText(candidate.text);
    if (!key || candidate.text.length > 200 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function coverageGaps(state) {
  const factIds = new Set(state.facts.map((row) => row.fact_id));
  const requiredFacts = new Set();
  const queryIdsWithoutScoringFacts = [];
  const requiredGroupsWithoutChunks = [];
  const alternativeGroupsWithoutChunks = [];
  for (const query of state.queries) {
    const links = queryFactsOf(state, query.query_id);
    const required = links.filter((row) => row.requirement === 'required');
    const alternatives = links.filter((row) => row.requirement === 'required_any');
    if (!required.length && !alternatives.length) queryIdsWithoutScoringFacts.push(query.query_id);
    const requiredGroups = new Map();
    const alternativeGroups = new Map();
    for (const link of required) {
      if (!link.group_id) {
        if (!chunkIdsOfFact(state, link.fact_id).length) requiredFacts.add(link.fact_id);
        continue;
      }
      const members = requiredGroups.get(link.group_id) || [];
      members.push(link);
      requiredGroups.set(link.group_id, members);
    }
    for (const link of alternatives) {
      const groupId = link.group_id || LEGACY_ALTERNATIVE_GROUP_ID;
      const members = alternativeGroups.get(groupId) || [];
      members.push(link);
      alternativeGroups.set(groupId, members);
    }
    for (const [groupId, members] of requiredGroups) {
      const missingFactIds = members
        .filter((link) => !chunkIdsOfFact(state, link.fact_id).length)
        .map((link) => link.fact_id);
      for (const factId of missingFactIds) requiredFacts.add(factId);
      if (missingFactIds.length) {
        requiredGroupsWithoutChunks.push({ query_id: query.query_id, group_id: groupId, missing_fact_ids: missingFactIds });
      }
    }
    for (const [groupId, members] of alternativeGroups) {
      if (members.some((link) => chunkIdsOfFact(state, link.fact_id).length)) continue;
      const missingFactIds = members.map((link) => link.fact_id);
      for (const factId of missingFactIds) requiredFacts.add(factId);
      alternativeGroupsWithoutChunks.push({ query_id: query.query_id, group_id: groupId, fact_ids: missingFactIds });
    }
  }
  return {
    facts_without_evidence: [...factIds].filter((factId) => evidenceIdsOfFact(state, factId).length === 0),
    facts_without_chunks: [...factIds].filter((factId) => chunkIdsOfFact(state, factId).length === 0),
    evidences_without_chunks: state.evidences.filter((row) => chunkIdsOfEvidence(state, row.evidence_id).length === 0)
      .map((row) => row.evidence_id),
    queries_without_required_facts: queryIdsWithoutScoringFacts,
    required_facts_without_chunks: [...requiredFacts],
    required_groups_without_chunks: requiredGroupsWithoutChunks,
    alternative_groups_without_chunks: alternativeGroupsWithoutChunks,
  };
}

export function evidenceInventory(state) {
  const knownChunkIds = new Set((state.chunks || []).map((row) => text(row.chunk_id)).filter(Boolean));
  const chunksByEvidence = new Map();
  const linkedChunkIds = new Set();

  for (const relation of state.evidence_chunks || []) {
    const evidenceId = text(relation.evidence_id);
    const chunkIds = unique(relation.chunk_ids).filter((chunkId) => knownChunkIds.has(chunkId));
    if (!evidenceId || !chunkIds.length) continue;
    chunksByEvidence.set(evidenceId, unique([...(chunksByEvidence.get(evidenceId) || []), ...chunkIds]));
    for (const chunkId of chunkIds) linkedChunkIds.add(chunkId);
  }

  const chunkCount = (state.chunks || []).length;
  return {
    evidence_count: (state.evidences || []).length,
    chunk_count: chunkCount,
    linked_chunk_count: linkedChunkIds.size,
    unlinked_chunk_count: Math.max(0, chunkCount - linkedChunkIds.size),
    evidence_without_chunk_count: (state.evidences || []).filter(
      (row) => !(chunksByEvidence.get(text(row.evidence_id)) || []).length,
    ).length,
  };
}

function boundedOption(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function compactText(value) {
  return text(value).toLocaleLowerCase('en-US').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function lexicalTerms(value) {
  const tokens = text(value).toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || [];
  const terms = new Set();
  for (const token of tokens) {
    terms.add(token);
    if (/^\p{Script=Han}+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.add(token.slice(index, index + 2));
      }
    }
  }
  return terms;
}

function lexicalScore(reference, content) {
  const referenceText = compactText(reference);
  const contentText = compactText(content);
  if (!referenceText || !contentText) return 0;
  if (contentText.includes(referenceText) || referenceText.includes(contentText)) return 1;

  const referenceTerms = lexicalTerms(reference);
  const contentTerms = lexicalTerms(content);
  if (!referenceTerms.size || !contentTerms.size) return 0;
  let matched = 0;
  for (const term of referenceTerms) {
    if (contentTerms.has(term)) matched += 1;
  }
  return matched / referenceTerms.size;
}

function authoritativeSimilarity(candidate) {
  if (!candidate || !Object.prototype.hasOwnProperty.call(candidate, 'similarity')) return null;
  const parsed = typeof candidate.similarity === 'number'
    ? candidate.similarity
    : Number.parseFloat(String(candidate.similarity ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function autoMatchQuery(state, queryId, candidates, { topK = 12, minSimilarity = 0 } = {}) {
  const query = (state.queries || []).find((row) => row.query_id === queryId);
  if (!query) throw new GoldenError(`query ${queryId} not found`, 404);

  const limit = Math.min(50, Math.max(1, Math.trunc(boundedOption(topK, 1, 50, 12))));
  const threshold = boundedOption(minSimilarity, 0, 1, 0);
  const factIds = unique(queryFactsOf(state, queryId).map((row) => row.fact_id));

  const factContexts = factIds.map((factId) => {
    const fact = (state.facts || []).find((row) => row.fact_id === factId);
    return {
      fact_id: factId,
      fields: fact ? [fact.statement, fact.topic, fact.source_note] : [],
      evidence_ids: evidenceIdsOfFact(state, factId),
    };
  });
  const evidenceIds = unique(factContexts.flatMap((item) => item.evidence_ids));
  const evidenceContexts = evidenceIds.map((evidenceId) => {
    const evidence = (state.evidences || []).find((row) => row.evidence_id === evidenceId);
    return {
      evidence_id: evidenceId,
      fields: evidence ? [evidence.title, evidence.excerpt] : [],
    };
  });
  const linkedChunkIds = new Set(unique((state.evidence_chunks || []).flatMap((row) => row.chunk_ids)));

  const scored = (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const content = String(candidate?.content ?? '');
    const referenceScores = [lexicalScore(query.text, content)];
    const matchedFactIds = [];
    const matchedEvidenceIds = [];

    for (const context of factContexts) {
      const score = Math.max(0, ...context.fields.map((field) => lexicalScore(field, content)));
      referenceScores.push(score);
      if (score > 0) matchedFactIds.push(context.fact_id);
    }
    for (const context of evidenceContexts) {
      const score = Math.max(0, ...context.fields.map((field) => lexicalScore(field, content)));
      referenceScores.push(score);
      if (score > 0) matchedEvidenceIds.push(context.evidence_id);
    }

    const rawSimilarity = authoritativeSimilarity(candidate);
    const similarity = rawSimilarity ?? Math.min(1, Math.max(0, Math.max(0, ...referenceScores)));
    return {
      ...candidate,
      matched_fact_ids: matchedFactIds,
      matched_evidence_ids: matchedEvidenceIds,
      is_linked: linkedChunkIds.has(text(candidate?.chunk_id)),
      similarity,
    };
  });

  const ordered = scored
    .filter((candidate) => candidate.similarity >= threshold)
    .sort((left, right) => {
      if (left.similarity !== right.similarity) return right.similarity - left.similarity;
      const leftId = text(left.chunk_id);
      const rightId = text(right.chunk_id);
      if (leftId < rightId) return -1;
      return leftId > rightId ? 1 : 0;
    })
    .slice(0, limit);

  return { query_id: queryId, fact_ids: factIds, query_text: query.text, candidates: ordered };
}
