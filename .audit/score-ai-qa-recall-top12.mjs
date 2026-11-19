import fs from 'node:fs';

const [reportPath, outputPath] = process.argv.slice(2);
if (!reportPath || !outputPath) {
  console.error('usage: node score-ai-qa-recall-top12.mjs <report.json> <output.json>');
  process.exit(2);
}

const base = '/Users/mac/work/rag-eval-dataset-m3-deploy';
const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const readJsonl = (path) => fs.readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const datasetDir = `${base}/datasets/v1.5`;
const facts = readJsonl(`${datasetDir}/facts.jsonl`);
const evidences = readJsonl(`${datasetDir}/evidences.jsonl`);
const evidenceById = new Map(evidences.map((item) => [item.evidence_id, item]));
const relations = readJsonl(`${datasetDir}/fact_evidence_relations.jsonl`);
const factDatasets = new Map(facts.map((fact) => [
  fact.fact_id,
  [...new Set((fact.evidence_ids || [])
    .map((evidenceId) => evidenceById.get(evidenceId)?.dataset_id)
    .filter(Boolean))].sort(),
]));

function isAiQaFact(factId) {
  const datasets = factDatasets.get(factId) || [];
  return datasets.length > 0 && datasets.every((datasetId) => datasetId !== 'DS01');
}

function chunkIdsForEvidence(evidenceId) {
  const evidence = evidenceById.get(evidenceId);
  return [...new Set([
    ...(Array.isArray(evidence?.ragflow_chunk_ids) ? evidence.ragflow_chunk_ids : []),
    evidence?.ragflow_chunk_id,
  ].filter(Boolean))];
}

const groupsByFact = new Map();
for (const relation of relations) {
  const groups = groupsByFact.get(relation.fact_id) || [];
  groups.push({
    operator: String(relation.operator || '').toUpperCase(),
    evidence_ids: relation.evidence_ids || [],
    chunk_id_sets: (relation.evidence_ids || []).map(chunkIdsForEvidence),
  });
  groupsByFact.set(relation.fact_id, groups);
}

function assessFact(factId, retrievedIds) {
  const retrieved = new Set(retrievedIds);
  const validGroups = (groupsByFact.get(factId) || []).filter((group) => {
    if (group.operator === 'OR') return group.chunk_id_sets.some((ids) => ids.length > 0);
    if (group.operator === 'AND') return group.chunk_id_sets.length > 0 && group.chunk_id_sets.every((ids) => ids.length > 0);
    return false;
  });
  if (!validGroups.length) return { scorable: false, hit: false, hit_evidence_ids: [] };
  const matchedGroup = validGroups.find((group) => {
    const hits = group.chunk_id_sets.map((ids) => ids.some((id) => retrieved.has(id)));
    return group.operator === 'OR' ? hits.some(Boolean) : hits.every(Boolean);
  });
  return {
    scorable: true,
    hit: Boolean(matchedGroup),
    hit_evidence_ids: matchedGroup
      ? matchedGroup.evidence_ids.filter((_, index) => matchedGroup.chunk_id_sets[index].some((id) => retrieved.has(id)))
      : [],
  };
}

const payload = readJson(reportPath);
const report = payload.report || payload;
const recallRows = report.rows.filter((row) => row.recall_cohort);
const cases = recallRows.map((row) => {
  const candidateIds = row.raw_ragflow?.ids || row.observation?.ragflow_candidate_chunk_ids_at_12 || [];
  const relevantFacts = row.required_fact_ids.filter(isAiQaFact);
  const facts = relevantFacts.map((factId) => ({ fact_id: factId, ...assessFact(factId, candidateIds) }));
  const scorableFacts = facts.filter((fact) => fact.scorable);
  return {
    case_id: row.case_id,
    retrieval_state: row.retrieval_state,
    error: row.error || null,
    candidate_count: candidateIds.length,
    scored_fact_count: scorableFacts.length,
    hit_fact_count: scorableFacts.filter((fact) => fact.hit).length,
    hits: scorableFacts.filter((fact) => fact.hit),
  };
});

const scoredCases = cases.filter((item) => item.scored_fact_count > 0 && item.retrieval_state === 'scored');
const factTotal = scoredCases.reduce((sum, item) => sum + item.scored_fact_count, 0);
const factHits = scoredCases.reduce((sum, item) => sum + item.hit_fact_count, 0);
const result = {
  generated_at: new Date().toISOString(),
  source_report: reportPath,
  scope: 'AI QA Gold recall over merged RAGFlow Top-12 candidate chunks, excluding DS01-only gold facts',
  cohort_cases: recallRows.length,
  ai_qa_cases_total: cases.length,
  ai_qa_cases_scored: scoredCases.length,
  ai_qa_facts_scored: factTotal,
  ai_qa_facts_hit: factHits,
  ai_qa_micro_recall_top12: factTotal ? factHits / factTotal : null,
  ai_qa_macro_recall_top12: scoredCases.length
    ? scoredCases.reduce((sum, item) => sum + item.hit_fact_count / item.scored_fact_count, 0) / scoredCases.length
    : null,
  ai_qa_case_hit_rate_top12: scoredCases.length
    ? scoredCases.filter((item) => item.hit_fact_count > 0).length / scoredCases.length
    : null,
  excluded_cases: cases.filter((item) => item.retrieval_state !== 'scored' || !item.scored_fact_count),
  hit_cases: cases.filter((item) => item.hit_fact_count > 0),
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  cohort_cases: result.cohort_cases,
  ai_qa_cases_scored: result.ai_qa_cases_scored,
  ai_qa_facts_scored: result.ai_qa_facts_scored,
  ai_qa_facts_hit: result.ai_qa_facts_hit,
  micro_top12: result.ai_qa_micro_recall_top12,
  macro_top12: result.ai_qa_macro_recall_top12,
  case_hit_rate_top12: result.ai_qa_case_hit_rate_top12,
}, null, 2));
