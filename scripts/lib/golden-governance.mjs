import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  FILE_ORDER,
  GOLDEN_VERSION,
  chunkIdsOfEvidence,
  chunkIdsOfFact,
  goldenDir,
  readState,
} from './golden.mjs';
import { readJsonl } from './dataset.mjs';

export const CONTRACT_SCHEMA_VERSION = 'golden-governance/v1';
export const REVIEW_SCHEMA_VERSION = 'golden-governance-review/v1';
export const SPLIT_SCHEMA_VERSION = 'golden-split/v1';
export const DEFAULT_CONTRACT = {
  schema_version: CONTRACT_SCHEMA_VERSION,
  dataset_id: GOLDEN_VERSION,
  core_tables: [...FILE_ORDER],
  review_subjects: ['query_fact', 'fact_mapping', 'split'],
  review_statuses: ['approved', 'rejected'],
  split_statuses: ['proposed', 'approved', 'rejected'],
  split_assignments: ['train', 'validation', 'quarantined'],
  scoring_requirements: ['required', 'required_any'],
};

const REVIEW_SUBJECTS = new Map([
  ['query_fact', {
    recordType: 'query-fact',
    idLabel: 'query and fact',
    subjectId(input) {
      return `${requireArg(input.queryId, '--query')}|${requireArg(input.factId, '--fact')}`;
    },
    current(state, input) {
      const queryId = requireArg(input.queryId, '--query');
      const factId = requireArg(input.factId, '--fact');
      const link = state.query_facts.find((row) => row.query_id === queryId && row.fact_id === factId);
      if (!link) throw new Error(`query fact ${queryId}|${factId} not found`);
      return {
        query_id: queryId,
        fact_id: factId,
        digestInput: { query_fact: link },
      };
    },
  }],
  ['fact_mapping', {
    recordType: 'mapping',
    idLabel: 'fact',
    subjectId(input) {
      return requireArg(input.factId, '--fact');
    },
    current(state, input) {
      const factId = requireArg(input.factId, '--fact');
      const fact = state.facts.find((row) => row.fact_id === factId);
      if (!fact) throw new Error(`fact ${factId} not found`);
      const relation = state.fact_evidence.find((row) => row.fact_id === factId);
      return {
        fact_id: factId,
        digestInput: {
          statement: fact.statement || '',
          operator: relation?.operator || '',
          evidence_ids: relation?.evidence_ids || [],
          chunks_by_evidence: (relation?.evidence_ids || []).map((evidenceId) => chunkIdsOfEvidence(state, evidenceId)),
        },
      };
    },
  }],
  ['split', {
    recordType: 'split',
    idLabel: 'split',
    subjectId(input) {
      return requireArg(input.splitId, '--split');
    },
    current(state, input, split) {
      const splitId = requireArg(input.splitId, '--split');
      if (!split || split.id !== splitId) throw new Error(`split ${splitId} not found`);
      return {
        split_id: splitId,
        digestInput: splitInput(split),
      };
    },
  }],
]);

function requireArg(value, flag) {
  if (!String(value ?? '').trim()) throw new Error(`${flag} is required`);
  return String(value).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return sha256(stableStringify(value));
}

export function coreDigest(state) {
  return digest(Object.fromEntries(FILE_ORDER.map((name) => [name, state[name] || []])));
}

export function subjectDigest(subjectType, value) {
  return digest({ schema_version: REVIEW_SCHEMA_VERSION, subject_type: subjectType, subject: value });
}

function governanceDir(version = GOLDEN_VERSION) {
  return path.join(goldenDir(version), 'governance');
}

function contractFile(version) {
  return path.join(governanceDir(version), 'contract.json');
}

function reviewsFile(version) {
  return path.join(governanceDir(version), 'reviews.jsonl');
}

function splitsDir(version) {
  return path.join(governanceDir(version), 'splits');
}

function splitFile(version, id) {
  return path.join(splitsDir(version), `${requireArg(id, 'id')}.json`);
}

export function loadContract(version = GOLDEN_VERSION) {
  const file = contractFile(version);
  const schemaFile = path.join(path.resolve(import.meta.dirname, '../..'), 'schemas', 'golden-governance-contract.json');
  const source = fs.existsSync(file) ? file : schemaFile;
  if (!fs.existsSync(source)) return { ...DEFAULT_CONTRACT, dataset_id: version };
  const contract = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (contract.schema_version !== CONTRACT_SCHEMA_VERSION) {
    throw new Error(`${file}: unsupported schema_version ${contract.schema_version}`);
  }
  return contract;
}

