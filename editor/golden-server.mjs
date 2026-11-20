[REDACTED]
import http from 'node:http';
[REDACTED]
[REDACTED]
import { REPO_ROOT } from '../scripts/lib/dataset.mjs';
import {
  GOLDEN_VERSION,
  GoldenError,
  applyEvidenceChunks,
  applyFactEvidence,
  applyQueryFactManagement,
  applyQueryFacts,
  assessRecall,
  autoMatchQuery,
  coverageGaps,
  createEvidence,
  createQueryBundle,
  deleteEntity,
  evidenceInventory,
  mutate,
  parseSuggestions,
  parseEvidenceDraftPolish,
  readState,
  upsertEntity,
} from '../scripts/lib/golden.mjs';

const PORT = Number(process.env.GOLDEN_PORT || 4174);
const BIND_ADDRESS = process.env.BIND_ADDRESS || '127.0.0.1';
const VERSION = process.env.GOLDEN_VERSION || GOLDEN_VERSION;
const TIMEOUT_MS = Number(process.env.GOLDEN_REMOTE_TIMEOUT_MS || 30_000);
const MAX_REMOTE_BYTES = 4 * 1024 * 1024;
const STATIC_DIR = path.join(REPO_ROOT, 'editor', 'golden');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (typeof body === 'string' || Buffer.isBuffer(body)) res.end(body);
  else res.end(JSON.stringify(body));
}

function safeBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new GoldenError('request body too large', 413));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        resolve(body && typeof body === 'object' ? body : {});
      } catch {
        reject(new GoldenError('invalid JSON body', 400));
      }
    });
    req.on('error', reject);
  });
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    [REDACTED]
      [REDACTED]
    }
    out[key] = value;
  }
  return out;
}

function loadConfig() {
  const file = process.env.GOLDEN_CONFIG_FILE
    || path.join(os.homedir(), '.config', 'rag-eval-dataset', 'golden.env');
  const vars = { ...parseEnvFile(file), ...process.env };
  const rawDatasets = String(vars.RAGFLOW_DATASETS || vars.RAGFLOW_DATASET_IDS || '').trim();
  const datasets = rawDatasets
    ? rawDatasets.split(',').map((entry) => {
      const item = entry.trim();
      if (!item) return null;
      const index = item.indexOf(':');
      return index > 0 ? { id: item.slice(0, index).trim(), name: item.slice(index + 1).trim() } : { id: item, name: item };
    })[REDACTED]
    : [];
  return {
    configFile: file,
    ragflowBaseUrl: String(vars.RAGFLOW_BASE_URL || '').trim(),
    ragflowApiKey: String(vars.RAGFLOW_API_KEY || '').trim(),
    datasets,
    llmBaseUrl: String(vars.LLM_BASE_URL || '').trim(),
    llmApiKey: String(vars.LLM_API_KEY || '').trim(),
    llmModel: String(vars.LLM_MODEL || '').trim(),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function publicConfig(config) {
  return {
    ragflow: {
      configured: Boolean(config.ragflowBaseUrl && config.ragflowApiKey && config.datasets.length),
      host: hostOf(config.ragflowBaseUrl),
      datasets: config.datasets,
    },
    llm: {
      configured: Boolean(config.llmBaseUrl && config.llmModel),
      host: hostOf(config.llmBaseUrl),
      model: config.llmModel,
    },
    config_file: config.configFile,
  };
}

function ragflowUrl(config, pathname) {
  const base = config.ragflowBaseUrl.replace(/\/+$/, '');
  const root = /\/api\/v1$/.test(base) ? base : `${base}/api/v1`;
  return new URL(root + pathname).toString();
}

async function requestJson(url, { method = 'GET', headers = {}, body, label = '上游服务' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new GoldenError(`${label} 请求超时`, 504);
      throw new GoldenError(`${label} 无法连接：${error.message}`, 502);
    }

    const reader = response.body?.getReader();
    const parts = [];
    let bytes = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_REMOTE_BYTES) {
          await reader.cancel();
          throw new GoldenError(`${label} 响应超过 4 MB`, 502);
        }
        parts.push(Buffer.from(value));
      }
    }
    const raw = Buffer.concat(parts, bytes).toString('utf8');
    if (response.status === 401 || response.status === 403) throw new GoldenError(`${label} 认证失败（HTTP ${response.status}）`, 502);
    if (!response.ok) throw new GoldenError(`${label} 返回 HTTP ${response.status}`, response.status >= 500 ? 502 : 400);
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new GoldenError(`${label} 返回了无效 JSON`, 502);
    }
  } finally {
    clearTimeout(timer);
  }
}

function stringOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(object, keys) {
  for (const key of keys) {
    const value = stringOf(object?.[key]);
    if (value) return value;
  }
  return '';
}

function numberOf(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedOption(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pageOf(chunk) {
  if (typeof chunk?.page === 'number' && chunk.page > 0) return String(chunk.page);
  if (typeof chunk?.page_num === 'number' && chunk.page_num > 0) return String(chunk.page_num);
  const direct = firstString(chunk, ['page', 'page_num', 'page_number']);
  if (direct) return direct;
  const positions = chunk?.positions;
  if (Array.isArray(positions) && Array.isArray(positions[0]) && positions[0].length) {
    const page = Number(positions[0][0]);
    if (Number.isFinite(page) && page > 0) return String(page);
  }
  return '';
}

function booleanOption(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value === undefined || value === null || value === '' ? null : false;
}

function chunkAvailability(chunk, fallback = {}) {
  const available = booleanOption(chunk?.available)
    ?? booleanOption(chunk?.available_int)
    ?? booleanOption(fallback.available)
    ?? booleanOption(fallback.available_int)
    ?? true;
  return { available, available_int: available ? 1 : 0 };
}

function normalizeChunk(chunk, fallback = {}) {
  const documentId = firstString(chunk, ['document_id', 'doc_id']) || fallback.document_id || '';
  const documentName = firstString(chunk, ['docnm_kwd', 'document_name', 'doc_name']) || fallback.document_name || '';
  return {
    chunk_id: firstString(chunk, ['id', 'chunk_id']),
    content: firstString(chunk, ['content', 'content_with_weight']),
    similarity: optionalNumber(chunk?.similarity ?? chunk?.score),
    dataset_id: firstString(chunk, ['dataset_id']) || fallback.dataset_id || '',
    document_id: documentId,
    document_name: documentName,
    page: pageOf(chunk) || fallback.page || '',
    source: 'ragflow',
    ...chunkAvailability(chunk, fallback),
  };
}

function requireRagflow(config) {
  if (!config.ragflowBaseUrl || !config.ragflowApiKey) {
    throw new GoldenError('RAGFlow 未配置，请在 golden.env 填写 RAGFLOW_BASE_URL / RAGFLOW_API_KEY', 503);
  }
}

async function ragflowSearch(config, { query, datasetIds, topK }) {
  requireRagflow(config);
  const ids = (Array.isArray(datasetIds) && datasetIds.length ? datasetIds : config.datasets.map((item) => item.id))
    .map((id) => String(id).trim())[REDACTED];
  if (!ids.length) throw new GoldenError('未配置 RAGFlow 数据集', 503);
  const limit = Math.min(50, Math.max(1, Number(topK) || 12));
  const startedAt = Date.now();
  const payload = await requestJson(ragflowUrl(config, '/retrieval'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ragflowApiKey}` },
    body: { question: query, dataset_ids: ids, top_k: limit, page_size: limit },
    label: 'RAGFlow 检索',
  });
  if (Number(payload?.code) !== 0) {
    throw new GoldenError(`RAGFlow 检索失败：${payload?.message || payload?.code}`, 502);
  }
  const docAggs = new Map();
  for (const item of payload?.data?.doc_aggs || []) {
    const id = firstString(item, ['doc_id', 'document_id']);
    const name = firstString(item, ['doc_name', 'document_name']);
    if (id && name) docAggs.set(id, name);
  }
  const chunks = (Array.isArray(payload?.data?.chunks) ? payload.data.chunks : [])
    .map((chunk) => normalizeChunk(chunk, { dataset_id: ids.length === 1 ? ids[0] : '' }))
    .filter((chunk) => chunk.chunk_id && chunk.content)
    .map((chunk) => ({ ...chunk, document_name: chunk.document_name || docAggs.get(chunk.document_id) || '' }))
    .slice(0, limit);
  return { chunks, dataset_ids: ids, top_k: limit, latency_ms: Date.now() - startedAt };
}

async function ragflowDocumentChunks(config, { datasetId, documentId, page = 1, pageSize = 100, keywords = '' }) {
  requireRagflow(config);
  const dataset = stringOf(datasetId) || config.datasets[0]?.id;
  if (!dataset) throw new GoldenError('未指定 RAGFlow 数据集', 400);
  if (!stringOf(documentId)) throw new GoldenError('缺少 document_id', 400);
  const query = new URLSearchParams({ page: String(page), page_size: String(Math.min(100, Math.max(1, pageSize))) });
  if (keywords) query.set('keywords', keywords);
  const payload = await requestJson(
    ragflowUrl(config, `/datasets/${encodeURIComponent(dataset)}/documents/${encodeURIComponent(documentId)}/chunks?${query}`),
    { headers: { Authorization: `Bearer ${config.ragflowApiKey}` }, label: 'RAGFlow 文档 Chunk' },
  );
  if (Number(payload?.code) !== 0) throw new GoldenError(`RAGFlow 读取 Chunk 失败：${payload?.message || payload?.code}`, 502);
  const documentName = firstString(payload?.data?.doc || {}, ['name', 'document_name', 'doc_name']);
  const chunks = (Array.isArray(payload?.data?.chunks) ? payload.data.chunks : []).map((chunk) => normalizeChunk(chunk, {
    dataset_id: dataset,
    document_id: documentId,
    document_name: documentName,
  }));
  return {
    dataset_id: dataset,
    document_id: documentId,
    document_name: documentName,
    chunks,
    total: Number(payload?.data?.total || chunks.length),
    page: Number(page),
    page_size: Number(pageSize),
  };
}

async function ragflowSetChunkAvailability(config, { datasetId, documentId, chunkIds, available }) {
  const dataset = stringOf(datasetId);
  const document = stringOf(documentId);
  if (!dataset || !document) throw new GoldenError('缺少 dataset_id 或 document_id', 400);
  if (typeof available !== 'boolean') throw new GoldenError('available 必须是布尔值', 400);
  if (!Array.isArray(chunkIds) || !chunkIds.length || chunkIds.some((id) => !stringOf(id))) {
    throw new GoldenError('chunk_ids 必须是非空字符串数组', 400);
  }
  requireRagflow(config);
  const ids = chunkIds.map((id) => stringOf(id));
  const payload = await requestJson(
    ragflowUrl(config, `/datasets/${encodeURIComponent(dataset)}/documents/${encodeURIComponent(document)}/chunks`),
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.ragflowApiKey}` },
      body: { chunk_ids: ids, available_int: available ? 1 : 0 },
      label: 'RAGFlow Chunk 可用性',
    },
  );
  if (Number(payload?.code) !== 0) {
    throw new GoldenError(`RAGFlow 更新 Chunk 可用性失败：${payload?.message || payload?.code}`, 502);
  }
  return {
    dataset_id: dataset,
    document_id: document,
    chunk_ids: ids,
    available,
  };
}

