import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, datasetDir, readJsonl, writeJsonl, validateDataset } from '../scripts/lib/dataset.mjs';
import { normalizeEvaluationRequest, runEvaluation } from './evaluator.mjs';

const PORT = Number(process.env.PORT || 4173);
const BIND_ADDRESS = process.env.BIND_ADDRESS || '127.0.0.1';
const VERSION = process.env.DATASET_VERSION || 'v1.5';
const AUTO_COMMIT = process.env.AUTO_COMMIT !== '0';
const AUTO_PUSH = process.env.AUTO_PUSH === '1';
const COMMIT_PREFIX = process.env.COMMIT_PREFIX || 'dataset(editor)';
const EDITABLE_FIELDS = [
  'answer_text',
  'expected_behavior',
  'required_fact_ids',
  'forbidden_fact_ids',
  'rubric',
  'status',
  'reviewer',
];

const outputsPath = path.join(datasetDir(VERSION), 'expected_outputs.jsonl');
const EVAL_CONFIG_FILE = process.env.EVAL_CONFIG_FILE || path.join(os.homedir(), '.config', 'rag-eval-dataset', 'eval.env');

function readEnvFile(file) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const EVAL_FILE_ENV = readEnvFile(EVAL_CONFIG_FILE);

function evalEnv(name) {
  const value = process.env[name] ?? EVAL_FILE_ENV[name];
  return value === undefined || value === null ? '' : String(value);
}

function splitList(value) {
  return String(value || '').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
}

function buildEvalDefaults() {
  const maxCases = Number(evalEnv('EVAL_MAX_CASES') || 0);
  const configuredTarget = evalEnv('EVAL_TARGET');
  return {
    target: ['qa-probe', 'ai-qa'].includes(configuredTarget) ? configuredTarget : 'ragflow',
    rewriteEndpoint: evalEnv('EVAL_REWRITE_ENDPOINT'),
    rewriteModel: evalEnv('EVAL_REWRITE_MODEL'),
    ragflowBaseUrl: evalEnv('RAGFLOW_BASE_URL'),
    qaBaseUrl: evalEnv('M3_BASE_URL'),
    qaBackendContainer: evalEnv('M3_BACKEND_CONTAINER'),
    datasetIds: splitList(evalEnv('RAGFLOW_DATASET_IDS')),
    maxCases: Number.isInteger(maxCases) && maxCases >= 0 && maxCases <= 1000 ? maxCases : 0,
    credentials: {
      rewriteApiKey: Boolean(evalEnv('EVAL_REWRITE_API_KEY')),
      ragflowApiKey: Boolean(evalEnv('RAGFLOW_API_KEY')),
      qaToken: Boolean(evalEnv('M3_ADMIN_TOKEN')),
      qaUserAuth: Boolean(evalEnv('M3_QA_USER_JWT') || evalEnv('M3_QA_USER_REFRESH_TOKEN')),
    },
  };
}

