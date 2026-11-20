import fs from 'node:fs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node validate-ai-qa-recall-report.mjs <report.json>');
  process.exit(2);
}

const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const report = payload.report || payload;
const rows = report.rows || [];
const recallRows = rows.filter((row) => row.recall_cohort);
const traces = rows.map((row) => row.decision_trace || {});
const observedTraces = traces.filter((trace) => trace.status !== 'unavailable');
const sourceCounts = Object.fromEntries([...new Set(observedTraces.map((trace) => trace.source || 'missing'))]
  .map((source) => [source, observedTraces.filter((trace) => (trace.source || 'missing') === source).length]));
const modelCounts = Object.fromEntries([...new Set(observedTraces.map((trace) => trace.model_id || 'missing'))]
  .map((modelId) => [modelId, observedTraces.filter((trace) => (trace.model_id || 'missing') === modelId).length]));
const fingerprintCounts = Object.fromEntries([...new Set(observedTraces.map((trace) => trace.fingerprint || 'missing'))]
  .map((fingerprint) => [fingerprint, observedTraces.filter((trace) => (trace.fingerprint || 'missing') === fingerprint).length]));
const observations = recallRows.map((row) => row.observation || {});
const expandedObservations = observations.filter((observation) => Array.isArray(observation.final_ragflow_queries)
  && observation.final_ragflow_queries.length > 1).length;
const expansionFingerprints = observedTraces.filter((trace) => String(trace.fingerprint || '').includes('expansion=true')).length;
const session = report.summary?.session_isolation || {};
const checks = {
  status_complete: report.status === 'complete',
  completion_failures_zero: report.completion_failures === 0,
  case_errors_zero: rows.every((row) => !row.error),
  cases_total_163: rows.length === 163,
  recall_cohort_149: recallRows.length === 149,
  jev_only: sourceCounts.jev === observedTraces.length && Object.keys(sourceCounts).length === 1,
  expansion_fingerprint_all: expansionFingerprints === observedTraces.length,
  expansion_queries_observed: expandedObservations === recallRows.length,
  sessions_unique: session.unique_sessions === 163,
  sessions_closed: session.cases_closed === 163,
  sessions_no_duplicates: session.duplicate_sessions === 0,
  sessions_no_close_failures: session.close_failures === 0,
  observation_coverage_full: report.summary?.observation_coverage?.rate === 1,
  chunk_observation_coverage_full: report.summary?.chunk_observation_coverage?.rate === 1,
  no_legacy_only_scoring: recallRows.every((row) => row.final?.gold || !row.retrieval_observation),
};

const result = {
  report_path: reportPath,
  run_id: report.run_id,
  started_at: report.started_at,
  finished_at: report.finished_at,
  duration_ms: report.duration_ms,
  status: report.status,
  completion_failures: report.completion_failures,
  cases_total: rows.length,
  recall_cohort: recallRows.length,
  case_errors: rows.filter((row) => row.error).length,
  decision_source_counts: sourceCounts,
  decision_model_counts: modelCounts,
  decision_fingerprint_counts: fingerprintCounts,
  observed_traces: observedTraces.length,
  expansion_fingerprints: expansionFingerprints,
  expanded_observations: expandedObservations,
  session_isolation: {
    cases_with_session: session.cases_with_session,
    cases_closed: session.cases_closed,
    unique_sessions: session.unique_sessions,
    duplicate_sessions: session.duplicate_sessions,
    close_failures: session.close_failures,
  },
  observation_coverage: report.summary?.observation_coverage,
  chunk_observation_coverage: report.summary?.chunk_observation_coverage,
  retrieval_states: report.summary?.states,
  warnings: report.warnings,
  checks,
  all_checks_passed: Object.values(checks).every(Boolean),
};

console.log(JSON.stringify(result, null, 2));
if (!result.all_checks_passed) process.exitCode = 1;