function chatUrl(base) {
  const trimmed = base.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function suggestionPrompt(facts, seedText, count) {
  const factLines = facts.map((fact) => `${fact.fact_id} ${fact.statement}`).join('\n');
  const seed = seedText ? `\n已有主问（保留原意，不要照抄）：${seedText}` : '';
  return [
    '你是 RAG 评测数据集的 Query 标注助手。',
    '基于下面的人工事实，写出真实用户可能提出的问题。',
    '要求：',
    '1. canonical 覆盖全部关键限定（对象、数字、单位、条件、否定），不得引入事实之外的信息。',
    '2. 变体包含同义句（paraphrase）、客服场景口语化问法（colloquial）和同主题追问（follow_up）。',
    '3. 不改变数字、单位、适用条件和否定；不要写“根据资料”这类套话。',
    `4. 生成 1 条 canonical 和最多 ${count} 条变体，句子长度不超过 60 字。`,
    '只输出 JSON，格式：',
    '{"canonical":"...","variants":[{"text":"...","variant_type":"paraphrase|colloquial|follow_up","rationale":"..."}]}',
    '',
    '事实：',
    factLines,
    seed,
  ].join('\n');
}

async function suggestQueries(config, { facts, seedText, count, existingTexts }) {
  if (!config.llmBaseUrl || !config.llmModel) {
    throw new GoldenError('LLM 未配置，请在 golden.env 填写 LLM_BASE_URL / LLM_MODEL', 503);
  }
  const payload = await requestJson(chatUrl(config.llmBaseUrl), {
    method: 'POST',
    headers: config.llmApiKey ? { Authorization: `Bearer ${config.llmApiKey}` } : {},
    body: {
      model: config.llmModel,
      temperature: 0.4,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: '你是严谨的 RAG 评测数据标注助手，只输出 JSON。' },
        { role: 'user', content: suggestionPrompt(facts, seedText, count) },
      ],
    },
    label: 'LLM',
  });
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new GoldenError('LLM 未返回内容', 502);
  return parseSuggestions(content, existingTexts);
}

