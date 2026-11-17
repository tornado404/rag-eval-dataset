[REDACTED]
[REDACTED]
import { REPO_ROOT, readJsonl } from './lib/dataset.mjs';

function usage() {
  console.error('Usage: node scripts/compute_hit.mjs <details_mode_a.jsonl> [--top-k 12] [--out file.json]');
  [REDACTED]
}

const detailPath = process.argv[2];
if (!detailPath) usage();

const topKArg = process.argv.indexOf('--top-k');
const topK = topKArg >= 0 ? Number(process.argv[topKArg + 1]) : 12;
const outArg = process.argv.indexOf('--out');
const outPath = outArg >= 0 ? process.argv[outArg + 1] : null;
const datasetArg = process.argv.indexOf('--dataset');
const datasetVersion = datasetArg >= 0 ? process.argv[datasetArg + 1] : process.env.DATASET_VERSION;

let expectedBehaviors = null;
if (datasetVersion) {
  const casesPath = path.join(REPO_ROOT, 'datasets', datasetVersion, 'cases.jsonl');
  expectedBehaviors = new Map(readJsonl(casesPath).map((row) => [row.case_id, row.expected_behavior]));
}

if (!Number.isInteger(topK) || topK < 1) usage();

const rows = readJsonl(path.resolve(detailPath));
const answerRows = rows.filter((row) => {
  const behavior = expectedBehaviors?.get(row.case_id) || row.expected_behavior;
  return behavior === 'answer' && row.fact_recall !== undefined;
});
const macroRecall = answerRows.length
  ? answerRows.reduce((sum, row) => sum + Number(row.fact_recall || 0), 0) / answerRows.length
  : null;
const anyHit = answerRows.filter((row) => Number(row.required_covered || 0) > 0).length;
const strictHit = answerRows.filter((row) => Number(row.required_covered || 0) === Number(row.required_total || 0)).length;

[REDACTED]
  top_k: topK,
  answer_cases: answerRows.length,
  macro_fact_recall: macroRecall === null ? null : Number(macroRecall.toFixed(6)),
  any_hit_at_k: answerRows.length ? Number((anyHit / answerRows.length).toFixed(6)) : null,
  strict_hit_at_k: answerRows.length ? Number((strictHit / answerRows.length).toFixed(6)) : null,
  any_hit_cases: anyHit,
  strict_hit_cases: strictHit,
  note: 'Recall/HIT semantics depend on the retrieval matcher used to produce details_mode_a.jsonl.',
};

const text = JSON.stringify(summary, null, 2) + '\n';
if (outPath) {
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, text, 'utf8');
} else {
  process.stdout.write(text);
}
