import fs from 'node:fs';

const base = '/Users/mac/work/rag-eval-dataset-m3-deploy';
const reportPath = `${base}/reports/v1.5-ai-qa-recall-jev-c7a0c0b.json`;
const datasetDir = `${base}/datasets/v1.5`;
const outputPath = '/Users/mac/work/rag-eval-dataset/.audit/2026-11-18-ai-qa-ds23-recall.json';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  return fs.readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const facts = readJsonl(`${datasetDir}/facts.jsonl`);
const evidences = readJsonl(`${datasetDir}/evidences.jsonl`);
const evidenceById = new Map(evidences.map((item) => [item.evidence_id, item]));
const factDatasets = new Map(facts.map((fact) => [
  fact.fact_id,
  [...new Set((fact.evidence_ids || [])
    .map((evidenceId) => evidenceById.get(evidenceId)?.dataset_id)
    .filter(Boolean))].sort(),
]));

function factRole(factId) {
  const datasets = factDatasets.get(factId) || [];
  if (datasets.length === 0) return 'UNMAPPED';
  if (datasets.length > 1) return 'MIXED';
  return datasets[0];
}

function isAiQaFact(factId) {
  const datasets = factDatasets.get(factId) || [];
  return datasets.length > 0 && datasets.every((datasetId) => datasetId !== 'DS01');
}

const report = readJson(reportPath).report;
const rows = report.rows.filter((row) => row.recall_cohort);
const eligibleCases = rows.filter((row) => row.required_fact_ids.length > 0
  && row.required_fact_ids.every(isAiQaFact));

const cases = eligibleCases.map((row) => {
  const gold = row.final?.gold;
  const scopedFacts = gold?.facts?.filter((fact) => fact.scorable && isAiQaFact(fact.fact_id)) || [];
  return {
    case_id: row.case_id,
    retrieval_state: row.retrieval_state,
    scored: Boolean(gold?.scorable_fact_count && scopedFacts.length),
    required_fact_count: row.required_fact_ids.length,
    scored_fact_count: scopedFacts.length,
    hit_fact_count: scopedFacts.filter((fact) => fact.hit).length,
    hit_facts: scopedFacts.filter((fact) => fact.hit).map((fact) => ({
      fact_id: fact.fact_id,
      evidence_ids: fact.hit_evidence_ids,
      datasets: factDatasets.get(fact.fact_id),
    })),
  };
});

const scored = cases.filter((item) => item.scored);
const factRoles = new Map();
for (const row of rows) {
  for (const factId of row.required_fact_ids) {
    const role = factRole(factId);
    factRoles.set(role, (factRoles.get(role) || 0) + 1);
  }
}

const excludedHits = rows.flatMap((row) => (row.final?.gold?.facts || [])
  .filter((fact) => fact.scorable && fact.hit && !isAiQaFact(fact.fact_id))
  .map((fact) => ({
    case_id: row.case_id,
    fact_id: fact.fact_id,
    datasets: factDatasets.get(fact.fact_id),
    evidence_ids: fact.hit_evidence_ids,
  })));

const result = {
  generated_at: new Date().toISOString(),
  source_report: reportPath,
  scope: 'AI QA recall excluding DS01 script-library gold facts',
  cohort_cases: rows.length,
  required_fact_roles_all_149: Object.fromEntries([...factRoles.entries()].sort()),
  ai_qa_cases: cases.length,
  ai_qa_cases_scored: scored.length,
  ai_qa_facts_scored: scored.reduce((sum, item) => sum + item.scored_fact_count, 0),
  ai_qa_facts_hit: scored.reduce((sum, item) => sum + item.hit_fact_count, 0),
  ai_qa_micro_recall: scored.reduce((sum, item) => sum + item.hit_fact_count, 0)
    / scored.reduce((sum, item) => sum + item.scored_fact_count, 0),
  ai_qa_macro_recall: scored.reduce((sum, item) => sum + item.hit_fact_count / item.scored_fact_count, 0)
    / scored.length,
  excluded_hits: excludedHits,
  cases: cases.filter((item) => item.hit_fact_count > 0),
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  cohort_cases: result.cohort_cases,
  ai_qa_cases: result.ai_qa_cases,
  ai_qa_cases_scored: result.ai_qa_cases_scored,
  ai_qa_facts_scored: result.ai_qa_facts_scored,
  ai_qa_facts_hit: result.ai_qa_facts_hit,
  micro: result.ai_qa_micro_recall,
  macro: result.ai_qa_macro_recall,
  excluded_hit_facts: result.excluded_hits.length,
}, null, 2));
