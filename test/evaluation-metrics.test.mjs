import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDecisionAttribution,
  compareReports,
  scoreDecisionMetrics,
  scoreRecallMetrics,
} from '../editor/evaluator.mjs';

const scored = (caseId, expectedAction, observedAction) => ({
  case_id: caseId,
  expected_action: expectedAction,
  observed_action: observedAction,
  scoreable: true,
});

test('decision scoring uses scoreable cases and separates false refusal from false answer', () => {
  const result = scoreDecisionMetrics([
    scored('C00001', 'answer', 'answer'),
    scored('C00002', 'answer', 'refuse_domain'),
    scored('C00003', 'answer', 'clarify'),
    scored('C00004', '[REDACTED]', '[REDACTED]'),
    scored('C00005', '[REDACTED]', 'answer'),
    { case_id: 'C00079', expected_action: null, observed_action: 'answer', scoreable: false },
    { case_id: 'C00080', expected_action: 'answer', observed_action: null, scoreable: true },
  ]);

  assert.equal(result.scoreable_cases, 6);
  assert.equal(result.observed_cases, 5);
  assert.equal(result.accuracy, 2 / 5);
  assert.equal(result.strict_false_refusal.cases, 1);
  assert.equal(result.strict_false_refusal.denominator, 4);
  assert.equal(result.broad_false_refusal.cases, 2);
  assert.equal(result.broad_false_refusal.denominator, 4);
  assert.equal(result.false_answer.cases, 1);
  assert.equal(result.false_answer.denominator, 2);
  assert.equal(result.confusion.find((row) => row.expected === 'answer' && row.observed === 'refuse_domain').count, 1);
  assert.equal(result.per_class.find((row) => row.action === '[REDACTED]').support, 2);
  assert.equal(result.observed_coverage.observed, 5);
  assert.equal(result.observed_coverage.cohort, 7);
});

test('recall scoring rejects not-retrieved cases and missing observations instead of counting misses', () => {
  const result = scoreRecallMetrics([
    {
      case_id: 'C00001',
      recall_cohort: true,
      retrieval_state: 'scored',
      required_fact_ids: ['F00001'],
      final: { gold: { scorable_fact_count: 1, hit_fact_count: 1, k: 3 } },
      raw_ragflow: { gold: { scorable_fact_count: 1, hit_fact_count: 0, k: 12 } },
    },
    {
      case_id: 'C00002',
      recall_cohort: true,
      retrieval_state: 'not_retrieved',
      required_fact_ids: ['F00002'],
      final: null,
      raw_ragflow: null,
    },
    {
      case_id: 'C00003',
      recall_cohort: true,
      retrieval_state: 'unavailable',
      required_fact_ids: ['F00003'],
      final: null,
      raw_ragflow: null,
    },
    { case_id: 'C00052', recall_cohort: false, retrieval_state: 'not_retrieved' },
  ]);

  assert.equal(result.cohort_cases, 3);
  assert.equal(result.retrieval_attempted.cases, 2);
  assert.equal(result.states.not_retrieved, 1);
  assert.equal(result.states.unavailable, 1);
  assert.equal(result.final_grounding.cases_scored, 1);
  assert.equal(result.final_grounding.gold_facts_hit, 1);
  assert.equal(result.ragflow_candidates_at_12.cases_scored, 1);
});

function report(overrides = {}) {
  return {
    report_schema_version: '[REDACTED]',
    status: 'complete',
    dataset: { digest: 'dataset-a', action_map: { digest: 'actions-a' } },
    metric_schema_version: '[REDACTED]',
    evaluation: { top_k: 12, cohorts: { decision: 163, recall: 149 } },
    run: { build_sha: 'build-a', decision: { mode: 'enforce' } },
    summary: { decision: { accuracy: 0.8 }, final_grounding: { recall_at_k: 0.1 } },
    ...overrides,
  };
}

test('report comparison blocks headline deltas when hard compatibility keys differ', () => {
  const base = report();
  const incompatible = report({ dataset: { digest: 'dataset-b', action_map: { digest: 'actions-b' } } });
  const compared = compareReports(base, incompatible);

  assert.equal(compared.compatible, false);
  assert.deepEqual(compared.reasons, ['dataset digest', 'action map digest']);
  assert.equal(compared.deltas.decision_accuracy, null);
});

test('report comparison shows confounders without blocking compatible deltas', () => {
  const base = report();
  const other = report({ run: { build_sha: 'build-b', decision: { mode: 'shadow' } } });
  const compared = compareReports(base, other);

  assert.equal(compared.compatible, true);
  assert.deepEqual(compared.confounders, ['build SHA', 'decision mode']);
  assert.equal(compared.deltas.decision_accuracy, 0);
  assert.equal(compared.deltas.final_recall_at_k, 0);
});

