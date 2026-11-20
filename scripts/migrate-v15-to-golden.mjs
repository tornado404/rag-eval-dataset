[REDACTED]
[REDACTED]
import { DATASET_ROOT, datasetDir, readJsonl } from './lib/dataset.mjs';
import { validateState } from './lib/golden.mjs';

const GOLDEN_DIR = path.resolve(process.env.GOLDEN_DATA_DIR || path.join(DATASET_ROOT, 'golden-v1'));
const V15_DIR = datasetDir('v1.5');

function assertEmptyTarget() {
  if (!fs.existsSync(GOLDEN_DIR)) return;
  const entries = fs.readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.jsonl'));
  if (!entries.length) return;
  throw new Error('refusing to overwrite existing golden dataset');
}

function loadV15() {
  const names = [
    'cases.jsonl',
    'facts.jsonl',
    'evidences.jsonl',
    'fact_evidence_relations.jsonl',
    'expected_outputs.jsonl',
    'scenarios.jsonl',
  ];
  const data = {};
  for (const name of names) {
    const file = path.join(V15_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`missing private dataset file ${name}; set DATASET_ROOT to its parent directory`);
    data[name.replace(/\.jsonl$/, '')] = readJsonl(file);
  }
  return data;
}

function unique(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = String(item || '').trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          result.push(id);
        }
      }
      continue;
    }
    const id = String(value || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function evidenceChunkIds(row) {
  return unique(row.ragflow_chunk_ids || row.ragflow_chunk_id || []);
}

function normalizeText(value) {
  return String(value || '').trim().replace(/[\s，。？?！!,.]/g, '').toLowerCase();
}

function normalizeBehavior(value) {
  const behavior = String(value || '').trim().toLowerCase();
  if (behavior === 'answer') return 'answer';
  if (behavior === 'clarify') return 'clarify';
  if (behavior.includes('refuse') || behavior.includes('escalate')) return 'refuse';
  return 'answer';
}

function leadingP0(factIds, factById, scenarioByFact) {
  let best = '';
  let bestSize = -1;
  for (const factId of factIds) {
    const fact = factById.get(factId);
    if (!fact || fact.importance !== 'P0') continue;
    const size = unique(fact.evidence_ids).length;
    if (size > bestSize) {
      best = factId;
      bestSize = size;
    }
  }
  return best || factIds.find((factId) => scenarioByFact.get(factId)) || factIds[0] || '';
}

function buildState(data) {
  const scenarioByFact = new Map();
  const scenarioByCase = new Map();
  for (const scenario of data.scenarios) {
    scenarioByCase.set(scenario.scenario_id, scenario);
  }

  const facts = data.facts.map((row, index) => {
    const statement = String(row.fact || '').trim();
    const candidates = data.cases
      .filter((item) => (item.required_fact_ids || []).includes(row.fact_id))
      .map((item) => scenarioByCase.get(item.scenario_id))
      [REDACTED];
    const firstCandidate = candidates[0]
      || scenarioByCase.get(data.cases.find((item) => (item.optional_fact_ids || []).includes(row.fact_id))?.scenario_id)
      || data.scenarios[index % data.scenarios.length];
    scenarioByFact.set(row.fact_id, firstCandidate);
    const sourceParts = [
      row.source_condition ? `来源条件：${row.source_condition}` : '',
      row.reviewer ? `审核人：${row.reviewer}` : '',
      `v1.5 事实 ${row.fact_id}`,
    ][REDACTED];
    return {
      fact_id: row.fact_id,
      statement,
      topic: firstCandidate.name,
      fact_type: firstCandidate.domain,
      importance: ['P0', 'P1', 'P2'].includes(row.importance) ? row.importance : 'P1',
      source_note: sourceParts.join('；'),
      status: ['draft', 'review', 'approved'].includes(row.status) ? row.status : 'draft',
    };
  });

  const evidenceById = new Map();
  const chunks = [];
  const chunkById = new Map();
  const evidences = data.evidences.map((row) => {
    const documentName = String(row.document_name || '').trim() || row.document_id || row.dataset_id;
    const section = String(row.section || '').trim();
    const sourceText = String(row.source_text || '').trim();
    const evidence = {
      evidence_id: row.evidence_id,
      title: section || documentName,
      excerpt: sourceText,
      status: 'review',
    };
    evidenceById.set(evidence.evidence_id, evidence);
    for (const chunkId of evidenceChunkIds(row)) {
      if (chunkById.has(chunkId)) continue;
      const chunk = {
        chunk_id: chunkId,
        dataset_id: row.dataset_id || '',
        document_id: row.document_id || '',
        document_name: documentName,
        page: String(row.page || ''),
        content: sourceText,
        source: 'ragflow',
      };
      chunkById.set(chunkId, chunk);
      chunks.push(chunk);
    }
    return evidence;
  });

  const expectedByCase = new Map(data.expected_outputs.map((row) => [row.case_id, row]));
  const queries = [];
  const queryFacts = [];
  const seenQueryText = new Map();
  const queryByCase = new Map();

  for (const row of data.cases) {
    const expected = expectedByCase.get(row.case_id) || {};
    const text = String(row.question || '').trim();
    const key = normalizeText(text);
    const duplicateOf = seenQueryText.get(key);
    if (duplicateOf) {
      queryByCase.set(row.case_id, duplicateOf);
      continue;
    }
    const queryId = row.case_id.replace(/^C/, 'Q');
    const query = {
      query_id: queryId,
      text,
      variant_type: 'canonical',
      parent_query_id: '',
      expected_behavior: normalizeBehavior(row.expected_behavior),
      status: 'review',
      notes: `v1.5 题目 ${row.case_id}；场景 ${row.scenario_id}；难度 ${row.difficulty || ''}；优先级 ${row.priority || ''}`,
    };
    queries.push(query);
    seenQueryText.set(key, queryId);
    queryByCase.set(row.case_id, queryId);

    const requirements = new Map();
    for (const factId of unique(expected.required_fact_ids || row.required_fact_ids || [])) requirements.set(factId, 'required');
    for (const factId of unique(row.optional_fact_ids || [])) if (!requirements.has(factId)) requirements.set(factId, 'optional');
    for (const factId of unique(expected.forbidden_fact_ids || row.forbidden_fact_ids || [])) requirements.set(factId, 'forbidden');
    if (![...requirements.values()].includes('required')) {
      const seed = leadingP0([...requirements.keys()], new Map(facts.map((fact) => [fact.fact_id, fact])), scenarioByFact);
      if (seed) requirements.set(seed, 'required');
    }
    for (const [factId, requirement] of requirements) {
      queryFacts.push({ query_id: queryId, fact_id: factId, requirement });
    }
  }

  const factEvidenceByFact = new Map();
  for (const row of data.fact_evidence_relations) {
    const current = factEvidenceByFact.get(row.fact_id) || {
      fact_id: row.fact_id,
      evidence_ids: [],
      operator: 'OR',
    };
    current.evidence_ids = unique(current.evidence_ids.concat(row.evidence_ids))
      .filter((id) => evidenceById.has(id));
    if (row.operator === 'AND') current.operator = 'AND';
    factEvidenceByFact.set(row.fact_id, current);
  }
  const factEvidence = [...factEvidenceByFact.values()];

  const evidenceChunks = data.evidences.map((row) => ({
    evidence_id: row.evidence_id,
    chunk_ids: evidenceChunkIds(row).filter((id) => chunkById.has(id)),
  }));

  const state = {
    version: 'golden-v1',
    queries,
    facts,
    evidences,
    chunks,
    query_facts: queryFacts,
    fact_evidence: factEvidence,
    evidence_chunks: evidenceChunks,
  };
  const errors = validateState(state);
  if (errors.length) throw new Error(`migrated golden state is invalid:\n${errors.slice(0, 50).join('\n')}`);
  return state;
}

function writeState(state) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  const order = ['queries', 'facts', 'evidences', 'chunks', 'query_facts', 'fact_evidence', 'evidence_chunks'];
  for (const name of order) {
    const rows = state[name];
    const content = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
    fs.writeFileSync(path.join(GOLDEN_DIR, `${name}.jsonl`), content);
  }
}

assertEmptyTarget();
const data = loadV15();
const state = buildState(data);
writeState(state);
[REDACTED]
  source_version: 'v1.5',
  target_version: 'golden-v1',
}, null, 2));