export function loadGovernance(version = GOLDEN_VERSION) {
  const contract = loadContract(version);
  const state = readState(version);
  state.__dir = goldenDir(version);
  const reviewRows = fs.existsSync(reviewsFile(version)) ? readJsonl(reviewsFile(version)) : [];
  const splitRows = fs.existsSync(splitsDir(version))
    ? fs.readdirSync(splitsDir(version)).filter((name) => name.endsWith('.json')).sort().map((name) => (
      JSON.parse(fs.readFileSync(path.join(splitsDir(version), name), 'utf8'))
    ))
    : [];
  return { version, contract, state, reviewRows, splitRows };
}

export function upsertReview(rows, input) {
  const status = String(input.status ?? '').trim();
  if (!['approved', 'rejected'].includes(status)) throw new Error(`invalid review status ${status}`);
  const reviewer = requireArg(input.reviewer, '--reviewer');
  const current = rows.find((row) => row.subject_type === input.subject_type && row.subject_id === input.subject_id);
  if (current
    && current.status === status
    && current.reviewer === reviewer
    && current.subject_digest === input.subject_digest
    && String(current.note ?? '') === String(input.note ?? '')) {
    return { row: current, created: false, changed: false };
  }
  const row = current || {
    schema_version: REVIEW_SCHEMA_VERSION,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
  };
  const previous = { ...row };
  Object.assign(row, {
    ...input,
    schema_version: REVIEW_SCHEMA_VERSION,
    status,
    reviewer,
    reviewed_at: input.reviewedAt || new Date().toISOString(),
    note: String(input.note ?? ''),
  });
  if (!current) rows.push(row);
  return { row, created: !current, changed: JSON.stringify(previous) !== JSON.stringify(row) };
}

export function reviewState(reviewRows, subjectType, subjectId, currentDigest) {
  const row = reviewRows.find((item) => item.subject_type === subjectType && item.subject_id === subjectId);
  if (!row) return 'pending';
  if (row.subject_digest !== currentDigest) return 'stale';
  return ['approved', 'rejected'].includes(row.status) ? row.status : 'pending';
}

export function scenarioOf(query) {
  return String(query?.notes || '').match(/场景\s+(S\d+)/)?.[1] || `missing:${query.query_id}`;
}

function requiredLinkRows(state) {
  return state.query_facts.filter((row) => ['required', 'required_any'].includes(row.requirement));
}

function requiredResources(state) {
  const facts = new Map();
  const chunks = new Map();
  for (const link of requiredLinkRows(state)) {
    const factIds = facts.get(link.query_id) || new Set();
    factIds.add(link.fact_id);
    facts.set(link.query_id, factIds);
    const chunkIds = chunks.get(link.query_id) || new Set();
    for (const chunkId of chunkIdsOfFact(state, link.fact_id)) chunkIds.add(chunkId);
    chunks.set(link.query_id, chunkIds);
  }
  return { facts, chunks };
}

export function buildSplit(state, options = {}) {
  const id = requireArg(options.id, 'id');
  const datasetId = options.datasetId || state.version || GOLDEN_VERSION;
  const seed = Number(options.seed);
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  const ratio = Number(options.validationRatio);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error('validation-ratio must be between 0 and 1');
  const queries = [...state.queries].sort((left, right) => String(left.query_id).localeCompare(String(right.query_id)));
  if (!queries.length) throw new Error('cannot split an empty query table');
  const groups = new Map();
  for (const query of queries) {
    const scenario = scenarioOf(query);
    if (!groups.has(scenario)) groups.set(scenario, []);
    groups.get(scenario).push(query.query_id);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
    sha256(`${seed}:${left}`).localeCompare(sha256(`${seed}:${right}`))
  ));
  const target = Math.round(queries.length * ratio);
  const validation = new Set();
  for (const [, queryIds] of orderedGroups) {
    if (validation.size >= target) break;
    for (const queryId of queryIds) validation.add(queryId);
  }
  const resources = requiredResources(state);
  const validationFacts = new Set();
  const validationChunks = new Set();
  for (const queryId of validation) {
    for (const factId of resources.facts.get(queryId) || []) validationFacts.add(factId);
    for (const chunkId of resources.chunks.get(queryId) || []) validationChunks.add(chunkId);
  }
  const assignments = queries.map((query) => {
    const queryId = query.query_id;
    const split = validation.has(queryId)
      ? 'validation'
      : [...(resources.facts.get(queryId) || [])].some((factId) => validationFacts.has(factId))
        || [...(resources.chunks.get(queryId) || [])].some((chunkId) => validationChunks.has(chunkId))
        ? 'quarantined'
        : 'train';
    return { query_id: queryId, scenario: scenarioOf(query), split };
  });
  const counts = { train: 0, validation: 0, quarantined: 0 };
  for (const assignment of assignments) counts[assignment.split] += 1;
  const leakReport = splitLeakReport(state, assignments);
  const split = {
    schema_version: SPLIT_SCHEMA_VERSION,
    id,
    dataset_id: datasetId,
    method: 'scenario-group-with-quarantine',
    seed,
    validation_ratio: ratio,
    core_digest: coreDigest(state),
    assignments,
    counts,
    leak_report: leakReport,
    split_digest: null,
  };
  split.split_digest = digest(splitInput(split));
  const errors = validateSplit(state, split);
  if (errors.length) throw new Error(`split validation failed: ${errors.join('; ')}`);
  return split;
}

