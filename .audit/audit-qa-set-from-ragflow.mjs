import fs from 'node:fs';

const reportPath = '/Users/mac/work/rag-eval-dataset-m3-deploy/reports/v1.5-ai-qa-recall-jev-expansion-partial.json';
const casesPath = '/Users/mac/work/rag-eval-dataset-m3-deploy/datasets/v1.5/cases.jsonl';
const outputsPath = '/Users/mac/work/rag-eval-dataset-m3-deploy/datasets/v1.5/expected_outputs.jsonl';
const factsPath = '/Users/mac/work/rag-eval-dataset-m3-deploy/datasets/v1.5/facts.jsonl';

const readJsonl = (file) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const normalize = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const cases = readJsonl(casesPath);
const outputs = readJsonl(outputsPath);
const facts = readJsonl(factsPath);

const caseById = new Map(cases.map((row) => [row.case_id, row]));
const outputById = new Map(outputs.map((row) => [row.case_id, row]));
const factById = new Map(facts.map((row) => [row.fact_id, row.fact]));

const questionMatches = [];
const answerMatches = [];
const factConcatenated = [];

for (const row of report.rows) {
  const sourceCase = caseById.get(row.case_id);
  const output = outputById.get(row.case_id);
  if (!sourceCase || !output) {
    questionMatches.push({ case_id: row.case_id, match: false, reason: 'case_not_found' });
    continue;
  }

  const questionMatch = normalize(sourceCase.question) === normalize(row.question);
  questionMatches.push({ case_id: row.case_id, match: questionMatch });

  if (output.expected_behavior !== 'answer') continue;
  const factsText = (output.required_fact_ids || [])
    .map((factId) => factById.get(factId))
    .filter(Boolean)
    .join('；');
  if (normalize(output.answer_text) === normalize(factsText)) {
    factConcatenated.push(row.case_id);
  }
}

const configuredDatasetIds = [
  '65d643aade4011f1b1c6633075e8035e',
  '34714b66de4011f1b1c6633075e8035e',
  '3ac8e8d6dce511f1b1c6633075e8035e',
  '73843970dc4811f182a97bfda9b37d41',
  '7131ca20dc4811f182a97bfda9b37d41',
  '6fc656c4dc4811f182a97bfda9b37d41',
  '521f85b2dea211f1b1c6633075e8035e',
];
const backendDatasetIds = [
  '6fc656c4dc4811f1b1c6633075e8035e',
  '7131ca20dc4811f182a97bfda9b37d41',
  '73843970dc4811f182a97bfda9b37d41',
];

const summary = {
  report_rows: report.rows.length,
  report_questions_exact_match_local_cases: questionMatches.filter((row) => row.match).length,
  report_questions_missing_local_case: questionMatches.filter((row) => !row.match).length,
  answer_outputs_exact_facts_concatenation: factConcatenated.length,
  answer_outputs_total: outputs.filter((row) => row.expected_behavior === 'answer').length,
  dataset_ids_user_supplied: configuredDatasetIds,
  dataset_ids_backend_runtime: backendDatasetIds,
  dataset_ids_in_user_but_not_backend: configuredDatasetIds.filter((id) => !backendDatasetIds.includes(id)),
  dataset_ids_in_backend_and_user: backendDatasetIds.filter((id) => configuredDatasetIds.includes(id)),
  exact_qa_answer_matches_in_exported_qa_dataset: answerMatches.length,
};

console.log(JSON.stringify(summary, null, 2));
