const DB_NAME = 'rag-eval-editor-reports';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
const MAX_REPORTS = 50;

export const REPORT_HISTORY_LIMIT = MAX_REPORTS;

let connectionPromise = null;

function openDatabase() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB，无法保存历史报告'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'run_id' });
        store.createIndex('finished_at', 'finished_at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开报告历史库失败'));
  }).catch((error) => {
    connectionPromise = null;
    throw error;
  });
  return connectionPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('报告历史操作失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('报告历史事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('报告历史事务被中止'));
  });
}

function historyEntry(report) {
  if (!report || typeof report !== 'object' || !report.run_id) {
    throw new Error('报告缺少 run_id，无法保存');
  }
  const storedAt = new Date().toISOString();
  return {
    ...structuredClone(report),
    stored_at: storedAt,
    storage_schema_version: 'report-history/v1',
  };
}

export async function saveReport(report) {
  const database = await openDatabase();
  const entry = historyEntry(report);
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  await requestResult(store.put(entry));
  const keys = await requestResult(store.getAllKeys());
  if (keys.length > MAX_REPORTS) {
    const records = await requestResult(store.getAll());
    records.sort((left, right) => String(right.stored_at || right.finished_at || '').localeCompare(String(left.stored_at || left.finished_at || '')));
    for (const record of records.slice(MAX_REPORTS)) {
      store.delete(record.run_id);
    }
  }
  await transactionDone(transaction);
  return entry;
}

function projectEntry(entry) {
  const { report_digest: reportDigest, ...report } = entry;
  return {
    [REDACTED]
    report_digest: reportDigest,
    stored_at: entry.stored_at,
    storage_schema_version: entry.storage_schema_version,
    [REDACTED]
    target: report.target,
    mode: report.mode,
    dataset_version: report.dataset_version,
    [REDACTED]
    [REDACTED]
    cases_total: report.cases_total,
    warning_count: Array.isArray(report.warnings) ? report.warnings.length : 0,
    run: report.run,
    dataset: report.dataset,
    evaluation: report.evaluation,
    summary: report.summary,
  };
}

export async function listReports() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  return records
    .map(projectEntry)
    .sort((left, right) => String(right.stored_at || '').localeCompare(String(left.stored_at || '')))
    .slice(0, MAX_REPORTS);
}

export async function getReport(runId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const entry = await requestResult(transaction.objectStore(STORE_NAME).get(runId));
  if (!entry) throw new Error('报告不存在，可能已被删除');
  const { stored_at: storedAt, storage_schema_version: storageSchemaVersion, ...report } = entry;
  return report;
}

export async function deleteReport(runId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).delete(runId));
  await transactionDone(transaction);
}

export async function clearReports() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).clear());
  await transactionDone(transaction);
}