function splitLeakReport(state, assignments) {
  const train = assignments.filter((assignment) => assignment.split === 'train');
  const validation = assignments.filter((assignment) => assignment.split === 'validation');
  const quarantined = assignments.filter((assignment) => assignment.split === 'quarantined');
  const resources = requiredResources(state);
  const factsOf = (rows) => new Set(rows.flatMap((row) => [...(resources.facts.get(row.query_id) || [])]));
  const chunksOf = (rows) => new Set(rows.flatMap((row) => [...(resources.chunks.get(row.query_id) || [])]));
  const trainFacts = factsOf(train);
  const validationFacts = factsOf(validation);
  const quarantinedFacts = factsOf(quarantined);
  const trainChunks = chunksOf(train);
  const validationChunks = chunksOf(validation);
  const quarantinedChunks = chunksOf(quarantined);
  const trainScenarios = new Set(train.map((assignment) => assignment.scenario));
  const validationScenarios = new Set(validation.map((assignment) => assignment.scenario));
  return {
    scenario_cross: [...trainScenarios].filter((scenario) => validationScenarios.has(scenario)).length,
    shared_required_fact_cross: [...trainFacts].filter((factId) => validationFacts.has(factId)).length,
    shared_required_chunk_cross: [...trainChunks].filter((chunkId) => validationChunks.has(chunkId)).length,
    quarantined_fact_overlap: [...quarantinedFacts].filter((factId) => validationFacts.has(factId)).length,
    quarantined_chunk_overlap: [...quarantinedChunks].filter((chunkId) => validationChunks.has(chunkId)).length,
  };
}

function splitInput(split) {
  const { split_digest: _, ...input } = split;
  return input;
}

export function validateSplit(state, split) {
  const errors = [];
  if (split.schema_version !== SPLIT_SCHEMA_VERSION) errors.push(`unsupported schema_version ${split.schema_version}`);
  if (split.dataset_id !== (state.version || GOLDEN_VERSION)) errors.push(`dataset_id mismatch ${split.dataset_id}`);
  if (split.core_digest !== coreDigest(state)) errors.push('core_digest mismatch');
  if (split.split_digest !== digest(splitInput(split))) errors.push('split_digest mismatch');
  const queryIds = new Set(state.queries.map((query) => query.query_id));
  const assignmentIds = new Set();
  const counts = { train: 0, validation: 0, quarantined: 0 };
  for (const assignment of split.assignments || []) {
    if (!queryIds.has(assignment.query_id)) errors.push(`unknown query ${assignment.query_id}`);
    if (assignmentIds.has(assignment.query_id)) errors.push(`duplicate query ${assignment.query_id}`);
    assignmentIds.add(assignment.query_id);
    if (!(assignment.split in counts)) errors.push(`invalid assignment ${assignment.split}`);
    else counts[assignment.split] += 1;
  }
  for (const queryId of queryIds) {
    if (!assignmentIds.has(queryId)) errors.push(`missing query ${queryId}`);
  }
  for (const [name, count] of Object.entries(counts)) {
    if ((split.counts || {})[name] !== count) errors.push(`counts.${name} mismatch`);
  }
  const byId = new Map((split.assignments || []).map((assignment) => [assignment.query_id, assignment]));
  for (const query of state.queries) {
    const assignment = byId.get(query.query_id);
    if (assignment && assignment.scenario !== scenarioOf(query)) {
      errors.push(`scenario mismatch for ${query.query_id}`);
    }
  }
  const computedLeaks = splitLeakReport(state, split.assignments || []);
  for (const [name, value] of Object.entries(computedLeaks)) {
    if ((split.leak_report || {})[name] !== value) errors.push(`leak_report.${name} mismatch`);
  }
  for (const name of ['scenario_cross', 'shared_required_fact_cross', 'shared_required_chunk_cross']) {
    if (computedLeaks[name] !== 0) errors.push(`${name} leak ${computedLeaks[name]}`);
  }
  return errors;
}

