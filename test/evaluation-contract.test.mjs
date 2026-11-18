import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDataset, loadExpectedActionMap, validateExpectedActionMap } from '../scripts/lib/dataset.mjs';
import {
  EVALUATOR_VERSION,
  METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  normalizeEvaluationRequest,
  parseQaObservations,
  scanReportSecrets,
} from '../editor/evaluator.mjs';

test('v1.5 expected-action map covers every case without guessing legacy labels', () => {
  [REDACTED]
  const actionMap = loadExpectedActionMap('v1.5');

  assert.equal(actionMap.schema_version, '[REDACTED]');
  assert.equal(actionMap.dataset_version, 'v1.5');
  assert.equal(actionMap.provisional, true);
  assert.equal(actionMap.behavior_rules.answer, 'answer');
  assert.equal(actionMap.behavior_rules.[REDACTED], '[REDACTED]');
  assert.deepEqual(actionMap.unscored_case_ids, [
    'C00079',
    'C00116',
    'C00117',
    'C00119',
    'C00149',
  ]);
  assert.deepEqual(validateExpectedActionMap(dataset, actionMap), []);

  const classified = dataset.cases.map((item) => actionMap.cases[item.case_id]);
  assert.equal(classified.length, 163);
  assert.equal(classified.filter((entry) => entry.expected_action === 'answer').length, 149);
  assert.equal(classified.filter((entry) => entry.scoreable).length, 158);
});

test('expected-action validation rejects a wrong compliance mapping', () => {
  [REDACTED]
  const actionMap = loadExpectedActionMap('v1.5');
  actionMap.behavior_rules.[REDACTED] = 'refuse_domain';

  const errors = validateExpectedActionMap(dataset, actionMap);
  assert.ok(errors.some((error) => error.includes('[REDACTED]')));
});

test('AI QA evaluation ignores maxCases and keeps full Decision cohort', () => {
  const request = normalizeEvaluationRequest({
    mode: 'full',
    config: {
      target: 'ai-qa',
      qaBaseUrl: '[REDACTED]',
      qaUserJwt: 'placeholder-token',
      maxCases: 5,
    },
  });

  assert.equal(request.config.target, 'ai-qa');
  assert.equal(request.config.maxCases, 0);
});

test('AI QA progress events include API, decision, and observation counters', async () => {
  const { runEvaluation } = await import('../editor/evaluator.mjs');
  [REDACTED]
  const events = [];

  await assert.rejects(
    runEvaluation(
      dataset,
      { mode: 'full', config: { target: 'ai-qa', qaBaseUrl: 'http://127.0.0.1:1', qaToken: 'placeholder' } },
      { onProgress: (event) => events.push(event) },
    ),
  );

  assert.equal(events[0].counts.api.total, 163);
  assert.equal(events[0].counts.decision.total, 163);
  assert.equal(events[0].counts.observation.total, 149);
});

test('decision log parsing keeps trace metadata and handles structured decision events', () => {
  const logs = parseQaObservations([
    'qa: decision_engine session=s1 mode=enforce decision={"action":"refuse_domain","intent":"other","confidence":0.91}',
    'qa: decision_trace session=s1 mode=shadow trace={"action":"answer","intent":"[REDACTED]","source":"llm","fallback_category":"none","model_id":"jev-v2","fingerprint":"fp-1","build_sha":"abc123","correlation_id":"corr-1"}',
    'qa: turn_observation session=s1 client_turn_id=eval-1 observation={"client_turn_id":"eval-1","route":"other","retrieval":{"attempted":false,"state":"not_attempted"},"metrics_schema_version":2,"final_grounding":[],"ragflow_candidates_at_12":[]}',
  ].join('\n'));

  assert.equal(logs.decisionsBySession.get('s1').decision.action, 'refuse_domain');
  assert.equal(logs.decisionTracesBySession.get('s1').trace.source, 'llm');
  assert.equal(logs.decisionTracesBySession.get('s1').trace.model_id, 'jev-v2');
  const observation = logs.byClientTurn.get('eval-1');
  assert.equal(observation.retrieval.state, 'not_attempted');
  assert.equal(observation.metrics_schema_version, 2);
});

test('report secret scan catches credentials without echoing their values', () => {
  const findings = scanReportSecrets({
    report_schema_version: REPORT_SCHEMA_VERSION,
    metric_schema_version: METRIC_SCHEMA_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    run: { notes: 'Authorization: Bearer abc.def.ghi and https://user:pass@example.com/v1' },
  });

  assert.ok(findings.length >= 2);
  assert.ok(findings.every((finding) => !finding.includes('abc.def.ghi')));
  assert.ok(findings.every((finding) => !finding.includes('pass')));
});
