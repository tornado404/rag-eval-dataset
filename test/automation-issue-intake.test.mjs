import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateIssueEvent } from '../scripts/automation/issue-gate.mjs';
import { run } from '../scripts/automation/issue-intake.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => join(root, 'test', 'fixtures', name);
const env = (eventPath, overrides = {}) => ({
  GITHUB_EVENT_PATH: eventPath,
  MULTICA_WEBHOOK_URL: 'https://multica.invalid/hooks/secret-path',
  AI_AUTHOR_IDS: '111, 222',
  AI_APPROVER_IDS: '333',
  ...overrides,
});

function recordingFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

async function loadJson(name) {
  return JSON.parse(await readFile(fixture(name), 'utf8'));
}

test('G01 accepts an opened issue from an allowlisted author', async () => {
  const calls = [];
  const result = await run(
    [],
    env(fixture('opened-allowed.json')),
    recordingFetch(calls),
  );

  assert.equal(result.status, 'delivered');
  assert.equal(result.idempotency_key, 'raged-987654-555001-v1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['idempotency-key'], 'raged-987654-555001-v1');

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    event: 'github.issue.intake',
    action: 'opened',
    repo: { name: 'tornado404/rag-eval-dataset', id: 987654 },
    github_issue_number: 42,
    github_issue_id: 555001,
    github_issue_url: 'https://github.com/tornado404/rag-eval-dataset/issues/42',
    author_id: 111,
    authorization: { kind: 'author', actor_id: 111 },
  });
  assert.doesNotMatch(calls[0].options.body, /Untrusted|Do not forward|secret-path/);
});

test('G02 rejects an opened issue from a non-allowlisted author without network', async () => {
  const calls = [];
  const result = await run(
    [],
    env(join(root, 'scripts', 'automation', 'fixtures', 'opened-denied.json')),
    recordingFetch(calls),
  );

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /allowlist/);
  assert.equal(result.network_calls, 0);
  assert.equal(calls.length, 0);
});

test('G03 accepts only ai-approved applied by an allowlisted approver', async () => {
  const allowed = await loadJson('labeled-allowed.json');
  assert.equal(evaluateIssueEvent(allowed, { authorIds: '111', approverIds: '333' }).matched, true);

  const wrongLabel = structuredClone(allowed);
  wrongLabel.label.name = 'bug';
  assert.equal(evaluateIssueEvent(wrongLabel, { authorIds: '111', approverIds: '333' }).matched, false);

  const wrongApprover = structuredClone(allowed);
  wrongApprover.sender.id = 999;
  assert.equal(evaluateIssueEvent(wrongApprover, { authorIds: '111', approverIds: '333' }).matched, false);

  const calls = [];
  const result = await run([], env(fixture('labeled-allowed.json')), recordingFetch(calls));
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.authorization, {
    kind: 'label',
    actor_id: 333,
    label: 'ai-approved',
  });
});

test('G04 rejects wrong repository, closed state, pull requests, and invalid numeric IDs', () => {
  const base = {
    action: 'opened',
    repository: { id: 1, full_name: 'tornado404/rag-eval-dataset' },
    issue: {
      id: 2,
      number: 3,
      state: 'open',
      html_url: 'https://github.com/tornado404/rag-eval-dataset/issues/3',
      user: { id: 111 },
    },
  };
  const config = { authorIds: '111', approverIds: '333' };

  assert.equal(evaluateIssueEvent(base, config).matched, true);

  for (const mutate of [
    (event) => { event.repository.full_name = 'other/rag-eval-dataset'; },
    (event) => { event.issue.state = 'closed'; },
    (event) => { event.pull_request = { id: 9 }; },
    (event) => { event.repository.id = 0; },
    (event) => { event.issue.id = -1; },
    (event) => { event.issue.number = 0; },
    (event) => { event.issue.user.id = 1.5; },
  ]) {
    const event = structuredClone(base);
    mutate(event);
    assert.equal(evaluateIssueEvent(event, config).matched, false);
  }
});

test('G05 rejects invalid issue URLs and unsupported actions', () => {
  const base = {
    action: 'opened',
    repository: { id: 1, full_name: 'tornado404/rag-eval-dataset' },
    issue: {
      id: 2,
      number: 3,
      state: 'open',
      html_url: 'https://github.com/tornado404/rag-eval-dataset/issues/3',
      user: { id: 111 },
    },
  };
  const config = { authorIds: '111', approverIds: '333' };

  const badHost = structuredClone(base);
  badHost.issue.html_url = 'https://example.com/tornado404/rag-eval-dataset/issues/3';
  assert.equal(evaluateIssueEvent(badHost, config).matched, false);

  const badPath = structuredClone(base);
  badPath.issue.html_url = 'https://github.com/tornado404/other/issues/3';
  assert.equal(evaluateIssueEvent(badPath, config).matched, false);

  const badAction = structuredClone(base);
  badAction.action = 'edited';
  assert.equal(evaluateIssueEvent(badAction, config).matched, false);
});

