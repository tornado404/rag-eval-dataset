import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadDataset } from '/Users/mac/work/rag-eval-dataset-m3-deploy/scripts/lib/dataset.mjs';

function readEnv(file) {
  const values = {};
  try {
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const separator = normalized.indexOf('=');
      if (separator <= 0) continue;
      let value = normalized.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[normalized.slice(0, separator).trim()] = value;
    }
  } catch {}
  return values;
}

const env = { ...readEnv(path.join(os.homedir(), '.config/rag-eval-dataset/eval.env')), ...process.env };
const qaBaseUrl = env.M3_BASE_URL || 'https://api.nicoyabio.com';
const backendContainer = env.M3_BACKEND_CONTAINER || 'ai-support-backend-1';
let accessToken = env.M3_QA_USER_JWT || '';
const refreshToken = env.M3_QA_USER_REFRESH_TOKEN || '';

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
  return payload;
}

async function token() {
  if (accessToken) return accessToken;
  if (!refreshToken) throw new Error('missing M3_QA_USER_JWT or M3_QA_USER_REFRESH_TOKEN');
  const payload = await requestJson(new URL('/api/v1/auth/refresh', qaBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  accessToken = payload?.data?.access_token || payload?.data?.accessToken || payload?.data?.token || '';
  if (!accessToken) throw new Error('refresh response missing access token');
  return accessToken;
}

async function authed(pathname, options = {}) {
  const authToken = await token();
  return requestJson(new URL(pathname, qaBaseUrl), {
    ...options,
    headers: { Authorization: `Bearer ${authToken}`, ...(options.headers || {}) },
  });
}

const dataset = loadDataset('v1.5');
const item = dataset.cases.find((row) => row.case_id === 'C00001');
if (!item) throw new Error('missing probe case');
const clientTurnId = `eval-probe-${Date.now()}`;
const startedAt = new Date(Date.now() - 5000).toISOString();
const turn = await authed('/api/v1/qa/turns', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: [{ type: 'text', text: item.question }],
    deliver: 'auto',
    client_turn_id: clientTurnId,
  }),
});
const sessionId = turn?.data?.session_id;
if (!sessionId) throw new Error('turn response missing session_id');
await authed(`/api/v1/sessions/${encodeURIComponent(sessionId)}/close`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirmed: true }),
});
const logs = execFileSync('ssh', ['m3r', `docker logs --since ${JSON.stringify(startedAt)} ${JSON.stringify(backendContainer)} 2>&1 | grep -E "query_expansion|turn_observation" | tail -n 20`], { encoding: 'utf8' });
console.log(JSON.stringify({
  case_id: item.case_id,
  question: item.question,
  turn_id: turn?.data?.turn_id || null,
  session_closed: true,
  query_expansion_logs: logs.split('\n').filter(Boolean).slice(-20),
}, null, 2));
