[REDACTED]
[REDACTED]
import { goldenDir, readState } from './golden.mjs';

const CLAIM_FILE = 'query-claims.jsonl';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

class QueryClaimError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'QueryClaimError';
    this.status = status;
  }
}

function errorMessage(message, status = 422) {
  return new QueryClaimError(message, status);
}

function clean(value) {
  return String(value ?? '').trim();
}

function claimsPath(version) {
  return path.join(goldenDir(version), CLAIM_FILE);
}

export function readClaims(version) {
  const file = claimsPath(version);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw errorMessage(`${CLAIM_FILE}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

function writeClaims(version, rows) {
  const file = claimsPath(version);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const content = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  fs.writeFileSync(temp, content, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function activeClaim(rows, queryId, nowMs) {
  return rows.find((row) => row.subject_type === 'query'
    && row.subject_id === queryId
    && Date.parse(row.expires_at) > nowMs);
}

function ttlMs(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TTL_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw errorMessage('ttl_seconds must be a number');
  const milliseconds = Math.round(parsed * 1000);
  if (milliseconds < MIN_TTL_MS || milliseconds > MAX_TTL_MS) {
    throw errorMessage('ttl_seconds must be between 60 and 86400');
  }
  return milliseconds;
}

export function claimsState(version, now = new Date()) {
  const nowMs = now.getTime();
  const claims = readClaims(version)
    .filter((row) => row?.schema_version === 'golden-query-claim/v1'
      && row.subject_type === 'query'
      && typeof row.subject_id === 'string'
      && Number.isFinite(Date.parse(row.expires_at)))
    .map((row) => ({
      ...row,
      active: Date.parse(row.expires_at) > nowMs,
    }));
  const byQueryId = new Map();
  for (const claim of claims) {
    if (claim.active && !byQueryId.has(claim.subject_id)) byQueryId.set(claim.subject_id, claim);
  }
  return { claims, byQueryId, now: now.toISOString() };
}

export function claimQuery(version, input = {}, now = new Date()) {
  const queryId = clean(input.query_id);
  const owner = clean(input.owner);
  if (!queryId) throw errorMessage('query_id is required');
  if (!owner) throw errorMessage('owner is required');
  if (!readState(version).queries.some((row) => row.query_id === queryId)) {
    throw errorMessage(`unknown query_id ${queryId}`, 404);
  }
  const duration = ttlMs(input.ttl_seconds);
  const rows = readClaims(version);
  const nowMs = now.getTime();
  const existing = activeClaim(rows, queryId, nowMs);
  if (existing) {
    if (existing.owner !== owner) throw errorMessage(`query ${queryId} is claimed by ${existing.owner}`, 409);
    return { claim: existing, created: false };
  }
  const claim = {
    schema_version: 'golden-query-claim/v1',
    subject_type: 'query',
    subject_id: queryId,
    owner,
    claimed_at: now.toISOString(),
    expires_at: new Date(nowMs + duration).toISOString(),
  };
  const nextRows = rows.filter((row) => !(row?.subject_type === 'query' && row.subject_id === queryId));
  nextRows.push(claim);
  writeClaims(version, nextRows);
  return { claim, created: true };
}

export function renewQueryClaim(version, input = {}, now = new Date()) {
  const queryId = clean(input.query_id);
  const owner = clean(input.owner);
  if (!queryId) throw errorMessage('query_id is required');
  if (!owner) throw errorMessage('owner is required');
  const duration = ttlMs(input.ttl_seconds);
  const rows = readClaims(version);
  const nowMs = now.getTime();
  const existing = activeClaim(rows, queryId, nowMs);
  const existingIndex = rows.findIndex((row) => row === existing);
  if (!existing) throw errorMessage(`query ${queryId} has no active claim`, 409);
  if (existing.owner !== owner) throw errorMessage(`query ${queryId} is claimed by ${existing.owner}`, 409);
  const claim = {
    ...existing,
    expires_at: new Date(nowMs + duration).toISOString(),
  };
  rows[existingIndex] = claim;
  writeClaims(version, rows);
  return { claim, created: false };
}

export function releaseQueryClaim(version, input = {}, now = new Date()) {
  const queryId = clean(input.query_id);
  const owner = clean(input.owner);
  if (!queryId) throw errorMessage('query_id is required');
  if (!owner) throw errorMessage('owner is required');
  const rows = readClaims(version);
  const existing = activeClaim(rows, queryId, now.getTime());
  if (!existing || existing.owner === owner) {
    const nextRows = rows.filter((row) => !(row?.subject_type === 'query' && row.subject_id === queryId));
    if (nextRows.length !== rows.length) writeClaims(version, nextRows);
    return { released: Boolean(existing), created: false };
  }
  throw errorMessage(`query ${queryId} is claimed by ${existing.owner}`, 409);
}
