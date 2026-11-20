const DECISION_ACTIONS = ['answer', 'clarify', '[REDACTED]', 'escalate_human', '[REDACTED]', 'refuse_domain', 'other'];

function fraction(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function confusionKey(expected, observed) {
  return `${expected}->${observed}`;
}

export function scoreDecisionMetrics(entries) {
  const rows = entries.filter((entry) => entry.scoreable);
  const observedRows = rows.filter((entry) => entry.observed_action);
  const confusionCounts = new Map();
  for (const row of observedRows) {
    const key = confusionKey(row.expected_action, row.observed_action);
    confusionCounts.set(key, (confusionCounts.get(key) || 0) + 1);
  }
  const expectedActions = [...new Set(rows.map((row) => row.expected_action))].sort();
  const observedActions = [...new Set([...expectedActions, ...observedRows.map((row) => row.observed_action)])]
    .sort((left, right) => DECISION_ACTIONS.indexOf(left) - DECISION_ACTIONS.indexOf(right));
  const confusion = [];
  for (const expected of expectedActions) {
    for (const observed of observedActions) {
      confusion.push({ expected, observed, count: confusionCounts.get(confusionKey(expected, observed)) || 0 });
    }
  }
  const correct = observedRows.filter((row) => row.expected_action === row.observed_action).length;
  const perClass = expectedActions.map((action) => {
    const support = rows.filter((row) => row.expected_action === action).length;
    const truePositive = observedRows.filter((row) => row.expected_action === action && row.observed_action === action).length;
    const falsePositive = observedRows.filter((row) => row.expected_action !== action && row.observed_action === action).length;
    const falseNegative = observedRows.filter((row) => row.expected_action === action && row.observed_action !== action).length;
    const precision = fraction(truePositive, truePositive + falsePositive);
    const recall = fraction(truePositive, truePositive + falseNegative);
    return {
      action,
      support,
      true_positive: truePositive,
      false_positive: falsePositive,
      false_negative: falseNegative,
      precision,
      recall,
      f1: precision !== null && recall !== null && precision + recall > 0
        ? 2 * precision * recall / (precision + recall)
        : 0,
    };
  });
  const scoredF1 = perClass.filter((row) => row.support > 0);
  const answerRows = rows.filter((row) => row.expected_action === 'answer');
  const nonAnswerRows = rows.filter((row) => row.expected_action !== 'answer');
  const strictFalseRefusalActions = new Set(['refuse_domain', '[REDACTED]', '[REDACTED]']);
  const broadFalseRefusalActions = new Set([...strictFalseRefusalActions, 'escalate_human', 'clarify', 'other']);
  const strictFalseRefusal = answerRows.filter((row) => strictFalseRefusalActions.has(row.observed_action)).length;
  const broadFalseRefusal = answerRows.filter((row) => broadFalseRefusalActions.has(row.observed_action)).length;
  const falseAnswer = nonAnswerRows.filter((row) => row.observed_action === 'answer').length;
  return {
    cohort_cases: entries.length,
    scoreable_cases: rows.length,
    unscored_cases: entries.length - rows.length,
    observed_cases: observedRows.length,
    observed_coverage: {
      observed: observedRows.length,
      cohort: entries.length,
      rate: fraction(observedRows.length, entries.length),
    },
    scoreable_observation_coverage: {
      observed: observedRows.length,
      cohort: rows.length,
      rate: fraction(observedRows.length, rows.length),
    },
    provisional: true,
    accuracy: fraction(correct, observedRows.length),
    confusion,
    per_class: perClass,
    macro_f1: scoredF1.length
      ? scoredF1.reduce((sum, row) => sum + row.f1, 0) / scoredF1.length
      : null,
    strict_false_refusal: {
      cases: strictFalseRefusal,
      denominator: answerRows.length,
      rate: fraction(strictFalseRefusal, answerRows.length),
      actions: [...strictFalseRefusalActions],
    },
    broad_false_refusal: {
      cases: broadFalseRefusal,
      denominator: answerRows.length,
      rate: fraction(broadFalseRefusal, answerRows.length),
      actions: [...broadFalseRefusalActions],
    },
    false_answer: { cases: falseAnswer, denominator: nonAnswerRows.length, rate: fraction(falseAnswer, nonAnswerRows.length) },
  };
}

function countTraceValues(rows, key) {
  const counts = {};
  for (const row of rows) {
    const raw = row.decision_trace?.[key];
    const value = key === 'fallback_category' ? (raw || 'none') : (raw || 'unavailable');
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

export function aggregateDecisionAttribution(rows) {
  const traces = (rows || []).filter((row) => row.decision_trace);
  const providerCounts = countTraceValues(traces, 'source');
  const configCounts = countTraceValues(traces, 'fingerprint');
  const familyCounts = countTraceValues(traces, 'config_family');
  const preferenceCounts = countTraceValues(traces, 'config_preference');
  const fallbackCounts = countTraceValues(traces, 'fallback_category');
  const modelCounts = countTraceValues(traces, 'model_id');
  return {
    traced_cases: traces.length,
    provider_counts: providerCounts,
    model_counts: modelCounts,
    config_family_counts: familyCounts,
    config_preference_counts: preferenceCounts,
    fingerprint_counts: configCounts,
    fallback_counts: fallbackCounts,
    mixed_provider: Object.keys(providerCounts).length > 1,
    mixed_config: Object.keys(configCounts).length > 1
      || Object.keys(familyCounts).length > 1
      || Object.keys(preferenceCounts).length > 1,
  };
}

function qaRecallSummary(rows, pick) {
  const withResult = rows.map(pick).filter(Boolean);
  const scored = withResult.filter((entry) => entry.gold?.scorable_fact_count > 0);
  const factsScored = scored.reduce((sum, entry) => sum + entry.gold.scorable_fact_count, 0);
  const factsHit = scored.reduce((sum, entry) => sum + entry.gold.hit_fact_count, 0);
  const casesHit = scored.filter((entry) => entry.gold.hit_fact_count > 0).length;
  const recalls = scored.map((entry) => entry.gold.recall_at_k).filter(Number.isFinite);
  const ks = scored.map((entry) => entry.gold.k).filter(Number.isFinite);
  return {
    k_min: ks.length ? Math.min(...ks) : null,
    k_max: ks.length ? Math.max(...ks) : null,
    cases_with_results: withResult.length,
    cases_scored: scored.length,
    cases_unscorable_gold: withResult.length - scored.length,
    cases_with_gold_hit: casesHit,
    gold_facts_scored: factsScored,
    gold_facts_hit: factsHit,
    hit_at_k: fraction(casesHit, scored.length),
    recall_at_k: recalls.length ? recalls.reduce((sum, value) => sum + value, 0) / recalls.length : null,
    micro_fact_recall_at_k: fraction(factsHit, factsScored),
  };
}

export function scoreRecallMetrics(records) {
  const cohort = records.filter((row) => row.recall_cohort);
  const states = {
    not_retrieved: 0,
    empty_candidate_observed: 0,
    unavailable: 0,
    scored: 0,
  };
  for (const row of cohort) {
    if (Object.prototype.hasOwnProperty.call(states, row.retrieval_state)) states[row.retrieval_state] += 1;
  }
  const attempted = cohort.filter((row) => row.retrieval_state !== 'not_retrieved').length;
  const observed = cohort.filter((row) => row.observation).length;
  const chunkObserved = cohort.filter((row) => row.observation?.chunk_metrics_available).length;
  const requiredFacts = cohort.reduce((sum, row) => sum + new Set(row.required_fact_ids || []).size, 0);
  const finalSummary = qaRecallSummary(cohort, (row) => row.final);
  const rawSummary = qaRecallSummary(cohort, (row) => row.raw_ragflow);
  return {
    cohort_cases: cohort.length,
    retrieval_attempted: { cases: attempted, denominator: cohort.length, rate: fraction(attempted, cohort.length) },
    observation_coverage: { cases: observed, denominator: cohort.length, rate: fraction(observed, cohort.length) },
    chunk_observation_coverage: { cases: chunkObserved, denominator: cohort.length, rate: fraction(chunkObserved, cohort.length) },
    states,
    gold_facts_required: requiredFacts,
    final_grounding: {
      ...finalSummary,
      headline: '[REDACTED]',
      numerator: { gold_facts_hit: finalSummary.gold_facts_hit, cases_hit: finalSummary.cases_with_gold_hit },
      denominator: { gold_facts_scored: finalSummary.gold_facts_scored, cases_scored: finalSummary.cases_scored },
    },
    ragflow_candidates_at_12: {
      ...rawSummary,
      headline: '[REDACTED]',
      numerator: { gold_facts_hit: rawSummary.gold_facts_hit, cases_hit: rawSummary.cases_with_gold_hit },
      denominator: { gold_facts_scored: rawSummary.gold_facts_scored, cases_scored: rawSummary.cases_scored },
    },
  };
}

function delta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Number((right - left).toFixed(6));
}

export function compareReports(base, other) {
  const reasons = [];
  if (base?.dataset?.digest !== other?.dataset?.digest) reasons.push('dataset digest');
  if (base?.dataset?.action_map?.digest !== other?.dataset?.action_map?.digest) reasons.push('action map digest');
  if (base?.metric_schema_version !== other?.metric_schema_version) reasons.push('metric schema');
  if (base?.report_schema_version !== other?.report_schema_version) reasons.push('report schema');
  if (base?.evaluation?.top_k !== other?.evaluation?.top_k) reasons.push('top K');
  const baseCohorts = base?.evaluation?.cohorts || {};
  const otherCohorts = other?.evaluation?.cohorts || {};
  if (baseCohorts.decision !== otherCohorts.decision || baseCohorts.recall !== otherCohorts.recall) reasons.push('cohort');

  const confounders = [];
  if (base?.run?.build_sha !== other?.run?.build_sha) confounders.push('build SHA');
  if (base?.run?.decision?.mode !== other?.run?.decision?.mode) confounders.push('decision mode');
  if (base?.run?.corpus_snapshot !== other?.run?.corpus_snapshot) confounders.push('corpus snapshot');
  if (base?.run?.config?.fingerprint !== other?.run?.config?.fingerprint) confounders.push('config fingerprint');
  if (base?.dataset?.label_status !== other?.dataset?.label_status) confounders.push('label status');
  if (base?.run?.decision?.mixed_provider || other?.run?.decision?.mixed_provider) confounders.push('mixed provider');
  if (base?.run?.decision?.mixed_config || other?.run?.decision?.mixed_config) confounders.push('mixed config');

  const compatible = reasons.length === 0 && base?.status === 'complete' && other?.status === 'complete';
  const baseRows = new Map((base?.rows || []).map((row) => [row.case_id, row]));
  const recallChanges = compatible
    ? (other?.rows || [])
      .filter((row) => row.recall_cohort)
      .map((row) => {
        const baseline = baseRows.get(row.case_id);
        if (!baseline) return null;
        const baseFinal = baseline.final?.gold || {};
        const otherFinal = row.final?.gold || {};
        const baseRaw = baseline.raw_ragflow?.gold || {};
        const otherRaw = row.raw_ragflow?.gold || {};
        return {
          case_id: row.case_id,
          base: {
            retrieval_state: baseline.retrieval_state || null,
            final_hit_fact_count: baseFinal.hit_fact_count ?? null,
            raw_hit_fact_count: baseRaw.hit_fact_count ?? null,
          },
          other: {
            retrieval_state: row.retrieval_state || null,
            final_hit_fact_count: otherFinal.hit_fact_count ?? null,
            raw_hit_fact_count: otherRaw.hit_fact_count ?? null,
          },
          final_hit_delta: Number.isFinite(baseFinal.hit_fact_count) && Number.isFinite(otherFinal.hit_fact_count)
            ? otherFinal.hit_fact_count - baseFinal.hit_fact_count
            : null,
          raw_hit_delta: Number.isFinite(baseRaw.hit_fact_count) && Number.isFinite(otherRaw.hit_fact_count)
            ? otherRaw.hit_fact_count - baseRaw.hit_fact_count
            : null,
        };
      })
      .filter(Boolean)
      .filter((change) => change.base.retrieval_state !== change.other.retrieval_state
        || change.final_hit_delta !== 0
        || change.raw_hit_delta !== 0)
    : [];
  return {
    compatible,
    reasons,
    confounders,
    recall_changes: recallChanges,
    deltas: compatible ? {
      decision_accuracy: delta(base.summary?.decision?.accuracy, other.summary?.decision?.accuracy),
      decision_macro_f1: delta(base.summary?.decision?.macro_f1, other.summary?.decision?.macro_f1),
      final_recall_at_k: delta(base.summary?.final_grounding?.recall_at_k, other.summary?.final_grounding?.recall_at_k),
      candidate_recall_at_k: delta(base.summary?.ragflow_candidates_at_12?.recall_at_k, other.summary?.ragflow_candidates_at_12?.recall_at_k),
      final_gold_facts_hit: delta(base.summary?.final_grounding?.gold_facts_hit, other.summary?.final_grounding?.gold_facts_hit),
      final_cases_scored: delta(base.summary?.final_grounding?.cases_scored, other.summary?.final_grounding?.cases_scored),
    } : {
      decision_accuracy: null,
      decision_macro_f1: null,
      final_recall_at_k: null,
      candidate_recall_at_k: null,
      final_gold_facts_hit: null,
      final_cases_scored: null,
    },
  };
}