function withServerDefaults(body) {
  const defaults = buildEvalDefaults();
  const source = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : {};
  const config = { ...source };
  config.target = config.target || defaults.target;
  config.rewriteEndpoint = config.rewriteEndpoint || defaults.rewriteEndpoint;
  config.rewriteModel = config.rewriteModel || defaults.rewriteModel;
  config.rewriteApiKey = config.rewriteApiKey || evalEnv('EVAL_REWRITE_API_KEY');
  if (config.maxCases === undefined || config.maxCases === null || config.maxCases === '') {
    config.maxCases = defaults.maxCases;
  }
  if (config.target === 'ragflow') {
    config.ragflowBaseUrl = config.ragflowBaseUrl || defaults.ragflowBaseUrl;
    config.ragflowApiKey = config.ragflowApiKey || evalEnv('RAGFLOW_API_KEY');
    const datasetIds = Array.isArray(config.datasetIds)
    ? config.datasetIds.map((item) => String(item).trim()).filter(Boolean)
      : [];
    config.datasetIds = datasetIds.length ? datasetIds : defaults.datasetIds;
  } else if (config.target === 'qa-probe') {
    config.qaBaseUrl = config.qaBaseUrl || defaults.qaBaseUrl;
    config.qaToken = config.qaToken || evalEnv('M3_ADMIN_TOKEN');
  } else if (config.target === 'ai-qa') {
    config.qaBaseUrl = config.qaBaseUrl || defaults.qaBaseUrl;
    // 用户 JWT / refresh token 只从服务端环境读取，浏览器永远拿不到。
    config.qaUserJwt = evalEnv('M3_QA_USER_JWT');
    config.qaRefreshToken = evalEnv('M3_QA_USER_REFRESH_TOKEN');
    config.qaBackendContainer = config.qaBackendContainer || evalEnv('M3_BACKEND_CONTAINER');
  }
  return { ...body, config };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

function safeBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) reject(new Error('request body too large'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(body && typeof body === 'object' ? body : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();
}

function commitAndMaybePush(rows) {
  const repositoryPath = path.relative(fs.realpathSync(REPO_ROOT), fs.realpathSync(outputsPath));
  if (repositoryPath === '..' || repositoryPath.startsWith(`..${path.sep}`) || path.isAbsolute(repositoryPath)) {
    return { committed: false, external_data: true };
  }
  const changed = git(['status', '--porcelain', '--', path.relative(REPO_ROOT, outputsPath)]);
  if (!changed) return { committed: false };
  if (!AUTO_COMMIT) return { committed: false, dirty: true };
  const caseIds = rows.slice(0, 3).map((row) => row.case_id).join(', ');
  git(['add', '--', path.relative(REPO_ROOT, outputsPath)]);
  git(['commit', '-m', `${COMMIT_PREFIX}: update ${VERSION} expected outputs (${caseIds})`]);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (AUTO_PUSH) git(['push', 'origin', 'HEAD']);
  return { committed: true, commit, pushed: AUTO_PUSH };
}

function loadState() {
  const dir = datasetDir(VERSION);
  return {
    cases: readJsonl(path.join(dir, 'cases.jsonl')),
    facts: readJsonl(path.join(dir, 'facts.jsonl')),
    evidences: readJsonl(path.join(dir, 'evidences.jsonl')),
    fact_evidence_relations: readJsonl(path.join(dir, 'fact_evidence_relations.jsonl')),
    datasets: readJsonl(path.join(dir, 'datasets.jsonl')),
    expected_outputs: readJsonl(path.join(dir, 'expected_outputs.jsonl')),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, loadState());
    }

    if (req.method === 'GET' && url.pathname === '/api/eval/defaults') {
      return send(res, 200, buildEvalDefaults());
    }

    if (req.method === 'POST' && url.pathname === '/api/eval/run') {
      const body = withServerDefaults(await safeBody(req));
      let request;
      try {
        request = normalizeEvaluationRequest(body);
      } catch (error) {
        return send(res, 400, { error: error.message || 'invalid evaluation settings' });
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const emit = (event) => {
        if (res.destroyed || res.writableEnded) return false;
        res.write(`${JSON.stringify(event)}\n`);
        return true;
      };

      try {
        const report = await runEvaluation(loadState(), request, {
          signal: controller.signal,
          onProgress: (progress) => emit({ type: 'progress', ...progress }),
        });
        emit({ type: 'done', report });
      } catch (error) {
        if (!controller.signal.aborted) emit({ type: 'error', error: error.message || 'evaluation failed' });
      } finally {
        if (!res.destroyed) res.end();
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await safeBody(req);
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        return send(res, 400, { error: 'rows must be a non-empty array' });
      }
      const state = loadState();
      const byId = new Map(state.expected_outputs.map((row) => [row.case_id, row]));
      for (const patch of body.rows) {
        const previous = byId.get(patch.case_id);
        if (!previous) return send(res, 404, { error: `unknown case_id ${patch.case_id}` });
        for (const field of EDITABLE_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(patch, field)) previous[field] = patch[field];
        }
        previous.updated_at = new Date().toISOString();
      }
      const factEvidenceRelationsPath = path.join(datasetDir(VERSION), 'fact_evidence_relations.jsonl');
      const errors = validateDataset({
        ...state,
        expected_outputs: state.expected_outputs,
        fact_evidence_relations: readJsonl(factEvidenceRelationsPath),
      });
      if (errors.length) return send(res, 422, { error: 'validation failed', errors: errors.slice(0, 50) });
      writeJsonl(outputsPath, state.expected_outputs);
      const commit = commitAndMaybePush(state.expected_outputs);
      return send(res, 200, { saved: body.rows.length, ...commit });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(REPO_ROOT, 'editor', 'index.html'));
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/report-history.js') {
      const script = fs.readFileSync(path.join(REPO_ROOT, 'editor', 'report-history.js'));
      return send(res, 200, script, 'text/javascript; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/metrics.mjs') {
      const script = fs.readFileSync(path.join(REPO_ROOT, 'editor', 'metrics.mjs'));
      return send(res, 200, script, 'text/javascript; charset=utf-8');
    }

    return send(res, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Dataset editor listening on ${BIND_ADDRESS}:${PORT}`);
  if (BIND_ADDRESS !== '127.0.0.1') console.log(`Local URL: http://${BIND_ADDRESS}:${PORT}/`);
  const defaults = buildEvalDefaults();
  console.log(`Eval config: ${EVAL_CONFIG_FILE}${Object.keys(EVAL_FILE_ENV).length ? '' : ' (not found)'}`);
  console.log(`Eval default target: ${defaults.target} | ragflow key: ${defaults.credentials.ragflowApiKey ? 'configured' : 'missing'} | model key: ${defaults.credentials.rewriteApiKey ? 'configured' : 'missing'}`);
  console.log(`AI QA real-path credential: ${defaults.credentials.qaUserAuth ? 'configured' : 'missing'} | backend container: ${defaults.qaBackendContainer || 'auto-detect'}`);
  console.log(`Dataset version: ${VERSION}`);
  console.log(`Auto commit: ${AUTO_COMMIT ? 'on' : 'off'} | Auto push: ${AUTO_PUSH ? 'on' : 'off'}`);
  console.log(`Exit: Ctrl+C`);
});