test('G06 rejects empty allowlists', () => {
  const event = {
    action: 'opened',
    repository: { id: 1, full_name: 'tornado404/rag-eval-dataset' },
    issue: {
      id: 2,
      number: 3,
      state: 'open',
      html_url: 'https://github.com/tornado404/rag-eval-dataset/issues/3',
      user: { id: 111 },
    },
  };

  for (const config of [
    {},
    { authorIds: '', approverIds: '333' },
    { authorIds: '111', approverIds: ', ' },
    { authorIds: 'words', approverIds: '333' },
  ]) {
    const result = evaluateIssueEvent(event, config);
    assert.equal(result.matched, false);
    assert.match(result.reason, /not configured/);
  }
});

test('G07 dry-run validates and prints redacted results without network', async () => {
  const calls = [];
  const result = await run(
    ['--dry-run'],
    env(fixture('opened-allowed.json')),
    recordingFetch(calls),
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.dry_run, true);
  assert.equal(
    result.github_issue_url,
    'https://github.com/tornado404/rag-eval-dataset/issues/42',
  );
  assert.deepEqual(result.forwarded_text_fields, []);
  assert.equal(calls.length, 0);
});

test('G07b CLI dry-run emits redacted JSON without a webhook', async () => {
  const stdout = execFileSync(
    process.execPath,
    [
      join(root, 'scripts', 'automation', 'issue-intake.mjs'),
      '--dry-run',
    ],
    {
      encoding: 'utf8',
      env: env(fixture('opened-allowed.json'), {
        MULTICA_WEBHOOK_URL: 'https://multica.invalid/hooks/secret-path',
      }),
    },
  );

  const result = JSON.parse(stdout);
  assert.equal(result.status, 'matched');
  assert.equal(result.dry_run, true);
  assert.equal(result.idempotency_key, 'raged-987654-555001-v1');
  assert.doesNotMatch(stdout, /secret-path/);
});

test('G08 retries failures up to three attempts with the same idempotency key', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length < 3) {
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 202, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const result = await run([], env(fixture('opened-allowed.json')), fetchImpl);
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 3);
  assert.deepEqual(
    new Set(calls.map((call) => call.options.headers['idempotency-key'])),
    new Set(['raged-987654-555001-v1']),
  );
});

test('G09 network and non-2xx failures exit nonzero with redacted errors', async () => {
  const failingFetch = async () => {
    throw new Error('connect to https://multica.invalid/hooks/secret-path failed');
  };
  await assert.rejects(
    run([], env(fixture('opened-allowed.json')), failingFetch),
    (error) => {
      assert.equal(error.message, 'network request failed');
      assert.doesNotMatch(error.message, /secret-path|https?:\/\//);
      return true;
    },
  );

  const nonOkFetch = async () => ({
    ok: false,
    status: 500,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '',
  });
  await assert.rejects(
    run([], env(fixture('opened-allowed.json')), nonOkFetch),
    /request failed with status 500/,
  );
});

test('G10 bounded retries reuse the same idempotency key', async () => {
  const calls = [];
  const outcomes = [500, 500, 200];
  const fetchImpl = async (url, options) => {
    calls.push({ at: Date.now(), key: options.headers['idempotency-key'] });
    return {
      ok: outcomes[calls.length - 1] === 200,
      status: outcomes[calls.length - 1],
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };

  await run([], env(fixture('opened-allowed.json')), fetchImpl);

  assert.equal(calls.length, 3);
  assert.deepEqual(new Set(calls.map((call) => call.key)), new Set(['raged-987654-555001-v1']));
  assert.ok(calls.at(-1).at - calls[0].at < 10_000, 'backoff stays bounded across retries');

  const secondRun = [];
  await run(
    [],
    env(fixture('opened-allowed.json')),
    async (url, options) => {
      secondRun.push(options.headers['idempotency-key']);
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  );
  assert.deepEqual(new Set(secondRun), new Set(['raged-987654-555001-v1']));
});

test('G11 validate-skipped QA evidence is not a complete pass', async () => {
  const qa = await readFile(join(root, 'docs', 'automation', 'agents', 'QA.md'), 'utf8');
  const handoff = await readFile(
    join(root, 'automation', 'multica', 'handoffs', 'qa.md'),
    'utf8',
  );

  assert.match(qa, /skipped because private datasets are absent is partial evidence/);
  assert.match(qa, /manual_data_validation_required/);
  assert.match(handoff, /Do not treat skipped private-data validation as a full pass/);
  assert.match(handoff, /awaiting_merge/);
});

test('G12 protected path policy requires human review and blocked', async () => {
  const files = [
    'docs/automation/agents/Triage.md',
    'docs/automation/agents/Planner.md',
    'docs/automation/agents/Developer.md',
    'docs/automation/agents/Reviewer.md',
    'docs/automation/agents/QA.md',
    'automation/multica/handoffs/planning.md',
  ];

  for (const relativePath of files) {
    const text = await readFile(join(root, relativePath), 'utf8');
    assert.match(text, /human review|Blocked|blocked/i, `${relativePath} mentions human review/blocked`);
  }

  const developer = await readFile(
    join(root, 'docs', 'automation', 'agents', 'Developer.md'),
    'utf8',
  );
  assert.match(developer, /Never push to main, force push, rewrite history/);
  assert.match(developer, /Draft PR/);
});