function evidencePolishPrompt({ fact, title, excerpt, chunks }) {
  const sourceLines = chunks.map((chunk, index) => [
    `[${index + 1}] ${chunk.chunk_id}`,
    chunk.document_name || chunk.document_id || '未命名文档',
    String(chunk.content || '').slice(0, 4000),
  ].join('\n')).join('\n\n');
  return [
    '你是 RAG 评测数据集的 Evidence 标注助手。润色人工填写的标题和摘录，让它们准确支撑目标 Fact。',
    '要求：',
    '1. 只能使用来源原文中的事实，不得新增数值、结论、适应症、禁忌或来源没有的信息。',
    '2. 保留所有数字、单位、对象、条件、时间、否定和限定语义；不确定时保持原文。',
    '3. 摘录优先整理人工已填文本，可修正语病、去除重复和无关句；来源原文用于核对。',
    '4. 标题概括一条可核验事实，不超过 60 个中文字。',
    '5. 只输出 JSON 对象，格式：{"title":"...","excerpt":"..."}。',
    '',
    `目标 Fact：${fact.fact_id} ${fact.statement}`,
    `人工标题：${title || '（空）'}`,
    `人工摘录：${excerpt || '（空）'}`,
    '',
    '来源 Chunk：',
    sourceLines || '（无）',
  ].join('\n');
}

async function polishEvidenceDraft(config, input) {
  if (!config.llmBaseUrl || !config.llmModel) {
    throw new GoldenError('LLM 未配置，请在 golden.env 填写 LLM_BASE_URL / LLM_MODEL', 503);
  }
  const payload = await requestJson(chatUrl(config.llmBaseUrl), {
    method: 'POST',
    headers: config.llmApiKey ? { Authorization: `Bearer ${config.llmApiKey}` } : {},
    body: {
      model: config.llmModel,
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: '你是严谨的 RAG 评测数据标注助手，只输出 JSON。' },
        { role: 'user', content: evidencePolishPrompt(input) },
      ],
    },
    label: 'LLM',
  });
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new GoldenError('LLM 未返回内容', 502);
  return parseEvidenceDraftPolish(content, { title: input.title, excerpt: input.excerpt });
}

