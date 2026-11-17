[REDACTED]

const baseUrl = String(process.env.RAGFLOW_BASE_URL || '').replace(/\/$/, '');
const apiKey = String(process.env.RAGFLOW_API_KEY || '').trim();
const datasetIds = String(process.env.RAGFLOW_DATASET_IDS || '')
  .split(/[\s,，]+/)
  .map((value) => value.trim())
  [REDACTED];
const output = process.argv[2] || '';

if (!baseUrl || !apiKey || !datasetIds.length || !output) {
  console.error('usage: RAGFLOW_BASE_URL=... RAGFLOW_API_KEY=... RAGFLOW_DATASET_IDS=id1,id2 node scripts/dump_ragflow_chunks.mjs output.jsonl');
  [REDACTED]
}

const PAGE_SIZE = 100;
const CONCURRENCY = 4;

async function request(path) {
  const url = new URL(path, `${baseUrl}/`);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(120_000),
      });
      [REDACTED]
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`invalid JSON from ${path}: ${text.slice(0, 160)}`);
      }
      if (!response.ok || Number(payload?.code) !== 0) {
        throw new Error(`HTTP ${response.status} code=${payload?.code}: ${payload?.message || text.slice(0, 160)}`);
      }
      return payload;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function listDocuments(datasetId) {
  const documents = [];
  for (let page = 1; ; page += 1) {
    const payload = await request(`/api/v1/datasets/${datasetId}/documents?page=${page}&page_size=${PAGE_SIZE}`);
    const batch = payload?.data?.docs || payload?.data || [];
    documents.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return documents;
}

async function listChunks(datasetId, document) {
  const chunks = [];
  for (let page = 1; ; page += 1) {
    const payload = await request(
      `/api/v1/datasets/${datasetId}/documents/${document.id}/chunks?page=${page}&page_size=${PAGE_SIZE}`,
    );
    const batch = payload?.data?.chunks || payload?.data || [];
    chunks.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return chunks.map((chunk) => ({
    dataset_id: datasetId,
    document_id: String(document.id || chunk.document_id || ''),
    document_name: String(document.name || chunk.docnm_kwd || ''),
    chunk_id: String(chunk.id || chunk.chunk_id || ''),
    available: chunk.available !== false,
    content: String(chunk.content || ''),
  })).filter((chunk) => chunk.chunk_id);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const stream = fs.createWriteStream(output, { flags: 'w' });
let total = 0;
for (const datasetId of datasetIds) {
  const documents = await listDocuments(datasetId);
  const batches = await mapLimit(documents, CONCURRENCY, async (document) => {
    const chunks = await listChunks(datasetId, document);
    process.stderr.write(`dataset=${datasetId} doc=${document.name} chunks=${chunks.length}\n`);
    return chunks;
  });
  for (const chunks of batches) {
    for (const chunk of chunks) {
      stream.write(`${JSON.stringify(chunk)}\n`);
      total += 1;
    }
  }
}
await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
[REDACTED] output, datasets: datasetIds.length, chunks: total }));