export function splitReadiness(governance, split) {
  const state = governance.state;
  const subjects = [];
  const queryFactIds = new Set();
  for (const link of requiredLinkRows(state)) queryFactIds.add(`${link.query_id}|${link.fact_id}`);
  const validationIds = new Set((split?.assignments || []).filter((row) => row.split === 'validation').map((row) => row.query_id));
  for (const key of [...queryFactIds].sort()) {
    const [queryId, factId] = key.split('|');
    if (!validationIds.has(queryId)) continue;
    subjects.push(reviewState(governance.reviewRows, 'query_fact', key, currentQueryFactDigest(state, queryId, factId)));
  }
  for (const fact of state.facts) {
    subjects.push(reviewState(governance.reviewRows, 'fact_mapping', fact.fact_id, currentMappingDigest(state, fact.fact_id)));
  }
  if (split) subjects.push(reviewState(governance.reviewRows, 'split', split.id, digest(splitInput(split))));
  else subjects.push('pending');
  return {
    approved: subjects.filter((status) => status === 'approved').length,
    rejected: subjects.filter((status) => status === 'rejected').length,
    stale: subjects.filter((status) => status === 'stale').length,
    pending: subjects.filter((status) => status === 'pending').length,
    ready: subjects.length > 0 && subjects.every((status) => status === 'approved'),
  };
}

function currentQueryFactDigest(state, queryId, factId) {
  const definition = REVIEW_SUBJECTS.get('query_fact');
  return subjectDigest('query_fact', definition.current(state, { queryId, factId }).digestInput);
}

function currentMappingDigest(state, factId) {
  const definition = REVIEW_SUBJECTS.get('fact_mapping');
  return subjectDigest('fact_mapping', definition.current(state, { factId }).digestInput);
}

export function reviewTargets(governance, type, input) {
  const definition = REVIEW_SUBJECTS.get(type);
  if (!definition) throw new Error(`unknown review subject ${type}`);
  const split = input.splitId ? governance.splitRows.find((row) => row.id === input.splitId) : null;
  const current = definition.current(governance.state, input, split);
  return {
    subject_type: type,
    subject_id: definition.subjectId(input),
    ...current,
    subject_digest: subjectDigest(type, current.digestInput),
  };
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function writeJsonl(file, rows) {
  writeAtomic(file, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');
}

export function saveReview(version, nextRows) {
  writeJsonl(reviewsFile(version), nextRows);
}

export function saveSplit(version, split, options = {}) {
  const file = splitFile(version, split.id);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (digest(existing) !== digest(split)) throw new Error(`split ${split.id} already exists with different content`);
    return { path: file, created: false };
  }
  writeAtomic(file, `${JSON.stringify(split, null, 2)}\n`);
  return { path: file, created: true };
}

export function governanceStatus(version = GOLDEN_VERSION) {
  const governance = loadGovernance(version);
  const counts = { approved: 0, rejected: 0, stale: 0, pending: 0 };
  const addStatus = (status) => { counts[status] += 1; };
  for (const key of [...new Set(requiredLinkRows(governance.state)
    .map((row) => `${row.query_id}|${row.fact_id}`))].sort()) {
    const [queryId, factId] = key.split('|');
    addStatus(reviewState(governance.reviewRows, 'query_fact', key, currentQueryFactDigest(governance.state, queryId, factId)));
  }
  for (const fact of governance.state.facts) {
    addStatus(reviewState(governance.reviewRows, 'fact_mapping', fact.fact_id, currentMappingDigest(governance.state, fact.fact_id)));
  }
  for (const split of governance.splitRows) {
    addStatus(reviewState(governance.reviewRows, 'split', split.id, digest(splitInput(split))));
  }
  return {
    version,
    dataset_id: governance.contract.dataset_id,
    core_digest: coreDigest(governance.state),
    counts,
    splits: governance.splitRows.map((split) => ({
      id: split.id,
      counts: split.counts,
      ready: splitReadiness(governance, split).ready,
    })),
  };
}