function stateBundle() {
  const state = readState(VERSION);
  const config = loadConfig();
  return {
    ...state,
    config: publicConfig(config),
    taxonomy: {
      topics: [...new Set(state.facts.map((row) => row.topic)[REDACTED])]
        .map((name) => ({ id: '', name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      fact_types: [...new Set(state.facts.map((row) => row.fact_type)[REDACTED])]
        .concat(state.facts.some((row) => row.fact_type) ? [] : ['general'])
        .map((id) => ({ id, label: id })),
    },
    gaps: coverageGaps(state),
  };
}

async function handle(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/golden/state') {
    return send(res, 200, stateBundle());
  }

  if (req.method === 'GET' && url.pathname === '/api/golden/evidence/inventory') {
    const state = readState(VERSION);
    return send(res, 200, { inventory: evidenceInventory(state), config: publicConfig(loadConfig()) });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/golden/entities/')) {
    const type = url.pathname.split('/')[4];
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => {
      const saved = upsertEntity(state, type, body);
      if (type === 'queries' && Array.isArray(body.fact_ids)) {
        applyQueryFacts(state, saved.row.query_id, body.fact_ids);
      }
      return saved;
    });
    return send(res, 200, { ...result, state: stateBundle() });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/golden/entities/')) {
    const parts = url.pathname.split('/');
    const type = parts[4];
    const id = decodeURIComponent(parts.slice(5).join('/'));
    const result = mutate(VERSION, (state) => deleteEntity(state, type, id));
    return send(res, 200, { ...result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/links/query-facts') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => applyQueryFacts(state, String(body.query_id || ''), body.facts || body.fact_ids || []));
    return send(res, 200, { links: result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/query-facts/manage') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => applyQueryFactManagement(
      state,
      String(body.query_id || ''),
      body.facts || [],
      body.fact_statuses || [],
    ));
    return send(res, 200, { ...result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/links/fact-evidence') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => applyFactEvidence(
      state,
      String(body.fact_id || ''),
      body.evidence_ids || [],
      body.operator || 'OR',
    ));
    return send(res, 200, { link: result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/links/evidence-chunks') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => applyEvidenceChunks(
      state,
      String(body.evidence_id || ''),
      body.chunk_ids || [],
    ));
    return send(res, 200, { link: result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/evidence') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => createEvidence(state, body));
    return send(res, 200, { ...result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/queries/draft') {
    const body = await safeBody(req);
    const state = readState(VERSION);
    const factIds = (Array.isArray(body.fact_ids) ? body.fact_ids : []).map((id) => String(id).trim())[REDACTED];
    const facts = state.facts.filter((fact) => factIds.includes(fact.fact_id));
    if (!facts.length) throw new GoldenError('请先选择至少一条 Fact', 400);
    const count = Math.min(8, Math.max(1, Number(body.count) || 5));
    const config = loadConfig();
    const candidates = await suggestQueries(config, {
      facts,
      seedText: String(body.seed_text || '').trim(),
      count,
      existingTexts: state.queries.map((query) => query.text),
    });
    return send(res, 200, { candidates, model: config.llmModel, facts: facts.map((fact) => fact.fact_id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/evidence/polish') {
    const body = await safeBody(req);
    const state = readState(VERSION);
    const factId = stringOf(body.fact_id);
    const fact = state.facts.find((row) => row.fact_id === factId);
    if (!fact) throw new GoldenError('目标 Fact 不存在', 400);
    const title = stringOf(body.title);
    const excerpt = stringOf(body.excerpt);
    if (!title && !excerpt) throw new GoldenError('请先填写标题或摘录，再让 LLM 润色', 400);
    const chunks = (Array.isArray(body.chunks) ? body.chunks : [])
      .map((chunk) => ({
        chunk_id: stringOf(chunk?.chunk_id),
        document_name: stringOf(chunk?.document_name),
        document_id: stringOf(chunk?.document_id),
        content: stringOf(chunk?.content),
      }))
      .filter((chunk) => chunk.chunk_id && chunk.content)
      .slice(0, 8);
    const config = loadConfig();
    const draft = await polishEvidenceDraft(config, { fact, title, excerpt, chunks });
    return send(res, 200, { ...draft, model: config.llmModel });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/queries/bulk') {
    const body = await safeBody(req);
    const result = mutate(VERSION, (state) => createQueryBundle(state, body));
    return send(res, 200, { ...result, state: stateBundle() });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/ragflow/search') {
    const body = await safeBody(req);
    const query = String(body.query || '').trim();
    if (!query) throw new GoldenError('请输入检索关键词或问题', 400);
    const result = await ragflowSearch(loadConfig(), {
      query,
      datasetIds: body.dataset_ids,
      topK: body.top_k,
    });
    return send(res, 200, result);
  }

  if (req.method === 'GET' && /^\/api\/golden\/ragflow\/documents\/[^/]+\/chunks$/.test(url.pathname)) {
    const documentId = decodeURIComponent(url.pathname.split('/')[5]);
    const result = await ragflowDocumentChunks(loadConfig(), {
      datasetId: url.searchParams.get('dataset_id') || '',
      documentId,
      page: Number(url.searchParams.get('page') || 1),
      pageSize: Number(url.searchParams.get('page_size') || 100),
      keywords: url.searchParams.get('keywords') || '',
    });
    return send(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/ragflow/chunks/availability') {
    const body = await safeBody(req);
    const result = await ragflowSetChunkAvailability(loadConfig(), {
      datasetId: stringOf(body.dataset_id),
      documentId: stringOf(body.document_id),
      chunkIds: body.chunk_ids,
      available: body.available,
    });
    return send(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/recall') {
    const body = await safeBody(req);
    const state = readState(VERSION);
    const query = state.queries.find((row) => row.query_id === body.query_id);
    if (!query) throw new GoldenError(`query ${body.query_id} not found`, 404);
    const retrieval = await ragflowSearch(loadConfig(), {
      query: query.text,
      datasetIds: body.dataset_ids,
      topK: body.top_k,
    });
    const report = assessRecall(state, query.query_id, retrieval.chunks.map((chunk) => chunk.chunk_id), retrieval.top_k, retrieval.latency_ms);
    return send(res, 200, { query_id: query.query_id, retrieval, report });
  }

  if (req.method === 'POST' && url.pathname === '/api/golden/evidence/auto-match') {
    const body = await safeBody(req);
    const state = readState(VERSION);
    const queryId = stringOf(body.query_id);
    const factId = stringOf(body.fact_id);
    const queryText = stringOf(body.query_text);

    let query = queryId ? state.queries.find((row) => row.query_id === queryId) : null;
    if (queryId && !query) throw new GoldenError(`query ${queryId} not found`, 404);
    if (!query && factId) {
      const link = state.query_facts.find((row) => row.fact_id === factId && state.queries
        .some((item) => item.query_id === row.query_id));
      if (!link) throw new GoldenError(`fact ${factId} is not linked to a query`, 404);
      query = state.queries.find((row) => row.query_id === link.query_id);
    }
    if (!query && queryText) query = { query_id: '', text: queryText };
    if (!query) throw new GoldenError('请提供 query_id、fact_id 或 query_text', 400);
    const matchQueryId = query.query_id || '__query_text__';

    const topK = Math.trunc(boundedOption(body.top_k, 1, 50, 12));
    const minSimilarity = boundedOption(body.min_similarity, 0, 1, 0);
    const retrieval = await ragflowSearch(loadConfig(), {
      query: query.text,
      datasetIds: Array.isArray(body.dataset_ids) ? body.dataset_ids : undefined,
      topK,
    });
    const matchState = state.queries.some((row) => row.query_id === matchQueryId)
      ? state
      : { ...state, queries: [...state.queries, { query_id: matchQueryId, text: query.text }] };
    const matched = autoMatchQuery(matchState, matchQueryId, retrieval.chunks, {
      topK,
      minSimilarity,
    });
    return send(res, 200, {
      query_id: matched.query_id === '__query_text__' ? '' : matched.query_id,
      query_text: matched.query_text,
      fact_ids: matched.fact_ids,
      inventory: evidenceInventory(state),
      retrieval: {
        dataset_ids: retrieval.dataset_ids,
        top_k: retrieval.top_k,
        latency_ms: retrieval.latency_ms,
      },
      candidates: matched.candidates,
    });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(STATIC_DIR, 'index.html')), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && /^\/(app|api)\.js$|^\/styles\.css$/.test(url.pathname)) {
    const file = path.join(STATIC_DIR, url.pathname.slice(1));
    if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
    return send(res, 200, fs.readFileSync(file), type);
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    await handle(req, res, url);
  } catch (error) {
    if (error instanceof GoldenError) {
      return send(res, error.status, { error: error.message, details: error.details });
    }
    console.error(error);
    return send(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, BIND_ADDRESS, () => {
  const config = loadConfig();
  console.log(`Golden dataset review: http://${BIND_ADDRESS}:${PORT}/`);
  console.log('Golden data: separately provisioned directory');
  console.log(`RAGFlow: ${config.ragflowBaseUrl ? '已配置' : '未配置'} | LLM: ${config.llmModel ? '已配置' : '未配置'}`);
});
