import assert from 'node:assert/strict';
[REDACTED]
[REDACTED]
import test from 'node:test';
import { datasetDir, loadDataset, loadExpectedActionMap, validateExpectedActionMap } from '../scripts/lib/dataset.mjs';
import {
  EVALUATOR_VERSION,
  METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  normalizeEvaluationRequest,
  parseQaObservations,
  scanReportSecrets,
} from '../editor/evaluator.mjs';

function actionMapFixture() {
  const data = {
    cases: [
      { case_id: 'CASE-001' },
      { case_id: 'CASE-002' },
      { case_id: 'CASE-003' },
    ],
    expected_outputs: [
      { case_id: 'CASE-001', expected_behavior: 'answer' },
      { case_id: 'CASE-002', expected_behavior: '[REDACTED]' },
      { case_id: 'CASE-003', expected_behavior: 'refuse_or_[REDACTED]' },
    ],
  };
  const actionMap = {
    schema_version: '[REDACTED]',
    dataset_version: 'v1.5',
    provisional: true,
    behavior_rules: {
      answer: 'answer',
      clarify: 'clarify',
      [REDACTED]: '[REDACTED]',
      escalate_human: 'escalate_human',
      [REDACTED]: '[REDACTED]',
    },
    unscored_case_ids: ['CASE-003'],
    cases: {
      'CASE-001': { scoreable: true, expected_action: 'answer' },
      'CASE-002': { scoreable: true, expected_action: '[REDACTED]' },
      'CASE-003': { scoreable: false, expected_action: null },
    },
  };
  return { data, actionMap };
}

test('expected-action map validates synthetic scoreable and unscored cases', () => {
  const { data, actionMap } = actionMapFixture();
  assert.equal(actionMap.schema_version, '[REDACTED]');
  assert.equal(actionMap.dataset_version, 'v1.5');
  assert.equal(actionMap.provisional, true);
  assert.deepEqual(validateExpectedActionMap(data, actionMap), []);
});

test('expected-action validation rejects a wrong compliance mapping', () => {
  const { data, actionMap } = actionMapFixture();
  actionMap.behavior_rules.[REDACTED] = 'refuse_domain';
  const errors = validateExpectedActionMap(data, actionMap);
  assert.ok(errors.some((error) => error.includes('[REDACTED]')));
});

test('AI QA evaluation ignores maxCases and keeps the full Decision cohort', () => {
  const request = normalizeEvaluationRequest({
    mode: 'full',
    config: {
      target: 'ai-qa',
      qaBaseUrl: 'https://api.example.com',
      qaRefreshToken: 'synthetic-refresh-token',
      maxCases: 5,
    },
  });

  assert.equal(request.config.target, 'ai-qa');
  assert.equal(request.config.maxCases, 0);
});

const hasPrivateV15 = fs.existsSync(path.join(datasetDir('v1.5'), 'cases.jsonl'));
test('AI QA progress events include API, decision, and observation counters', { skip: !hasPrivateV15 }, async () => {
  const { runEvaluation } = await import('../editor/evaluator.mjs');
  [REDACTED]
  const actionMap = loadExpectedActionMap('v1.5');
  const answerCount = dataset.cases.filter((row) => actionMap.cases[row.case_id]?.expected_action === 'answer').length;
  const events = [];

  await assert.rejects(
    runEvaluation(
      dataset,
      { mode: 'full', config: { target: 'ai-qa', qaBaseUrl: 'http://127.0.0.1:1', qaToken: 'placeholder' } },
      { onProgress: (event) => events.push(event) },
    ),
  );

  assert.equal(events[0].counts.api.total, dataset.cases.length);
  assert.equal(events[0].counts.decision.total, dataset.cases.length);
  assert.equal(events[0].counts.observation.total, answerCount);
});

test('decision log parsing keeps trace metadata and handles structured decision events', () => {
  const logs = parseQaObservations([
    'qa: decision_engine session=s1 mode=enforce decision={"action":"refuse_domain","intent":"other","confidence":0.91}',
    'qa: decision_trace session=s1 mode=shadow trace={"action":"answer","intent":"knowledge_qa","source":"llm","fallback_category":"none","model_id":"model-x","fingerprint":"fp-1","build_sha":"abc123","correlation_id":"corr-1"}',
    'qa: turn_observation session=s1 client_turn_id=eval-1 observation={"client_turn_id":"eval-1","route":"other","retrieval":{"attempted":false,"state":"not_attempted"},"metrics_schema_version":2,"final_grounding":[],"ragflow_candidates_at_12":[]}',
  ].join('\n'));

  assert.equal(logs.decisionsBySession.get('s1').decision.action, 'refuse_domain');
  assert.equal(logs.decisionTracesBySession.get('s1').trace.source, 'llm');
  assert.equal(logs.decisionTracesBySession.get('s1').trace.model_id, 'model-x');
  const observation = logs.byClientTurn.get('eval-1');
  assert.equal(observation.retrieval.state, 'not_attempted');
  assert.equal(observation.client_turn_id, 'eval-1');
});

test('report secret scan reports findings without returning secret values', () => {
  const report = {
    config: { token: 'synthetic-token' },
    text: 'Bearer another-synthetic-token',
  };
  const findings = scanReportSecrets(report);
  assert.ok(findings.length > 0);
  assert.equal(JSON.stringify(findings).includes('synthetic-token'), false);
});

test('evaluation schemas expose explicit versions', () => {
  assert.equal(typeof EVALUATOR_VERSION, 'string');
  assert.equal(typeof METRIC_SCHEMA_VERSION, 'string');
  assert.equal(typeof REPORT_SCHEMA_VERSION, 'string');
});