test('mixed provider and config are comparability confounders with per-run counts', () => {
  const base = report({
    run: { build_sha: 'build-a', decision: { mode: 'enforce' } },
    rows: [
      { case_id: 'C00001', decision_trace: { source: 'jev', model_id: 'jev-v1', config_family: 'auto', config_preference: 'jev', fingerprint: 'fp-a', fallback_category: 'none' } },
      { case_id: 'C00002', decision_trace: { source: 'jev', model_id: 'jev-v1', config_family: 'auto', config_preference: 'jev', fingerprint: 'fp-a', fallback_category: 'none' } },
    ],
  });
  const mixedProvider = report({
    run: { build_sha: 'build-a', decision: { mode: 'enforce' } },
    rows: [
      { case_id: 'C00001', decision_trace: { source: 'jev', model_id: 'jev-v1', config_family: 'auto', config_preference: 'jev', fingerprint: 'fp-a', fallback_category: 'none' } },
      { case_id: 'C00002', decision_trace: { source: 'qwen', model_id: 'qwen-v2', config_family: 'auto', config_preference: 'jev', fingerprint: 'fp-a', fallback_category: 'primary_unavailable' } },
    ],
  });
  const mixedConfig = report({
    run: { build_sha: 'build-a', decision: { mode: 'enforce' } },
    rows: [
      { case_id: 'C00001', decision_trace: { source: 'jev', model_id: 'jev-v1', config_family: 'auto', config_preference: 'jev', fingerprint: 'fp-a', fallback_category: 'none' } },
      { case_id: 'C00002', decision_trace: { source: 'jev', model_id: 'jev-v1', config_family: 'manual', config_preference: 'jev', fingerprint: 'fp-b', fallback_category: 'none' } },
    ],
  });

  const baseAttribution = aggregateDecisionAttribution(base.rows);
  const mixedProviderAttribution = aggregateDecisionAttribution(mixedProvider.rows);
  const mixedConfigAttribution = aggregateDecisionAttribution(mixedConfig.rows);

  assert.deepEqual(baseAttribution, {
    traced_cases: 2,
    provider_counts: { jev: 2 },
    model_counts: { 'jev-v1': 2 },
    config_family_counts: { auto: 2 },
    config_preference_counts: { jev: 2 },
    fingerprint_counts: { 'fp-a': 2 },
    fallback_counts: { none: 2 },
    mixed_provider: false,
    mixed_config: false,
  });
  assert.equal(mixedProviderAttribution.mixed_provider, true);
  assert.deepEqual(mixedProviderAttribution.provider_counts, { jev: 1, qwen: 1 });
  assert.deepEqual(mixedProviderAttribution.fallback_counts, { none: 1, primary_unavailable: 1 });
  assert.equal(mixedConfigAttribution.mixed_config, true);

  const compared = compareReports(
    { ...base, run: { ...base.run, decision: { ...base.run.decision, ...baseAttribution } } },
    { ...mixedProvider, run: { ...mixedProvider.run, decision: { ...mixedProvider.run.decision, ...mixedProviderAttribution } } },
  );
  assert.equal(compared.compatible, true);
  assert.ok(compared.confounders.includes('mixed provider'));
});

test('corpus coverage summary exposes gold and evidence-row coverage', () => {
  const result = scoreRecallMetrics([]);

  assert.deepEqual(result.corpus_coverage.gold_datasets, {
    covered: 3,
    total_online: 7,
    ids: ['DS01', 'DS02', 'DS03'],
  });
  assert.deepEqual(result.corpus_coverage.evidence_rows, { mapped: 479, total: 482, rate: 479 / 482 });
  assert.deepEqual(result.corpus_coverage.required_facts, { scorable: 394, total: 394, rate: 1 });
  assert.deepEqual(result.corpus_coverage.unmapped_evidence_ids, ['E00096', 'E00097', 'E00466']);
});

test('report comparison includes coverage and per-case recall changes', () => {
  const base = report({
    rows: [{ case_id: 'C00001', recall_cohort: true, retrieval_state: 'scored', final: { gold: { scorable_fact_count: 2, hit_fact_count: 0, k: 2, recall_at_k: 0 } }, raw_ragflow: { gold: { scorable_fact_count: 2, hit_fact_count: 0, k: 12, recall_at_k: 0 } } }],
    summary: {
      decision: { accuracy: 0.8 },
      corpus_coverage: { evidence_rows: { mapped: 479, total: 482 } },
      final_grounding: { recall_at_k: 0.1, cases_scored: 1, gold_facts_hit: 0, gold_facts_scored: 2 },
      ragflow_candidates_at_12: { recall_at_k: 0.2, cases_scored: 1, gold_facts_hit: 0, gold_facts_scored: 2 },
    },
  });
  const other = report({
    rows: [{ case_id: 'C00001', recall_cohort: true, retrieval_state: 'scored', final: { gold: { scorable_fact_count: 2, hit_fact_count: 1, k: 2, recall_at_k: 0.5 } }, raw_ragflow: { gold: { scorable_fact_count: 2, hit_fact_count: 1, k: 12, recall_at_k: 0.5 } } }],
    summary: {
      decision: { accuracy: 0.8 },
      corpus_coverage: { evidence_rows: { mapped: 482, total: 482 } },
      final_grounding: { recall_at_k: 0.25, cases_scored: 2, gold_facts_hit: 1, gold_facts_scored: 4 },
      ragflow_candidates_at_12: { recall_at_k: 0.5, cases_scored: 2, gold_facts_hit: 1, gold_facts_scored: 4 },
    },
  });

  const compared = compareReports(base, other);
  assert.equal(compared.deltas.final_gold_facts_hit, 1);
  assert.equal(compared.deltas.final_cases_scored, 1);
  assert.equal(compared.deltas.mapped_evidence_rows, 3);
  assert.deepEqual(compared.recall_changes, [{
    case_id: 'C00001',
    base: { retrieval_state: 'scored', final_hit_fact_count: 0, raw_hit_fact_count: 0 },
    other: { retrieval_state: 'scored', final_hit_fact_count: 1, raw_hit_fact_count: 1 },
    final_hit_delta: 1,
    raw_hit_delta: 1,
  }]);
});
