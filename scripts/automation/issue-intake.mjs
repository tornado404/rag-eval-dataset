import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';

import { evaluateIssueEvent, maximumEventBodyBytes } from './issue-gate.mjs';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_MS = [100, 250];
const MAX_PAYLOAD_BYTES = 256 * 1024;
const URL_PATTERN = /https?:\/\/[^\s'"<>]+/gi;
const WEBHOOK_ENV_PATTERN = /(MULTICA_WEBHOOK_URL\s*[:=]\s*)[^\s,;}"']+/gi;

class IntakeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function redact(value) {
  return String(value)
    .replace(WEBHOOK_ENV_PATTERN, '$1[redacted]')
    .replace(URL_PATTERN, '[redacted]');
}

function hasDryRun(argv) {
  if (argv.includes('--dry-run')) {
    return true;
  }

  const unknown = argv.find((argument) => argument !== '--dry-run');
  if (unknown !== undefined) {
    throw new IntakeError(`unknown argument: ${redact(unknown)}`, 2);
  }
  return false;
}

function getConfig(env) {
  return {
    eventPath: env.GITHUB_EVENT_PATH,
    webhookUrl: env.MULTICA_WEBHOOK_URL,
    authorIds: env.AI_AUTHOR_IDS,
    approverIds: env.AI_APPROVER_IDS,
  };
}

async function readEvent(eventPath) {
  if (typeof eventPath !== 'string' || eventPath === '') {
    throw new IntakeError('configuration is invalid: GITHUB_EVENT_PATH is not set');
  }

  let raw;
  try {
    raw = await readFile(eventPath);
  } catch {
    throw new IntakeError('configuration is invalid: GITHUB_EVENT_PATH is not readable');
  }

  if (raw.byteLength > maximumEventBodyBytes()) {
    throw new IntakeError('event body is too large');
  }

  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new IntakeError('event body is invalid JSON');
  }
}

function buildPayload(decision) {
  return {
    event: decision.event,
    action: decision.action,
    repo: decision.repository,
    github_issue_number: decision.github_issue_number,
    github_issue_id: decision.github_issue_id,
    github_issue_url: decision.github_issue_url,
    author_id: decision.author_id,
    authorization: decision.authorization,
  };
}

function requestOptions(url, payload, idempotencyKey) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(JSON.stringify(payload))),
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postWithRetry(url, payload, idempotencyKey, fetchImpl) {
  let lastReason = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, requestOptions(url, payload, idempotencyKey));
      if (response.ok) {
        return;
      }
      lastReason = `request failed with status ${response.status}`;
      await response.text();
    } catch (error) {
      if (error instanceof IntakeError) {
        throw error;
      }
      lastReason = 'network request failed';
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(BACKOFF_MS[attempt - 1]);
    }
  }

  throw new IntakeError(lastReason);
}

export async function run(argv = [], env = process.env, fetchImpl = fetch) {
  const dryRun = hasDryRun(argv);
  const config = getConfig(env);
  const event = await readEvent(config.eventPath);
  const result = evaluateIssueEvent(event, config);

  if (!result.matched) {
    return { status: 'skipped', reason: result.reason, network_calls: 0 };
  }

  const payload = buildPayload(result.decision);
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8');
  if (encoded.byteLength > MAX_PAYLOAD_BYTES) {
    throw new IntakeError('payload is too large');
  }

  const idempotencyKey = `raged-${result.decision.repository.id}-${result.decision.github_issue_id}-v1`;
  const redactedResult = {
    status: 'matched',
    dry_run: dryRun,
    event: result.decision.event,
    action: result.decision.action,
    repo: {
      name: result.decision.repository.name,
      id: result.decision.repository.id,
    },
    github_issue_number: result.decision.github_issue_number,
    github_issue_id: result.decision.github_issue_id,
    github_issue_url: result.decision.github_issue_url,
    author_id: result.decision.author_id,
    authorization: result.decision.authorization,
    idempotency_key: idempotencyKey,
    payload_bytes: encoded.byteLength,
    forwarded_text_fields: [],
  };

  if (dryRun) {
    return redactedResult;
  }

  if (typeof config.webhookUrl !== 'string' || config.webhookUrl === '') {
    throw new IntakeError('configuration is invalid: MULTICA_WEBHOOK_URL is not set');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(config.webhookUrl);
  } catch {
    throw new IntakeError('configuration is invalid: MULTICA_WEBHOOK_URL is not a URL');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new IntakeError('configuration is invalid: MULTICA_WEBHOOK_URL must use HTTPS');
  }

  await postWithRetry(parsedUrl.toString(), payload, idempotencyKey, fetchImpl);
  return { ...redactedResult, status: 'delivered', network_calls: 1 };
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`${JSON.stringify({ status: 'error', error: redact(message) })}\n`);
    process.exitCode = error instanceof IntakeError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
