[REDACTED]
[REDACTED]
[REDACTED]
import http from 'node:http';
[REDACTED]
import { REPO_ROOT, datasetDir, readJsonl, writeJsonl, validateDataset } from '../scripts/lib/dataset.mjs';

const PORT = Number(process.env.PORT || 4173);
const VERSION = process.env.DATASET_VERSION || 'v1.4';
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

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
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
    expected_outputs: readJsonl(path.join(dir, 'expected_outputs.jsonl')),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, loadState());
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
      const errors = validateDataset({ ...state, expected_outputs: state.expected_outputs });
      if (errors.length) return send(res, 422, { error: 'validation failed', errors: errors.slice(0, 50) });
      writeJsonl(outputsPath, state.expected_outputs);
      const commit = commitAndMaybePush(state.expected_outputs);
      return send(res, 200, { saved: body.rows.length, ...commit });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(REPO_ROOT, 'editor', 'index.html'));
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    return send(res, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dataset editor: http://127.0.0.1:${PORT}`);
  console.log(`Dataset version: ${VERSION}`);
  console.log(`Auto commit: ${AUTO_COMMIT ? 'on' : 'off'} | Auto push: ${AUTO_PUSH ? 'on' : 'off'}`);
  console.log(`Exit: Ctrl+C`);
});
