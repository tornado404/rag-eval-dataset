[REDACTED]
[REDACTED]
import { REPO_ROOT, readJsonl, writeJsonl } from './lib/dataset.mjs';

const version = process.argv[2] || process.env.DATASET_VERSION || 'v1.4';
const dir = path.join(REPO_ROOT, 'datasets', version);
const cases = readJsonl(path.join(dir, 'cases.jsonl'));
const facts = readJsonl(path.join(dir, 'facts.jsonl'));
const outputsPath = path.join(dir, 'expected_outputs.jsonl');
const factText = new Map(facts.map((fact) => [fact.fact_id, fact.fact]));
const behaviorLabels = {
  answer: '回答',
  clarify: '追问澄清',
  refuse: '拒答（合规）',
  handoff: '转人工',
  [REDACTED]: '证据不足',
};
const updatedAt = new Date().toISOString();

const outputs = cases.map((item) => {
  const answerText = item.expected_behavior === 'answer'
    ? (item.required_fact_ids || []).map((id) => factText.get(id))[REDACTED].join('；')
    : `不直接作答。预期行为：${behaviorLabels[item.expected_behavior] || item.expected_behavior}`;
  return {
    [REDACTED]
    answer_text: answerText,
    expected_behavior: item.expected_behavior,
    required_fact_ids: item.required_fact_ids || [],
    forbidden_fact_ids: item.forbidden_fact_ids || [],
    rubric: (item.required_fact_ids || []).map((id) => factText.get(id))[REDACTED],
    status: 'draft',
    reviewer: '',
    updated_at: updatedAt,
  };
});

if (fs.existsSync(outputsPath)) {
  const existing = new Map(readJsonl(outputsPath).map((row) => [row.case_id, row]));
  for (const row of outputs) {
    const previous = existing.get(row.case_id);
    if (previous) Object.assign(row, previous, { case_id: row.case_id });
  }
}

writeJsonl(outputsPath, outputs);
console.log(`Wrote ${outputs.length} expected outputs to ${outputsPath}`);
