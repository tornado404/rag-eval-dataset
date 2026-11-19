export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? payload.error : payload;
    const details = payload && typeof payload === 'object' && Array.isArray(payload.details)
      ? payload.details
      : [];
    throw new ApiError(message || `请求失败（HTTP ${response.status}）`, response.status, details);
  }
  return payload;
}

function post(path, body) {
  return request(path, { method: 'POST', body });
}

export function getState() {
  return request('/api/golden/state');
}

export function getEvidenceInventory() {
  return request('/api/golden/evidence/inventory');
}

export function autoMatchEvidence(body) {
  return post('/api/golden/evidence/auto-match', body);
}

export function saveEntity(type, body) {
  return post(`/api/golden/entities/${encodeURIComponent(type)}`, body);
}

export function deleteEntity(type, id) {
  return request(`/api/golden/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function linkQueryFacts(queryId, facts) {
  return post('/api/golden/links/query-facts', { query_id: queryId, facts });
}

export function manageQueryFacts(queryId, facts, factStatuses = []) {
  return post('/api/golden/query-facts/manage', {
    query_id: queryId,
    facts,
    fact_statuses: factStatuses,
  });
}

export function linkFactEvidence(factId, evidenceIds, operator = 'OR') {
  return post('/api/golden/links/fact-evidence', {
    fact_id: factId,
    evidence_ids: evidenceIds,
    operator,
  });
}

export function linkEvidenceChunks(evidenceId, chunkIds) {
  return post('/api/golden/links/evidence-chunks', {
    evidence_id: evidenceId,
    chunk_ids: chunkIds,
  });
}

export function createEvidence(body) {
  return post('/api/golden/evidence', body);
}

export function draftQueries(body) {
  return post('/api/golden/queries/draft', body);
}

export function createQueryBundle(body) {
  return post('/api/golden/queries/bulk', body);
}

export function searchRagflow(body) {
  return post('/api/golden/ragflow/search', body);
}

export function getDocumentChunks(documentId, { datasetId = '', page = 1, pageSize = 100, keywords = '' } = {}) {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (datasetId) query.set('dataset_id', datasetId);
  if (keywords) query.set('keywords', keywords);
  return request(`/api/golden/ragflow/documents/${encodeURIComponent(documentId)}/chunks?${query}`);
}

export function runRecall(body) {
  return post('/api/golden/recall', body);
}
