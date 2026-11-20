import * as api from './api.js';

const SCREENS = new Set(['workbench', 'fact-review', 'builder', 'queries', 'facts', 'evidence', 'overview']);
const VARIANT_LABELS = {
  canonical: '主问',
  paraphrase: '同义句',
  colloquial: '口语化',
  follow_up: '追问',
};
const STATUS_LABELS = {
  draft: '草稿',
  review: '待复核',
  approved: '已确认',
};
const CLAIM_STORAGE_KEY = 'rag-eval-dataset.golden.reviewer';
const BEHAVIOR_LABELS = {
  answer: '应回答',
  refuse: '应拒答',
  clarify: '应澄清',
};
const REQUIREMENT_LABELS = {
  required: '必需',
  required_any: '任选组',
  optional: '可选',
  forbidden: '禁止',
};
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  left: '<path d="m14.5 6.5-5 5.5 5 5.5"/>',
  right: '<path d="m9.5 6.5 5 5.5-5 5.5"/>',
  edit: '<path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.4 2.8 2.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10.2 13.8a4 4 0 0 0 5.6 0l2.8-2.8a4 4 0 0 0-5.6-5.6L11.8 6.6"/><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-2.8 2.8a4 4 0 0 0 5.6 5.6l1.2-1.2"/>',
  doc: '<path d="M7 3.8h6.5L18 8.3v11.9H7V3.8Z"/><path d="M13.2 3.8v4.8h4.6M9.5 12h6M9.5 15h6M9.5 18h4"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 6.8"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  sparkle: '<path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m18.3 14 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"/>',
  eye: '<path d="M2.8 12s3.2-6 9.2-6 9.2 6 9.2 6-3.2 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  refresh: '<path d="M19 8V4l-2 2a7 7 0 1 0 2.2 8"/><path d="M19 4h-4"/>',
  trash: '<path d="M5 7h14M9 7V4.5h6V7M7.5 7l.8 13h7.4l.8-13M10 10.5v6M14 10.5v6"/>',
  external: '<path d="M13 5h6v6M19 5l-8 8"/><path d="M17 14v4.5H5.5v-12H10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v5M12 7.5h.01"/>',
  alert: '<path d="M12 3.5 21 20H3l9-16.5Z"/><path d="M12 9v4.5M12 17h.01"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/><path d="M5 11.5v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  fact: '<path d="M6 4h9l3 3v13H6V4Z"/><path d="M9 9h6M9 12h6M9 15h4"/>',
  query: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M8.5 9.2a2.7 2.7 0 1 1 4.3 2.2c-1 .8-1.3 1.2-1.3 2.2M11.5 16h.01"/>',
  chart: '<path d="M5 19V9M10 19V5M15 19v-7M20 19V7"/>',
  arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
  chunk: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};

const app = document.querySelector('.app-shell');
const view = document.querySelector('#view');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
const connectionPill = document.querySelector('#connection-pill');

const ui = {
  data: null,
  index: null,
  screen: 'workbench',
  queryId: '',
  factId: '',
  centerTab: 'evidence',
  search: '',
  topK: 12,
  filters: { status: '', document: '', topic: '', source: '' },
  remoteChunks: [],
  remoteSearchTerm: '',
  remoteMeta: null,
  remoteLoading: false,
  selectedEvidenceIds: new Set(),
  selectedChunkIds: new Set(),
  previewEvidenceId: '',
  previewChunkId: '',
  editorDraft: null,
  relationOperator: 'OR',
  querySearch: '',
  queryStatus: '',
  queryClaimFilter: '',
  reviewerName: '',
  queryReview: null,
  factSearch: '',
  overviewSearch: '',
  factDraft: null,
  builder: emptyBuilder(),
  evidenceWorkspace: emptyEvidenceWorkspace(),
  modal: null,
  recall: null,
  toasts: [],
  loading: true,
  loadError: '',
  busy: false,
};

let toastSequence = 0;
let candidateSequence = 0;

try {
  ui.reviewerName = localStorage.getItem(CLAIM_STORAGE_KEY) || '';
} catch {
  ui.reviewerName = '';
}

function queryClaim(queryId) {
  return (ui.data?.query_claims || []).find((claim) => claim.subject_id === queryId && claim.active);
}

function setReviewerName(name) {
  ui.reviewerName = text(name).slice(0, 40);
  try {
    if (ui.reviewerName) localStorage.setItem(CLAIM_STORAGE_KEY, ui.reviewerName);
    else localStorage.removeItem(CLAIM_STORAGE_KEY);
  } catch {
  }
}

function requireReviewerName() {
  return promptReviewerName('');
}

function promptReviewerName(message) {
  setModal({
    type: 'reviewer-name',
    value: '',
    error: message || '请先填写你的显示名，其他人会据此看到领取状态。',
  });
  return '';
}

function emptyBuilder(overrides = {}) {
  return {
    seedText: '',
    expectedBehavior: 'answer',
    factSearch: '',
    candidateSearch: '',
    factLinks: [],
    candidates: [],
    model: '',
    generating: false,
    error: '',
    ...overrides,
  };
}

function emptyEvidenceWorkspace(overrides = {}) {
  return {
    inventory: null,
    config: null,
    datasetIds: [],
    queryId: '',
    queryText: '',
    factId: '',
    topK: 6,
    minSimilarity: 0.2,
    mode: 'keyword',
    keyword: '',
    keywordInput: '',
    candidates: [],
    candidatesByMode: { keyword: [], query: [] },
    selectedChunkIds: new Set(),
    selectedChunks: new Map(),
    selectionOrder: [],
    workflow: { direction: 'evidence', evidenceId: '', chunkId: '', search: '', filter: 'all', candidateSearch: '', evidenceTargetSearch: '', targetEvidenceId: '' },
    retrievalOpen: false,
    result: null,
    keywordLoading: false,
    expandedChunkId: '',
    loading: false,
    error: '',
    ...overrides,
  };
}

function normalizeCandidate(candidate, index = 0) {
  const chunkId = text(candidate?.chunk_id);
  if (!chunkId) return null;
  return {
    ...candidate,
    chunk_id: chunkId,
    dataset_id: text(candidate.dataset_id),
    document_id: text(candidate.document_id),
    document_name: text(candidate.document_name),
    page: candidate.page ?? '',
    content: text(candidate.content),
    similarity: candidate.similarity,
    matched_fact_ids: unique(Array.isArray(candidate.matched_fact_ids) ? candidate.matched_fact_ids : []),
    matched_evidence_ids: unique(Array.isArray(candidate.matched_evidence_ids) ? candidate.matched_evidence_ids : []),
    is_linked: Boolean(candidate.is_linked),
    source: text(candidate.source),
    localId: `auto-${index}-${chunkId}`,
  };
}

function configuredDatasetOptions() {
  const datasets = ui.evidenceWorkspace.config?.ragflow?.datasets
    || ui.data?.config?.ragflow?.datasets
    || [];
  return datasets
    .map((item, index) => ({
      id: text(typeof item === 'string' ? item : item.id),
      name: text(typeof item === 'string' ? item : item.name)
        || text(typeof item === 'string' ? item : item.id)
        || `数据集 ${index + 1}`,
    }))
    .filter((item) => item.id);
}

function evidenceQueryOptions() {
  const items = rows('queries').filter((row) => text(row.text));
  const seen = new Set();
  const result = [];
  for (const row of items) {
    const value = text(row.query_id);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({ id: value, text: text(row.text), selected: value === ui.queryId });
  }
  return result;
}

function evidenceFactOptions() {
  const byId = new Map();
  for (const item of factsOfQuery(ui.evidenceWorkspace.queryId || ui.queryId)) {
    byId.set(item.fact_id, item.fact.statement);
  }
  if (ui.evidenceWorkspace.candidates.length) {
    for (const candidate of ui.evidenceWorkspace.candidates) {
      for (const factId of candidate.matched_fact_ids) {
        if (fact(factId) && !byId.has(factId)) byId.set(factId, fact(factId).statement);
      }
    }
  }
  for (const row of rows('facts')) {
    if (!byId.has(row.fact_id) && text(row.statement)) byId.set(row.fact_id, row.statement);
  }
  return [...byId].map(([id, statement]) => ({
    id,
    text: `${id} · ${compactExcerpt(statement, 56)}`,
  }));
}

function selectedAutoMatchCandidates() {
  const workspace = ui.evidenceWorkspace;
  return workspace.selectionOrder
    .map((chunkId) => workspace.selectedChunks.get(chunkId))
    .filter(Boolean);
}

function setEvidenceMode(mode) {
  if (ui.busy) return;
  const workspace = ui.evidenceWorkspace;
  const nextMode = mode === 'query' ? 'query' : 'keyword';
  if (workspace.mode === nextMode) return;
  workspace.candidatesByMode[workspace.mode] = workspace.candidates;
  workspace.mode = nextMode;
  workspace.candidates = workspace.candidatesByMode[nextMode] || [];
  workspace.expandedChunkId = '';
  workspace.error = '';
  render();
}

function rememberEvidenceCandidates(candidates) {
  const workspace = ui.evidenceWorkspace;
  for (const candidate of candidates) {
    if (workspace.selectedChunkIds.has(candidate.chunk_id)) workspace.selectedChunks.set(candidate.chunk_id, candidate);
  }
}

function toggleEvidenceCandidate(chunkId, candidateOverride = null) {
  const workspace = ui.evidenceWorkspace;
  if (ui.busy || workspace.workflow.direction !== 'evidence' || chunkIdsOfEvidence(workspace.workflow.evidenceId).includes(chunkId)) return;
  const candidate = localChunk(chunkId) || workspace.candidates.find((item) => item.chunk_id === chunkId)
    || workspace.selectedChunks.get(chunkId)
    || candidateOverride;
  if (!candidate) return;
  if (workspace.selectedChunkIds.has(chunkId)) {
    workspace.selectedChunkIds.delete(chunkId);
    workspace.selectedChunks.delete(chunkId);
    workspace.selectionOrder = workspace.selectionOrder.filter((id) => id !== chunkId);
  } else {
    workspace.selectedChunkIds.add(chunkId);
    workspace.selectedChunks.set(chunkId, candidate);
    workspace.selectionOrder.push(chunkId);
  }
  render();
}

function clearEvidenceCandidates() {
  if (ui.busy) return;
  const workspace = ui.evidenceWorkspace;
  workspace.selectedChunkIds.clear();
  workspace.selectedChunks.clear();
  workspace.selectionOrder = [];
  render();
}

async function searchEvidenceKeywords() {
  const workspace = ui.evidenceWorkspace;
  if (ui.busy || workspace.keywordLoading) return;
  const mode = workspace.mode;
  const keyword = text(workspace.keywordInput);
  if (!keyword) {
    toast('请输入要查找的关键字', 'error');
    return;
  }
  if (!ui.data?.config?.ragflow?.configured) {
    toast('RAGFlow 未配置，请先在“上游服务配置”中检查', 'error');
    return;
  }
  workspace.keywordLoading = true;
  workspace.error = '';
  render();
  try {
    const result = await api.searchRagflow({
      query: keyword,
      top_k: workspace.topK,
      ...(workspace.datasetIds.length ? { dataset_ids: workspace.datasetIds } : {}),
    });
    const candidates = (Array.isArray(result?.chunks) ? result.chunks : [])
      .map(normalizeCandidate)
      .filter(Boolean);
    workspace.keyword = keyword;
    workspace.candidatesByMode.keyword = candidates;
    if (workspace.mode !== mode) return;
    workspace.candidates = candidates;
    workspace.result = { retrieval: result, mode: 'keyword' };
    rememberEvidenceCandidates(candidates);
    workspace.expandedChunkId = '';
    if (!candidates.length) workspace.error = '没有找到匹配 Chunk。可以改关键词、扩大数据集或提高 Top K。';
    render();
    if (candidates.length) toast(`“${keyword}”找到 ${candidates.length} 个 Chunk`, 'success');
  } catch (error) {
    workspace.candidatesByMode.keyword = [];
    if (workspace.mode !== mode) return;
    workspace.candidates = [];
    workspace.result = null;
    workspace.error = apiErrorText(error);
    render();
    toast(workspace.error, 'error');
  } finally {
    workspace.keywordLoading = false;
    render();
  }
}

function sendCandidatesToFactReview() {
  const workspace = ui.evidenceWorkspace;
  const candidates = selectedAutoMatchCandidates();
  if (!candidates.length) {
    toast('自动匹配没有返回可选择的候选 Chunk', 'info');
    return;
  }
  if (!fact(workspace.factId)) {
    toast('请先选择目标 Fact，再送入 Fact 审核台', 'info');
    return;
  }
  selectFact(workspace.factId, { resetEditor: false });
  ui.centerTab = 'chunk';
  ui.selectedChunkIds = new Set([...ui.selectedChunkIds, ...candidates.map((candidate) => candidate.chunk_id)]);
  ui.previewChunkId = candidates[0].chunk_id;
  const navigation = currentNavigationParams();
  navigate('fact-review', {
    query: navigation.query || ui.queryId,
    fact: workspace.factId,
    returnTo: navigation.returnTo || 'workbench',
    evidence: navigation.evidence,
  });
  render();
  toast(`已将 ${ui.selectedChunkIds.size} 个 Chunk 放入 Fact 审核台选区`, 'success');
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function attr(value) {
  return esc(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizeText(value) {
  return text(value).toLowerCase().replace(/[\s，。？?！!,.]/g, '');
}

function rows(name) {
  return ui.data?.[name] || [];
}

function query(id) {
  return ui.index?.queries.get(id) || null;
}

function fact(id) {
  return ui.index?.facts.get(id) || null;
}

function evidence(id) {
  return ui.index?.evidences.get(id) || null;
}

function localChunk(id) {
  return ui.index?.chunks.get(id) || null;
}

function findChunk(id) {
  return localChunk(id) || ui.remoteChunks.find((chunk) => chunk.chunk_id === id) || null;
}

function findEvidenceCandidate(id) {
  return ui.evidenceWorkspace.candidates.find((item) => item.chunk_id === id) || null;
}

function ragflowChunkAvailabilityRow(chunkId) {
  const workspace = ui.evidenceWorkspace;
  const records = [
    localChunk(chunkId),
    ...workspace.candidates,
    ...workspace.candidatesByMode.keyword,
    ...workspace.candidatesByMode.query,
    workspace.selectedChunks.get(chunkId),
    ui.remoteChunks.find((item) => item.chunk_id === chunkId),
  ].filter((item) => item?.chunk_id === chunkId);
  const ragflowRecords = records.filter((item) => text(item.source || 'ragflow') === 'ragflow');
  const target = ragflowRecords.find((item) => text(item.dataset_id) && text(item.document_id))
    || ragflowRecords[0];
  if (!target) return null;
  const availability = ragflowRecords.find((item) => item.available !== undefined || item.available_int !== undefined);
  return {
    ...target,
    dataset_id: text(target.dataset_id) || text(ragflowRecords.find((item) => text(item.dataset_id))?.dataset_id),
    document_id: text(target.document_id) || text(ragflowRecords.find((item) => text(item.document_id))?.document_id),
    ...(availability ? {
      available: availability.available,
      available_int: availability.available_int,
    } : {}),
  };
}

function chunkIsAvailable(row) {
  if (row?.available === true || row?.available === 1 || row?.available === '1') return true;
  if (row?.available_int === true || row?.available_int === 1 || row?.available_int === '1') return true;
  if (row?.available === false || row?.available === 0 || row?.available === '0') return false;
  if (row?.available_int === false || row?.available_int === 0 || row?.available_int === '0') return false;
  if (row?.available !== undefined || row?.available_int !== undefined) return false;
  return true;
}

function availabilityButton(row, className = '') {
  const target = row?.chunk_id ? ragflowChunkAvailabilityRow(row.chunk_id) || row : null;
  if (!target || text(target.source || 'ragflow') !== 'ragflow' || !text(target.dataset_id) || !text(target.document_id)) return '';
  const label = chunkIsAvailable(target) ? '禁用' : '启用';
  const operation = chunkIsAvailable(target) ? 'set-chunk-unavailable' : 'set-chunk-available';
  return `<button class="btn btn-sm btn-outline ${attr(className)}" data-action="${attr(operation)}" data-id="${attr(target.chunk_id)}" type="button" title="${attr(label)} Chunk（调用 RAGFlow）" aria-label="${attr(label)} Chunk ${attr(target.chunk_id)}">${esc(label)}</button>`;
}

function queryFactLinks(queryId) {
  return rows('query_facts').filter((row) => row.query_id === queryId);
}

function factsOfQuery(queryId) {
  return queryFactLinks(queryId).map((link) => ({ ...link, fact: fact(link.fact_id) })).filter((item) => item.fact);
}

function isScoringRequirement(requirement) {
  return requirement === 'required' || requirement === 'required_any';
}

function queryFactRequirementCounts(links) {
  const requiredFacts = links.filter((link) => link.requirement === 'required');
  const requiredGroups = new Set(requiredFacts.map((link) => link.group_id).filter(Boolean));
  const alternativeGroups = new Set(links
    .filter((link) => link.requirement === 'required_any')
    .map((link) => link.group_id || 'A1'));
  return {
    requiredGroups: requiredGroups.size,
    requiredSingles: requiredFacts.filter((link) => !link.group_id).length,
    alternatives: alternativeGroups.size,
    conditions: requiredFacts.length + alternativeGroups.size,
  };
}

function queryFactCountSummary(links) {
  const counts = queryFactRequirementCounts(links);
  return `${counts.requiredGroups} 个必需组 · ${counts.requiredSingles} 个必需单项 · ${counts.alternatives} 个任选组 · ${counts.conditions} 个评分条件`;
}

function assignmentGroupId(link) {
  if (link.requirement === 'required_any') return link.group_id || 'A1';
  return link.requirement === 'required' ? link.group_id || '' : '';
}

function assignmentValue(link) {
  const groupId = assignmentGroupId(link);
  return groupId ? `${link.requirement}:${groupId}` : link.requirement || 'required';
}

function nextAssignmentGroupId(links, requirement) {
  const prefix = requirement === 'required' ? 'R' : 'A';
  const max = links
    .filter((link) => link.requirement === requirement)
    .map((link) => assignmentGroupId(link).match(new RegExp(`^${prefix}(\\d+)$`))?.[1] || '0')
    .reduce((highest, value) => Math.max(highest, Number(value)), 0);
  return `${prefix}${max + 1}`;
}

function assignmentOptions(links) {
  const requiredGroups = [...new Set(links
    .filter((link) => link.requirement === 'required' && link.group_id)
    .map((link) => link.group_id))].sort();
  const alternativeGroups = [...new Set(links
    .filter((link) => link.requirement === 'required_any')
    .map((link) => link.group_id || 'A1'))].sort();
  const nextRequired = nextAssignmentGroupId(links, 'required');
  const nextAlternative = nextAssignmentGroupId(links, 'required_any');
  return [
    { value: 'required', label: '必需单项 · 本 Fact 单独计分' },
    ...requiredGroups.map((groupId) => ({ value: `required:${groupId}`, label: `必需组 ${groupId} · 每条都必须命中` })),
    { value: '__new_required_group__', label: `＋ 新建必需组 ${nextRequired}` },
    ...alternativeGroups.map((groupId) => ({ value: `required_any:${groupId}`, label: `任选组 ${groupId} · 命中任一条` })),
    { value: '__new_alternative_group__', label: `＋ 新建任选组 ${nextAlternative}` },
    { value: 'optional', label: '可选上下文 · 不计分' },
    { value: 'forbidden', label: '禁止依据 · 不作答依据' },
  ];
}

function applyAssignment(links, factId, value) {
  const current = links.find((link) => link.fact_id === factId);
  if (!current) return links;
  let requirement = value;
  let groupId = '';
  if (value === '__new_required_group__') {
    requirement = 'required';
    groupId = nextAssignmentGroupId(links, requirement);
  } else if (value === '__new_alternative_group__') {
    requirement = 'required_any';
    groupId = nextAssignmentGroupId(links, requirement);
  } else {
    const groupAssignment = value.match(/^(required|required_any):(.+)$/);
    if (groupAssignment) [, requirement, groupId] = groupAssignment;
  }
  return links.map((link) => (link.fact_id === factId
    ? { ...link, requirement, group_id: groupId }
    : link));
}

function assignmentSelect(link, links, action, factId, disabled = false, options = assignmentOptions(links)) {
  return `<select class="select fact-assignment-select" id="${attr(action)}-${attr(factId)}" data-assignment-selector="true" data-action="${attr(action)}" data-id="${attr(factId)}" aria-label="${attr(factId)} 的计分方式和分组" ${disabled ? 'disabled' : ''}>
    ${options.map((option) => `<option value="${attr(option.value)}" ${assignmentValue(link) === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
  </select>`;
}

function syncAssignmentSelectors(root, links) {
  const options = assignmentOptions(links);
  root.querySelectorAll('select[data-assignment-selector="true"]').forEach((select) => {
    const link = links.find((item) => item.fact_id === select.dataset.id);
    const value = link ? assignmentValue(link) : 'required';
    select.innerHTML = options
      .map((option) => `<option value="${attr(option.value)}">${esc(option.label)}</option>`)
      .join('');
    select.value = value;
  });
  const summary = root.querySelector('[data-query-facts-summary]');
  if (summary) summary.textContent = queryFactCountSummary(links);
}

function factOptionVisible(row, link, state) {
  const selected = Boolean(link);
  if ((state.factFilter || 'all') === 'selected' && !selected) return false;
  const term = normalizeText(state.factFilterText);
  if (!term) return true;
  const status = state.factStatuses?.[row.fact_id] || row.status;
  return normalizeText(`${row.fact_id} ${row.statement} ${row.topic || ''} ${STATUS_LABELS[status] || status || ''} ${row.importance || 'P1'}`).includes(term);
}

function builderFactVisible(row, link) {
  const term = normalizeText(ui.builder.factSearch);
  if (!term) return true;
  return normalizeText(`${row.fact_id} ${row.statement} ${row.topic || ''} ${factTypeLabel(row.fact_type)} ${STATUS_LABELS[row.status] || row.status || ''} ${row.importance || 'P1'}`).includes(term);
}

function builderCandidateVisible(candidate) {
  const term = normalizeText(ui.builder.candidateSearch);
  if (!term) return true;
  const haystack = normalizeText(`${candidate.text || ''} ${candidate.rationale || ''} ${VARIANT_LABELS[candidate.variant_type] || ''} ${candidate.id || ''}`);
  return haystack.includes(term);
}

function listSearchBox({ id, bind, value, placeholder, clearAction }) {
  const modalClass = bind === 'query-facts-search' ? ' query-facts-search' : '';
  return `<label class="search-box list-search-box${modalClass}">
    ${icon('search')}
    <input class="input" id="${attr(id)}" data-bind="${attr(bind)}" value="${attr(value)}" placeholder="${attr(placeholder)}" autocomplete="off">
    <button class="search-clear" data-action="${attr(clearAction)}" type="button" aria-label="清空" ${value ? '' : 'hidden'}>${icon('x')}</button>
  </label>`;
}

function syncQueryFactsPanel(root, state) {
  const links = state.factLinks || [];
  const selectedIds = new Set(links.map((link) => link.fact_id));
  const status = (factId) => state.factStatuses?.[factId];
  let visibleCount = 0;
  let totalCount = 0;
  root.querySelectorAll('[data-fact-option]').forEach((option) => {
    const factId = option.dataset.factOption;
    const link = links.find((item) => item.fact_id === factId);
    const row = fact(factId);
    if (!row) return;
    totalCount += 1;
    const selected = Boolean(link);
    const visible = factOptionVisible(row, link, state);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
    option.classList.toggle('selected', selected);
    const button = option.querySelector('[data-action="toggle-query-fact"]');
    if (button) {
      button.classList.toggle('checked', selected);
      button.setAttribute('aria-label', `${selected ? '移除' : '添加'} ${factId}`);
      button.innerHTML = selected ? icon('check') : '';
    }
    const assignment = option.querySelector('select[data-assignment-selector="true"]');
    if (assignment) assignment.disabled = !selected;
    const statusSelect = option.querySelector('[data-action="set-query-fact-status"]');
    if (statusSelect && status(factId)) statusSelect.value = status(factId);
  });
  syncAssignmentSelectors(root, links);
  root.querySelectorAll('[data-action="filter-query-facts"]').forEach((button) => {
    const active = button.dataset.filter === (state.factFilter || 'all');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const searchInput = root.querySelector('[data-bind="query-facts-search"]');
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== (state.factFilterText || '')) {
    searchInput.value = state.factFilterText || '';
  }
  const clearSearch = root.querySelector('[data-action="clear-query-facts-search"]');
  if (clearSearch) clearSearch.hidden = !state.factFilterText;
  const empty = root.querySelector('[data-query-facts-empty]');
  if (empty) {
    empty.hidden = visibleCount > 0;
    const title = empty.querySelector('.empty-title');
    const copy = empty.querySelector('.empty-copy');
    const selectedView = (state.factFilter || 'all') === 'selected';
    const textFiltered = Boolean(state.factFilterText);
    if (title) title.textContent = textFiltered
      ? '没有匹配的 Fact'
      : selectedView ? '还没有勾选 Fact' : 'Fact 库为空';
    if (copy) copy.textContent = textFiltered
      ? '清空搜索词后再试。'
      : selectedView
        ? '切回“全部”勾选需要的 Fact，再回来编辑计分方式和状态。'
        : '先手工录入至少一条事实，再关联到 Query。';
  }
  const selectedCount = root.querySelector('[data-query-facts-selected-count]');
  if (selectedCount) selectedCount.textContent = String(selectedIds.size);
  const totalCountElement = root.querySelector('[data-query-facts-total-count]');
  if (totalCountElement) totalCountElement.textContent = String(totalCount);
}

function syncEvidenceCreateModal(root, state, { skipFields = false } = {}) {
  if (!root || state?.type !== 'evidence-create' || state.stage !== 'editing') return;
  const draft = state.draft || {};
  const chunks = Array.isArray(draft.chunks) ? draft.chunks : [];
  const saving = ui.busy;
  const polishing = Boolean(state.polishing);
  const locked = saving || polishing;
  const targetFact = fact(draft.fact_id);

  const saveError = root.querySelector('[data-evidence-save-error]');
  if (saveError) {
    saveError.hidden = !state.error;
    const title = saveError.querySelector('.readiness-title');
    const hint = saveError.querySelector('.hint');
    if (title) title.innerHTML = `${icon('alert')} 保存失败`;
    if (hint) hint.textContent = state.error ? text(state.error) : '';
  }
  const polishError = root.querySelector('[data-evidence-polish-error]');
  if (polishError) {
    polishError.hidden = !state.polishError;
    const title = polishError.querySelector('.readiness-title');
    const hint = polishError.querySelector('.hint');
    if (title) title.innerHTML = `${icon('alert')} 润色失败`;
    if (hint) hint.textContent = state.polishError ? `${state.polishError}；原草稿已保留。` : '';
  }
  const model = root.querySelector('[data-evidence-model]');
  if (model) {
    model.hidden = !state.model;
    model.textContent = state.model ? `模型：${state.model}` : '';
  }

  const polishButton = root.querySelector('[data-action="polish-evidence-draft"]');
  if (polishButton) {
    polishButton.disabled = locked || !targetFact;
    polishButton.innerHTML = polishing
      ? '<span class="spinner"></span> LLM 润色中…'
      : `${icon('sparkle')} ${targetFact ? 'LLM 润色草稿' : '选择 Fact 后可润色'}`;
  }
  if (!skipFields) {
    const titleInput = root.querySelector('[data-bind="evidence-draft-title"]');
    if (titleInput) {
      titleInput.value = draft.title || '';
      titleInput.disabled = locked;
    }
    const excerptInput = root.querySelector('[data-bind="evidence-draft-excerpt"]');
    if (excerptInput) {
      excerptInput.value = draft.excerpt || '';
      excerptInput.disabled = locked;
    }
  }

  const subtitle = root.querySelector('.modal-head p');
  if (subtitle) subtitle.textContent = `${targetFact ? `为 ${draft.fact_id} 添加证据` : '创建独立 Evidence，Fact 关联可选'}。所选 ${chunks.length} 个 Chunk 是这条 Evidence 的来源。`;
  const sourceCount = root.querySelector('[data-evidence-source-count]');
  if (sourceCount) sourceCount.textContent = `${chunks.length} 个`;
  const sourceIds = new Set(chunks.map((chunk) => chunk.chunk_id));
  root.querySelectorAll('[data-evidence-source]').forEach((card) => {
    card.hidden = !sourceIds.has(card.dataset.evidenceSource);
  });
  const sourcesEmpty = root.querySelector('[data-evidence-sources-empty]');
  if (sourcesEmpty) sourcesEmpty.hidden = chunks.length > 0;
  const saveNote = root.querySelector('[data-evidence-save-note]');
  if (saveNote) saveNote.textContent = `保存后创建 1 条草稿 Evidence，关联 ${chunks.length} 个来源 Chunk${targetFact ? `，并关联 ${draft.fact_id}` : '，不关联 Fact'}。`;
  const factSelect = root.querySelector('[data-bind="evidence-draft-fact"]');
  if (factSelect) factSelect.disabled = locked;
  const factSummary = root.querySelector('[data-evidence-fact-summary]');
  if (factSummary) factSummary.textContent = targetFact?.statement || '不关联 Fact，仅创建 Evidence 与 Chunk 的关系。';

  root.querySelectorAll('[data-action="insert-evidence-source"], [data-action="remove-evidence-source"]')
    .forEach((button) => { button.disabled = locked; });
  root.querySelectorAll('.modal-foot [data-action="close-modal"]')
    .forEach((button) => { button.disabled = locked; });
  const saveButton = root.querySelector('[data-action="save-evidence-draft"]');
  if (saveButton) {
    saveButton.disabled = locked || !chunks.length || (state.origin !== 'workspace' && !targetFact);
    saveButton.innerHTML = saving
      ? '<span class="spinner light"></span> 保存中…'
      : `${icon('check')} 保存 Evidence`;
  }
}

function factEvidenceLink(factId) {
  return rows('fact_evidence').find((row) => row.fact_id === factId) || null;
}

function evidenceIdsOfFact(factId) {
  return unique(factEvidenceLink(factId)?.evidence_ids || []);
}

function chunkIdsOfEvidence(evidenceId) {
  return ui.index?.chunkIdsByEvidence.get(evidenceId) || [];
}

function chunkIdsOfFact(factId) {
  return unique(evidenceIdsOfFact(factId).flatMap((evidenceId) => chunkIdsOfEvidence(evidenceId)));
}

function evidenceOfFact(factId) {
  return evidenceIdsOfFact(factId).map(evidence).filter(Boolean);
}

function factTopicsOfEvidence(evidenceId) {
  return unique(rows('fact_evidence')
    .filter((row) => (row.evidence_ids || []).includes(evidenceId))
    .map((row) => fact(row.fact_id)?.topic)
    .filter(Boolean));
}

function statusChip(status) {
  return `<span class="chip status-${attr(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function variantChip(variantType) {
  return `<span class="chip type-${attr(variantType)}">${esc(VARIANT_LABELS[variantType] || variantType)}</span>`;
}

function requirementChip(requirement, groupId = '') {
  const label = requirement === 'required'
    ? groupId ? `必需组 ${groupId} · 全部` : '必需单项'
    : requirement === 'required_any'
      ? `任选组 ${groupId || 'A1'} · 任一`
      : REQUIREMENT_LABELS[requirement] || requirement;
  return `<span class="chip requirement-${attr(requirement)}">${esc(label)}</span>`;
}

function idChip(id) {
  return `<span class="chip id">${esc(id)}</span>`;
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replaceAll('/', '-');
}

function percentText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function similarityText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return `${(number <= 1 ? number * 100 : number).toFixed(0)}%`;
}

function evidenceCandidateVisible(candidate) {
  const term = normalizeText(ui.evidenceWorkspace.workflow.candidateSearch);
  if (!term) return true;
  const haystack = normalizeText(`${candidate.chunk_id || ''} ${candidate.document_name || ''} ${candidate.document_id || ''} ${candidate.content || ''} ${candidate.page || ''} ${candidate.dataset_id || ''} ${candidate.source || ''} ${similarityText(candidate.similarity)} ${(candidate.matched_fact_ids || []).join(' ')} ${(candidate.matched_evidence_ids || []).join(' ')}`);
  return haystack.includes(term);
}

function pageLabel(page) {
  return page ? `第 ${page} 页` : '页码未知';
}

function compactExcerpt(value, length = 150) {
  const clean = text(value).replace(/\s+/g, ' ');
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

function defaultEvidenceTitle(chunks) {
  const first = chunks[0];
  if (!first) return '';
  const name = text(first.document_name) || text(first.document_id) || 'RAGFlow Chunk';
  return `${name}${first.page ? ` · 第 ${first.page} 页` : ''}`;
}

function defaultEvidenceExcerpt(chunks) {
  return text(chunks[0]?.content).slice(0, 500);
}

function normalizeChunkForSave(chunk) {
  return {
    chunk_id: chunk.chunk_id,
    dataset_id: chunk.dataset_id || '',
    document_id: chunk.document_id || '',
    document_name: chunk.document_name || '',
    page: chunk.page || '',
    content: chunk.content || '',
    source: chunk.source || 'ragflow',
  };
}

function captureScroll() {
  return [...document.querySelectorAll('[data-scroll-key]')].map((element) => ({
    key: element.dataset.scrollKey,
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
}

function restoreScroll(items) {
  for (const item of items) {
    const element = document.querySelector(`[data-scroll-key="${item.key}"]`);
    if (element) {
      element.scrollTop = item.top;
      element.scrollLeft = item.left;
    }
  }
}

function render() {
  if (!ui.data) {
    view.innerHTML = `
      <div class="boot-screen">
        ${ui.loading ? '<span class="spinner"></span><span>正在读取数据集…</span>' : `
          ${icon('alert')}
          <span>数据加载失败${ui.loadError ? `：${esc(ui.loadError)}` : ''}</span>
          <button class="btn btn-sm btn-outline" data-action="retry-load" type="button">${icon('refresh')} 重试</button>`}
      </div>`;
    renderModal();
    renderToasts();
    return;
  }

  const scroll = captureScroll();
  renderChrome();
  renderView();
  renderModal();
  renderToasts();
  restoreScroll(scroll);
}

function renderWithFocus() {
  const active = document.activeElement;
  const id = active?.id || '';
  const start = Number.isInteger(active?.selectionStart) ? active.selectionStart : null;
  const end = Number.isInteger(active?.selectionEnd) ? active.selectionEnd : null;
  render();
  if (!id) return;
  const next = document.getElementById(id);
  if (!next) return;
  next.focus();
  if (start !== null && typeof next.setSelectionRange === 'function') {
    next.setSelectionRange(start, end ?? start);
  }
}

function renderChrome() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.screen === ui.screen);
  });

  const ragflowReady = Boolean(ui.data?.config?.ragflow?.configured);
  const llmReady = Boolean(ui.data?.config?.llm?.configured);
  connectionPill.classList.toggle('ready', ragflowReady && llmReady);
  connectionPill.classList.toggle('partial', ragflowReady !== llmReady);
  const label = ragflowReady && llmReady
    ? 'RAGFlow 与 LLM 已就绪'
    : ragflowReady
      ? 'RAGFlow 已就绪 · LLM 未配置'
      : llmReady
        ? 'LLM 已就绪 · RAGFlow 未配置'
        : '上游服务未配置';
  connectionPill.innerHTML = `<span class="status-dot"></span><span>${esc(label)}</span>`;
}

function renderView() {
  if (ui.screen === 'fact-review') view.innerHTML = renderFactReview();
  else if (ui.screen === 'builder') view.innerHTML = renderBuilder();
  else if (ui.screen === 'queries') view.innerHTML = renderQueryList();
  else if (ui.screen === 'facts') view.innerHTML = renderFactLibrary();
  else if (ui.screen === 'evidence') view.innerHTML = renderEvidenceLibrary();
  else if (ui.screen === 'overview') view.innerHTML = renderOverview();
  else view.innerHTML = renderWorkbench();
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || 'workbench';
  const [screenName, queryString = ''] = raw.split('?');
  const screen = SCREENS.has(screenName) ? screenName : 'workbench';
  return { screen, params: normalizeNavigationParams(new URLSearchParams(queryString)) };
}

function normalizeNavigationParams(input = {}) {
  const source = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const params = {};
  const routedQuery = text(source.get('query'));
  const routedFact = text(source.get('fact'));
  const routedEvidence = text(source.get('evidence'));
  if (query(routedQuery)) params.query = routedQuery;
  if (fact(routedFact)) params.fact = routedFact;
  if (evidence(routedEvidence)) params.evidence = routedEvidence;
  const returnTo = text(source.get('returnTo'))
    .split(',')
    .map((screenName) => screenName.trim())
    .filter((screenName) => SCREENS.has(screenName));
  if (returnTo.length) params.returnTo = returnTo.join(',');
  return params;
}

function extendReturnChain(params, screen) {
  const chain = text(params.returnTo).split(',').filter(Boolean);
  return chain.includes(screen) ? chain.join(',') : [...chain, screen].join(',');
}

function applyRoute() {
  const route = parseRoute();
  const params = route.params;
  if (route.screen === 'workbench' && params.fact && !params.query) {
    route.screen = 'fact-review';
    if (params.returnTo === 'workbench') params.returnTo = 'facts';
    history.replaceState(null, '', `#fact-review?${new URLSearchParams(params)}`);
  }
  ui.screen = route.screen;
  const routedQuery = params.query || '';
  const routedFact = params.fact || '';
  const routedEvidence = params.evidence || '';
  if (routedQuery && routedQuery !== ui.queryId) selectQuery(routedQuery, { resetEvidence: true });
  if (routedFact && routedFact !== ui.factId) selectFact(routedFact, { resetEditor: true });
  if (ui.screen === 'workbench' || ui.screen === 'fact-review') {
    if (routedEvidence) loadEvidenceDraft(routedEvidence, routedFact || ui.factId);
  } else if (ui.screen === 'facts') {
    if (routedFact) setFactDraft(routedFact);
    else if (!ui.factDraft) setFactDraft(ui.factId || rows('facts')[0]?.fact_id || '');
  }
  if (ui.screen === 'evidence') {
    if (routedEvidence && evidence(routedEvidence)) {
      const workflow = ui.evidenceWorkspace.workflow;
      if (workflow.direction !== 'evidence' || workflow.evidenceId !== routedEvidence) resetWorkspaceSelection();
      workflow.direction = 'evidence';
      workflow.evidenceId = routedEvidence;
    }
    if (routedQuery || routedFact) {
      const workspace = ui.evidenceWorkspace;
      if (routedQuery) {
        workspace.queryId = routedQuery;
        workspace.queryText = text(query(routedQuery)?.text);
      }
      if (routedFact) workspace.factId = routedFact;
    } else {
      evidenceSyncCurrentQuery();
    }
    if (!ui.evidenceWorkspace.inventory) loadEvidenceInventory({ silent: true }).then(() => render());
  }
  ensureContext();
  render();
}

function navigate(screen, params = {}) {
  const safeScreen = SCREENS.has(screen) ? screen : 'workbench';
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(normalizeNavigationParams(params))) {
    if (value !== undefined && value !== null && value !== '') queryParams.set(key, String(value));
  }
  const suffix = queryParams.size ? `?${queryParams}` : '';
  const nextHash = `#${safeScreen}${suffix}`;
  if (location.hash === nextHash) applyRoute();
  else location.hash = nextHash;
}

function applyServerState(next, { preserveEditor = true } = {}) {
  ui.data = next;
  ui.index = {
    queries: new Map(rows('queries').map((row) => [row.query_id, row])),
    facts: new Map(rows('facts').map((row) => [row.fact_id, row])),
    evidences: new Map(rows('evidences').map((row) => [row.evidence_id, row])),
    chunks: new Map(rows('chunks').map((row) => [row.chunk_id, row])),
    chunkIdsByEvidence: new Map(),
    evidenceIdsByChunk: new Map(),
  };

  for (const relation of rows('evidence_chunks')) {
    const ids = unique([...(ui.index.chunkIdsByEvidence.get(relation.evidence_id) || []), ...(relation.chunk_ids || [])]);
    ui.index.chunkIdsByEvidence.set(relation.evidence_id, ids);
    for (const chunkId of ids) {
      const evidenceIds = ui.index.evidenceIdsByChunk.get(chunkId) || new Set();
      evidenceIds.add(relation.evidence_id);
      ui.index.evidenceIdsByChunk.set(chunkId, evidenceIds);
    }
  }

  ui.selectedEvidenceIds = new Set([...ui.selectedEvidenceIds].filter((id) => evidence(id)));
  ui.selectedChunkIds = new Set([...ui.selectedChunkIds].filter((id) => findChunk(id)));

  if (!query(ui.queryId)) {
    const firstRoot = rows('queries').find((row) => !row.parent_query_id) || rows('queries')[0];
    ui.queryId = firstRoot?.query_id || '';
    if (ui.screen === 'workbench') {
      ui.factId = '';
      ui.editorDraft = null;
      ui.previewEvidenceId = '';
      ui.previewChunkId = '';
    }
  }

  if (ui.previewEvidenceId && !evidence(ui.previewEvidenceId)) ui.previewEvidenceId = '';
  if (ui.previewChunkId && !findChunk(ui.previewChunkId)) ui.previewChunkId = '';
  ui.builder.factLinks = ui.builder.factLinks.filter((link) => fact(link.fact_id));
  ui.evidenceWorkspace.factId = fact(ui.evidenceWorkspace.factId) ? ui.evidenceWorkspace.factId : '';
  if (query(ui.evidenceWorkspace.queryId)) {
    ui.evidenceWorkspace.queryText = text(query(ui.evidenceWorkspace.queryId).text);
  }

  if (!preserveEditor) ui.editorDraft = null;
  if (ui.editorDraft?.evidence_id && !evidence(ui.editorDraft.evidence_id)) ui.editorDraft = null;
  if (ui.factDraft?.mode === 'edit' && !fact(ui.factDraft.fact_id)) {
    setFactDraft(rows('facts')[0]?.fact_id || '');
  }

  ensureContext();
}

function ensureContext() {
  if (!ui.queryId || !query(ui.queryId)) {
    const firstRoot = rows('queries').find((row) => !row.parent_query_id) || rows('queries')[0];
    ui.queryId = firstRoot?.query_id || '';
  }

  if (ui.screen === 'workbench') {
    const links = queryReviewState()?.factLinks || [];
    if (!fact(ui.factId)) ui.factId = links[0]?.fact_id || '';
  } else if (!fact(ui.factId)) {
    ui.factId = ui.screen === 'fact-review' ? sortedFacts()[0]?.fact_id || '' : '';
  }

  const relation = factEvidenceLink(ui.factId);
  if (!ui.editorDraft || ui.editorDraft.factId !== ui.factId) {
    resetEditorForFact(ui.factId);
  } else if (relation?.operator) {
    ui.relationOperator = relation.operator;
  }

  if (!ui.previewChunkId) {
    const draftChunk = ui.editorDraft?.chunkIds?.[0] || chunkIdsOfEvidence(ui.previewEvidenceId)[0];
    if (draftChunk) ui.previewChunkId = draftChunk;
  }
}

function selectQuery(id, { resetEvidence = true } = {}) {
  if (!query(id)) return;
  if (ui.queryId !== id) ui.queryReview = null;
  ui.queryId = id;
  const linked = factsOfQuery(id);
  ui.factId = linked[0]?.fact_id || '';
  if (resetEvidence) {
    ui.selectedEvidenceIds.clear();
    ui.selectedChunkIds.clear();
    ui.remoteChunks = [];
    ui.remoteSearchTerm = '';
    ui.remoteMeta = null;
    ui.search = '';
    ui.previewChunkId = '';
  }
  resetEditorForFact(ui.factId);
}

function selectFact(id, { resetEditor = true } = {}) {
  if (ui.factId !== id) {
    ui.selectedChunkIds.clear();
    ui.remoteChunks = [];
    ui.remoteSearchTerm = '';
    ui.remoteMeta = null;
    ui.search = '';
  }
  ui.factId = fact(id) ? id : '';
  ui.selectedEvidenceIds.clear();
  if (resetEditor) {
    resetEditorForFact(ui.factId);
  } else {
    const relation = factEvidenceLink(ui.factId);
    ui.relationOperator = relation?.operator || 'OR';
  }
}

function resetEditorForFact(factId) {
  if (!fact(factId)) {
    ui.relationOperator = 'OR';
    ui.editorDraft = null;
    ui.previewEvidenceId = '';
    ui.previewChunkId = '';
    return;
  }
  const relation = factEvidenceLink(factId);
  ui.relationOperator = relation?.operator || 'OR';
  const firstEvidence = evidenceIdsOfFact(factId).map(evidence).find(Boolean);
  if (firstEvidence) loadEvidenceDraft(firstEvidence.evidence_id, factId);
  else createEvidenceDraft([], factId);
}

function loadEvidenceDraft(evidenceId, factId = ui.factId) {
  const row = evidence(evidenceId);
  if (!row) return;
  const chunkIds = chunkIdsOfEvidence(evidenceId);
  ui.editorDraft = {
    mode: 'edit',
    evidence_id: evidenceId,
    factId,
    title: row.title || '',
    excerpt: row.excerpt || '',
    status: row.status || 'draft',
    chunkIds,
  };
  ui.previewEvidenceId = evidenceId;
  ui.previewChunkId = chunkIds[0] || '';
}

function createEvidenceDraft(chunks = [], factId = ui.factId) {
  const chunkIds = unique(chunks.map((chunk) => chunk.chunk_id));
  ui.editorDraft = {
    mode: 'create',
    evidence_id: '',
    factId,
    title: defaultEvidenceTitle(chunks),
    excerpt: defaultEvidenceExcerpt(chunks),
    status: 'draft',
    chunkIds,
  };
  ui.previewEvidenceId = '';
  ui.previewChunkId = chunkIds[0] || '';
}

function currentQuery() {
  return query(ui.queryId);
}

function queryReviewState() {
  if (!currentQuery()) return null;
  if (ui.queryReview?.queryId !== ui.queryId) {
    ui.queryReview = {
      queryId: ui.queryId,
      factLinks: queryFactLinks(ui.queryId).map((link) => ({
        fact_id: link.fact_id,
        requirement: link.requirement,
        group_id: link.group_id || '',
      })),
      factStatuses: {},
      factFilter: 'all',
      factFilterText: '',
    };
  }
  return ui.queryReview;
}

function queryReviewIsDirty() {
  const review = queryReviewState();
  if (!review) return false;
  const key = (links) => JSON.stringify(links.map((link) => [link.fact_id, link.requirement, link.group_id || '']).sort((a, b) => a[0].localeCompare(b[0])));
  return key(review.factLinks) !== key(queryFactLinks(review.queryId))
    || Object.entries(review.factStatuses).some(([id, status]) => fact(id)?.status !== status);
}

function currentFactLink() {
  return factsOfQuery(ui.queryId).find((item) => item.fact_id === ui.factId) || null;
}

function currentFact() {
  return fact(ui.factId);
}

function familyOfQuery(queryId) {
  const row = query(queryId);
  if (!row) return [];
  const rootId = row.parent_query_id && query(row.parent_query_id) ? row.parent_query_id : row.query_id;
  return [query(rootId), ...rows('queries').filter((item) => item.parent_query_id === rootId)]
    .filter(Boolean);
}

function sortedQueries() {
  return [...rows('queries')].sort((a, b) => a.query_id.localeCompare(b.query_id, 'zh-CN', { numeric: true }));
}

function nextQuery(id, direction) {
  const items = sortedQueries();
  const index = items.findIndex((row) => row.query_id === id);
  if (index < 0) return '';
  return items[(index + direction + items.length) % items.length]?.query_id || '';
}

function sortedFacts() {
  return [...rows('facts')].sort((a, b) => a.fact_id.localeCompare(b.fact_id, 'zh-CN', { numeric: true }));
}

function nextFact(id, direction) {
  const items = sortedFacts();
  const index = items.findIndex((row) => row.fact_id === id);
  return index < 0 ? '' : items[(index + direction + items.length) % items.length]?.fact_id || '';
}

function moveToFact(factId) {
  if (!fact(factId)) return;
  const params = currentNavigationParams();
  selectFact(factId);
  navigate('fact-review', { ...params, fact: factId, evidence: '' });
}

function documentOptionsFromEvidence() {
  const names = [];
  for (const row of rows('evidences')) {
    for (const chunkId of chunkIdsOfEvidence(row.evidence_id)) {
      const chunk = localChunk(chunkId);
      if (chunk?.document_name) names.push(chunk.document_name);
    }
  }
  return unique(names).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function evidenceMatches(row) {
  const term = normalizeText(ui.search);
  if (term) {
    const chunkText = chunkIdsOfEvidence(row.evidence_id)
      .map((chunkId) => localChunk(chunkId))
      .filter(Boolean)
      .map((chunk) => `${chunk.document_name} ${chunk.content}`)
      .join(' ');
    const haystack = normalizeText(`${row.evidence_id} ${row.title} ${row.excerpt} ${chunkText}`);
    if (!haystack.includes(term)) return false;
  }
  if (ui.filters.status && row.status !== ui.filters.status) return false;
  if (ui.filters.document) {
    const docs = chunkIdsOfEvidence(row.evidence_id)
      .map((chunkId) => localChunk(chunkId)?.document_name)
      .filter(Boolean);
    if (!docs.includes(ui.filters.document)) return false;
  }
  if (ui.filters.topic && !factTopicsOfEvidence(row.evidence_id).includes(ui.filters.topic)) return false;
  return true;
}

function chunkPool() {
  return ui.remoteSearchTerm ? ui.remoteChunks : rows('chunks');
}

function chunkMatches(row) {
  const term = normalizeText(ui.search);
  if (term) {
    const haystack = normalizeText(`${row.chunk_id} ${row.document_name} ${row.document_id} ${row.content}`);
    if (!haystack.includes(term)) return false;
  }
  if (ui.filters.document && row.document_name !== ui.filters.document) return false;
  if (ui.filters.source && row.source !== ui.filters.source) return false;
  return true;
}

function documentOptionsFromChunks() {
  return unique(chunkPool().map((chunk) => chunk.document_name).filter(Boolean))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function topicOptions() {
  const taxonomy = ui.data?.taxonomy?.topics || [];
  const known = new Map(taxonomy.map((item) => [item.name, item.id]));
  const existing = rows('facts').map((row) => row.topic).filter(Boolean);
  return unique([...taxonomy.map((item) => item.name), ...existing])
    .map((name) => ({ name, id: known.get(name) || '' }))
    .sort((left, right) => {
      if (left.id && right.id) return left.id.localeCompare(right.id);
      if (left.id) return -1;
      if (right.id) return 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
}

function factTypeOptions() {
  return ui.data?.taxonomy?.fact_types || [];
}

function factTypeLabel(value) {
  return factTypeOptions().find((item) => item.id === value)?.label || value || '未分类';
}

function renderWorkbench() {
  if (!rows('queries').length) {
    return `
      <section class="screen">
        <div class="panel">
          ${emptyState({
            title: '还没有 Query',
            copy: '先从 Fact 构造第一条主问，再审核问题的 Fact 评分规则。',
            actions: `<button class="btn btn-primary" data-action="navigate" data-screen="builder">${icon('plus')} 构造第一条 Query</button>
              <button class="btn btn-outline" data-action="navigate" data-screen="facts">${icon('fact')} 先录入 Fact</button>`,
          })}
        </div>
      </section>`;
  }

  const row = currentQuery();
  if (!row) return `<section class="screen">${emptyState({ title: 'Query 不存在', copy: '请从 Query 清单重新选择。' })}</section>`;

  return `
    <section class="screen workbench-screen query-review-screen">
      <div class="workbench-grid">
        ${renderQueryPanel(row)}
        ${renderQueryFactsPanel(queryReviewState())}
        ${renderQueryFactDetail()}
      </div>
      ${renderQueryActionDock(row)}
    </section>`;
}

function renderFactReview() {
  const row = currentFact();
  if (!row) {
    return `<section class="screen"><div class="panel">${emptyState({
      title: '还没有 Fact',
      copy: '先录入一条事实，再关联 Evidence。',
      actions: '<button class="btn btn-primary" data-action="new-fact" type="button">新建 Fact</button>',
    })}</div></section>`;
  }
  const queue = sortedFacts();
  const references = rows('query_facts').filter((link) => link.fact_id === row.fact_id).map((link) => query(link.query_id)).filter(Boolean);
  const linkedEvidence = evidenceOfFact(row.fact_id);
  return `
    <section class="screen workbench-screen fact-review-screen">
      <div class="workbench-grid">
        <section class="panel query-panel">
          <div class="panel-head">
            <div class="panel-title"><h2>Fact 审核台</h2><small>${queue.findIndex((item) => item.fact_id === row.fact_id) + 1} / ${queue.length}</small></div>
            <div class="queue-switcher">
              <button class="icon-btn" data-action="prev-fact" type="button" aria-label="上一条 Fact">${icon('left')}</button>
              <select class="select" data-action="select-review-fact" aria-label="选择 Fact">
                ${queue.map((item) => `<option value="${attr(item.fact_id)}" ${item.fact_id === row.fact_id ? 'selected' : ''}>${esc(item.fact_id)} · ${esc(compactExcerpt(item.statement, 44))}</option>`).join('')}
              </select>
              <button class="icon-btn" data-action="next-fact" type="button" aria-label="下一条 Fact">${icon('right')}</button>
            </div>
          </div>
          <div class="panel-body" data-scroll-key="fact-review-panel">
            <div class="query-hero">
              <div class="query-hero-top">${idChip(row.fact_id)}${statusChip(row.status)}<span class="chip plain">${esc(row.importance)}</span></div>
              <p class="query-text">${esc(row.statement)}</p>
              <p class="hint">${esc(row.topic || '未分类')} · ${esc(factTypeLabel(row.fact_type))}</p>
              <div class="query-actions">
                ${currentNavigationParams().query && text(currentNavigationParams().returnTo).split(',').at(-1) === 'workbench' ? '<button class="btn btn-sm btn-soft" data-action="return-from-fact-review" type="button">返回 Query 审核台</button>' : ''}
                <button class="btn btn-sm btn-outline" data-action="open-fact-library" data-id="${attr(row.fact_id)}" type="button">${icon('edit')} 编辑 Fact</button>
                <button class="btn btn-sm btn-ghost" data-action="navigate" data-screen="facts" data-fact="${attr(row.fact_id)}" type="button">返回 Fact 库</button>
              </div>
            </div>
            <div class="section-head"><h3>${icon('link')} 已关联 Evidence <span class="count">${linkedEvidence.length}</span></h3></div>
            ${linkedEvidence.length ? `<div class="fact-list">${linkedEvidence.map((item) => `
              <button class="fact-row ${ui.previewEvidenceId === item.evidence_id ? 'active' : ''}" data-action="preview-evidence" data-id="${attr(item.evidence_id)}" type="button">
                <span class="fact-main"><span class="fact-topline">${idChip(item.evidence_id)}${statusChip(item.status)}</span><strong>${esc(item.title)}</strong><span class="fact-meta">${esc(compactExcerpt(item.excerpt, 90))}</span></span>
              </button>`).join('')}</div>` : '<p class="hint">从中间搜索并勾选 Evidence，再保存关联。</p>'}
            <div class="section-head"><h3>${icon('query')} 引用此 Fact 的 Query <span class="count">${references.length}</span></h3></div>
            <p class="hint">证据关联适用于所有引用此 Fact 的 Query。</p>
            ${references.length ? `<div class="fact-list">${references.map((item) => `
              <button class="fact-row" data-action="open-query" data-id="${attr(item.query_id)}" type="button">
                <span class="fact-main"><span class="fact-topline">${idChip(item.query_id)}${statusChip(item.status)}</span><strong>${esc(item.text)}</strong></span>${icon('right')}
              </button>`).join('')}</div>` : '<p class="hint">尚无 Query 引用。可以先完成这条 Fact 的证据关联。</p>'}
          </div>
        </section>
        ${renderCenterPanel()}
        ${renderDetailPanel()}
      </div>
      ${renderActionDock()}
    </section>`;
}

function renderQueryFactDetail() {
  const row = currentFact();
  return `<aside class="panel detail-panel query-fact-detail">
    <div class="panel-head"><div class="panel-title"><h2>Fact 与证据链</h2><small>只读核对</small></div></div>
    <div class="panel-body" data-scroll-key="query-fact-detail">
      ${row ? `
        <section class="detail-section">
          <div class="row wrap">${idChip(row.fact_id)}${statusChip(row.status)}<span class="chip plain">${esc(row.importance)}</span></div>
          <p class="query-text">${esc(row.statement)}</p>
          <p class="hint">${esc(row.topic || '未分类')} · ${esc(factTypeLabel(row.fact_type))}</p>
          <button class="btn btn-outline" data-action="open-query-fact-review" type="button">${icon('external')} 在 Fact 审核台管理证据</button>
        </section>
        <section class="detail-section">
          <h3>已有 Evidence · ${esc(factEvidenceLink(row.fact_id)?.operator || 'OR')}</h3>
          ${evidenceOfFact(row.fact_id).length ? evidenceOfFact(row.fact_id).map((item) => `
            <article class="query-evidence-reference">
              <div class="row wrap">${idChip(item.evidence_id)}${statusChip(item.status)}</div>
              <h3>${esc(item.title)}</h3>
              <pre class="readonly-source">${esc(item.excerpt)}</pre>
              <details><summary>来源 Chunk · ${chunkIdsOfEvidence(item.evidence_id).length}</summary>
                ${chunkIdsOfEvidence(item.evidence_id).map((id) => {
                  const chunk = localChunk(id);
                  return `<div class="query-chunk-reference"><strong>${esc(chunk?.document_name || id)}</strong><p class="tiny muted">${esc(id)} · ${esc(pageLabel(chunk?.page))}</p><pre class="readonly-source">${esc(chunk?.content || '无本地快照')}</pre></div>`;
                }).join('')}
              </details>
            </article>`).join('') : '<p class="hint">这条 Fact 尚无 Evidence。进入 Fact 审核台补充证据链。</p>'}
        </section>` : emptyState({ title: '选择一条 Fact 查看证据链', copy: '点击中间列表的 Fact ID，预览后再决定是否勾选。', iconName: 'fact' })}
    </div>
  </aside>`;
}

function renderQueryActionDock(row) {
  const links = queryReviewState()?.factLinks || [];
  return `<div class="action-dock query-action-dock">
    <div class="dock-summary"><strong>${esc(row.query_id)} · ${esc(row.text)}</strong><span>${queryReviewIsDirty() ? '有未保存修改 · ' : ''}已选择 ${links.length} 条 Fact · ${esc(queryFactCountSummary(links))}</span></div>
    <span class="spacer"></span>
    <div class="dock-actions">
      <button class="btn btn-soft" data-action="save-query-facts" type="button" ${ui.busy ? 'disabled' : ''}>${icon('check')} 保存 Fact 关联</button>
      <button class="btn btn-outline" data-action="save-query-facts-next" type="button" ${ui.busy ? 'disabled' : ''}>保存并下一条 Query</button>
      <button class="btn btn-success" data-action="approve-query" data-id="${attr(row.query_id)}" data-advance="true" type="button" ${ui.busy ? 'disabled' : ''}>${icon('check')} 确认 Query</button>
    </div>
  </div>`;
}

function renderQueryPanel(row) {
  const queue = sortedQueries();
  const position = queue.findIndex((item) => item.query_id === row.query_id) + 1;
  const family = familyOfQuery(row.query_id);
  const links = (queryReviewState()?.factLinks || []).map((link) => ({ ...link, fact: fact(link.fact_id) })).filter((link) => link.fact);
  const related = links.map((item) => item.fact);
  const coverage = related.map((item) => ({
    fact: item,
    evidenceCount: evidenceIdsOfFact(item.fact_id).length,
    chunkCount: chunkIdsOfFact(item.fact_id).length,
  }));
  const readyFacts = coverage.filter((item) => item.chunkCount > 0).length;

  return `
    <section class="panel query-panel">
      <div class="panel-head">
        <div class="panel-title">
          <h2>当前 Query</h2>
          <small>${position} / ${queue.length}</small>
        </div>
        <div class="queue-switcher">
          <button class="icon-btn" data-action="prev-query" type="button" aria-label="上一条 Query" title="上一条">${icon('left')}</button>
          <select class="select" data-action="select-query-control" aria-label="选择 Query">
            ${queue.map((item) => `
              <option value="${attr(item.query_id)}" ${item.query_id === row.query_id ? 'selected' : ''}>
                ${esc(item.query_id)} · ${esc(VARIANT_LABELS[item.variant_type] || item.variant_type)}
              </option>`).join('')}
          </select>
          <button class="icon-btn" data-action="next-query" type="button" aria-label="下一条 Query" title="下一条">${icon('right')}</button>
        </div>
      </div>
      <div class="panel-body" data-scroll-key="query-panel">
        <div class="query-hero">
          <div class="query-hero-top">
            ${idChip(row.query_id)}
            ${variantChip(row.variant_type)}
            ${statusChip(row.status)}
            <span class="spacer"></span>
            <button class="icon-btn" data-action="edit-query" data-id="${attr(row.query_id)}" type="button" aria-label="编辑 Query" title="编辑 Query">${icon('edit')}</button>
          </div>
          <p class="query-text">${esc(row.text)}</p>
          <div class="query-meta">
            <span>${icon('fact')} ${esc(BEHAVIOR_LABELS[row.expected_behavior] || row.expected_behavior)}</span>
            <span>${icon('link')} ${links.length} Facts</span>
            <span>${esc(queryFactCountSummary(links))}</span>
            <span>${icon('chunk')} ${readyFacts} 个 Fact 已有 Chunk</span>
          </div>
          <div class="query-actions">
            <button class="btn btn-sm btn-soft" data-action="open-query-facts" type="button">${icon('plus')} 管理 Facts</button>
            <button class="btn btn-sm btn-outline" data-action="run-recall" type="button" ${ui.busy ? 'disabled' : ''}>${icon('search')} 保存并试检索</button>
          </div>
        </div>

        ${row.notes ? `<p class="hint" style="margin:9px 1px 0">${esc(row.notes)}</p>` : ''}

        <div class="section-head">
          <h3>${icon('link')} 本组 Query 变体 <span class="count">${family.length}</span></h3>
        </div>
        <div class="variant-strip">
          ${family.map((item) => `
            <button class="variant-pill ${item.query_id === row.query_id ? 'active' : ''}" data-action="select-query-id" data-id="${attr(item.query_id)}" type="button" title="${attr(item.text)}">
              ${esc(VARIANT_LABELS[item.variant_type] || item.variant_type)}
              <span>${esc(compactExcerpt(item.text, 34))}</span>
            </button>`).join('')}
        </div>

        <div class="section-head">
          <h3>${icon('check')} 审核条件</h3>
        </div>
        <div class="readiness-box ${coverage.length && coverage.every((item) => item.chunkCount > 0) ? 'ready' : ''}">
          <div class="readiness-title">${icon(coverage.length && coverage.every((item) => item.chunkCount > 0) ? 'check' : 'info')} ${row.status === 'approved' ? '已确认' : '完成前检查'}</div>
          <ul class="readiness-list">
            <li class="${links.some((link) => isScoringRequirement(link.requirement)) ? 'ok' : 'bad'}">${icon(links.some((link) => isScoringRequirement(link.requirement)) ? 'check' : 'alert')} 至少一项必需评分规则</li>
            <li class="${coverage.some((item) => item.evidenceCount > 0) ? 'ok' : 'bad'}">${icon(coverage.some((item) => item.evidenceCount > 0) ? 'check' : 'alert')} 已关联 Evidence</li>
            <li class="${coverage.some((item) => item.chunkCount > 0) ? 'ok' : 'bad'}">${icon(coverage.some((item) => item.chunkCount > 0) ? 'check' : 'alert')} 已绑定可检索 Chunk</li>
          </ul>
        </div>
      </div>
    </section>`;
}

function renderCenterPanel() {
  const selectedFact = currentFact();
  return `
    <section class="panel center-panel">
      <div class="panel-head">
        <div class="workbench-tabs">
          <button class="tab ${ui.centerTab === 'evidence' ? 'active' : ''}" data-action="switch-center" data-tab="evidence" type="button">
            ${icon('database')} 搜索已有 Evidence
          </button>
          <button class="tab ${ui.centerTab === 'chunk' ? 'active' : ''}" data-action="switch-center" data-tab="chunk" type="button">
            ${icon('chunk')} 搜索原始 Chunk
          </button>
        </div>
        <span class="tiny muted">${selectedFact ? `关联到 ${esc(selectedFact.fact_id)}` : '先从左侧选择 Fact'}</span>
      </div>
      <div class="search-band">
        <div class="search-row">
          <label class="search-box">
            ${icon('search')}
            <input class="input" id="workbench-search" data-bind="workbench-search" value="${attr(ui.search)}" placeholder="${ui.centerTab === 'evidence' ? '搜索 Evidence 标题、摘录或来源文档' : '输入问题或关键词，检索 RAGFlow'}" autocomplete="off">
            ${ui.search ? `<button class="search-clear" data-action="clear-center-search" type="button" aria-label="清空">${icon('x')}</button>` : ''}
          </label>
          ${ui.centerTab === 'chunk' ? `
            <button class="btn btn-primary" data-action="search-ragflow" type="button" ${ui.remoteLoading ? 'disabled' : ''}>
              ${ui.remoteLoading ? '<span class="spinner light"></span>' : icon('search')} 检索
            </button>` : ''}
        </div>
        <div class="filter-row">
          ${ui.centerTab === 'evidence' ? `
            <select class="select" data-action="filter-evidence-status" aria-label="Evidence 状态">
              <option value="">全部状态</option>
              ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${ui.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <select class="select" data-action="filter-document" aria-label="来源文档">
              <option value="">全部文档</option>
              ${documentOptionsFromEvidence().map((name) => `<option value="${attr(name)}" ${ui.filters.document === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
            </select>
            <select class="select" data-action="filter-topic" aria-label="事实主题">
              <option value="">全部主题</option>
              ${topicOptions().map((topic) => `<option value="${attr(topic.name)}" ${ui.filters.topic === topic.name ? 'selected' : ''}>${esc(topic.name)}</option>`).join('')}
            </select>` : `
            <select class="select" data-action="filter-source" aria-label="Chunk 来源">
              <option value="">全部来源</option>
              <option value="ragflow" ${ui.filters.source === 'ragflow' ? 'selected' : ''}>RAGFlow</option>
              <option value="manual" ${ui.filters.source === 'manual' ? 'selected' : ''}>手工</option>
            </select>
            <select class="select" data-action="filter-document" aria-label="来源文档">
              <option value="">全部文档</option>
              ${documentOptionsFromChunks().map((name) => `<option value="${attr(name)}" ${ui.filters.document === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
            </select>
            <select class="select" data-action="change-top-k" aria-label="Top K">
              ${[6, 12, 24].map((value) => `<option value="${value}" ${ui.topK === value ? 'selected' : ''}>Top ${value}</option>`).join('')}
            </select>
            ${ui.remoteSearchTerm ? `<button class="btn btn-sm btn-outline" data-action="show-local-chunks" type="button">${icon('refresh')} 本地快照</button>` : ''}`}
          <span class="spacer"></span>
          ${ui.screen === 'fact-review' ? '' : `<span class="tiny faint">${ui.centerTab === 'evidence' ? '支持多选后批量关联' : '多选 Chunk 可摘录为一条 Evidence'}</span>`}
        </div>
      </div>
      <div id="center-results" class="panel-body" data-scroll-key="center-results">
        ${renderCenterResults()}
      </div>
    </section>`;
}

function renderCenterResults() {
  if (ui.centerTab === 'evidence') return renderEvidenceCandidates();
  return renderChunkCandidates();
}

function renderEvidenceCandidates() {
  const items = rows('evidences').filter(evidenceMatches);
  return `
    <div class="result-summary">
      <span>找到 ${items.length} 条 Evidence${ui.search ? ` · “${esc(ui.search)}”` : ''}</span>
      <span>${ui.selectedEvidenceIds.size} 条已选择</span>
    </div>
    ${ui.selectedEvidenceIds.size ? `
      <div class="selection-strip">
        ${icon('check')}
        <span>已选择 ${ui.selectedEvidenceIds.size} 条，关联后共同支撑当前 Fact。</span>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-primary" data-action="link-selected-evidence" type="button" ${ui.factId ? '' : 'disabled'}>
          ${icon('link')} 关联到 ${esc(ui.factId || 'Fact')}
        </button>
        <button class="btn btn-sm btn-ghost" data-action="clear-evidence-selection" type="button">清空</button>
      </div>` : ''}
    <div class="result-list">
      ${items.length ? items.map(renderEvidenceCandidate).join('') : emptyState({
        title: '没有匹配的 Evidence',
        copy: ui.search || ui.filters.status || ui.filters.document || ui.filters.topic
          ? '试换关键词或清空筛选，也可以切到原始 Chunk 新摘录一条。'
          : '还没有 Evidence。切到原始 Chunk，选择原文后创建第一条。',
        compact: true,
        actions: `<button class="btn btn-sm btn-outline" data-action="switch-center" data-tab="chunk" type="button">${icon('chunk')} 去选 Chunk</button>`,
      })}
    </div>`;
}

function renderEvidenceCandidate(row) {
  const selected = ui.selectedEvidenceIds.has(row.evidence_id);
  const linked = evidenceIdsOfFact(ui.factId).includes(row.evidence_id);
  const chunkIds = chunkIdsOfEvidence(row.evidence_id);
  const chunks = chunkIds.map(localChunk).filter(Boolean);
  const documentName = chunks[0]?.document_name || '';
  const page = chunks[0]?.page || '';
  return `
    <article class="candidate-card ${selected ? 'selected' : ''} ${ui.previewEvidenceId === row.evidence_id ? 'active-preview' : ''}" data-action="preview-evidence" data-id="${attr(row.evidence_id)}">
      <button class="check ${selected ? 'checked' : ''}" data-action="toggle-evidence" data-id="${attr(row.evidence_id)}" type="button" aria-label="选择 ${attr(row.evidence_id)}">${selected ? icon('check') : ''}</button>
      <div class="candidate-main">
        <div class="candidate-top">
          <span class="candidate-title">${esc(row.title)}</span>
          ${statusChip(row.status)}
          ${linked ? '<span class="chip good">已关联当前 Fact</span>' : ''}
          <span class="candidate-score">${esc(row.evidence_id)}</span>
        </div>
        <div class="candidate-body">${esc(compactExcerpt(row.excerpt, 190))}</div>
        <div class="candidate-foot">
          ${documentName ? `<span>${icon('doc')} ${esc(documentName)}</span><span>${esc(pageLabel(page))}</span>` : '<span class="faint">尚未绑定来源 Chunk</span>'}
          <span class="spacer"></span>
          <button class="icon-btn link-danger" data-action="delete-evidence" data-id="${attr(row.evidence_id)}" type="button" aria-label="删除 ${attr(row.evidence_id)}" title="删除 ${attr(row.evidence_id)}">${icon('trash')}</button>
          ${chunkIds.slice(0, 3).map((chunkId) => `<button class="chunk-ref" data-action="preview-chunk" data-id="${attr(chunkId)}" type="button" title="预览 ${attr(chunkId)}">${esc(chunkId)}</button>`).join('')}
          ${chunkIds.length > 3 ? `<span class="chip plain">+${chunkIds.length - 3}</span>` : ''}
        </div>
      </div>
    </article>`;
}

function renderChunkCandidates() {
  const items = chunkPool().filter(chunkMatches);
  const isRemote = Boolean(ui.remoteSearchTerm);
  const draftLabel = ui.editorDraft?.mode === 'edit' ? '加入当前 Evidence' : '用选中 Chunk 摘录';
  return `
    <div class="result-summary">
      <span>${isRemote ? `RAGFlow Top ${ui.remoteMeta?.top_k || ui.topK} · ${items.length} 个 Chunk` : `本地 Chunk 快照 · ${items.length} 个`}</span>
      <span>${ui.remoteMeta?.latency_ms ? `${ui.remoteMeta.latency_ms} ms` : '按需检索'}</span>
    </div>
    ${!isRemote ? `
      <div class="semantic-note">
        ${icon('info')}
        <span>当前显示已保存的 Chunk 快照。输入关键词后点“检索”，会用当前 RAGFlow 配置实时取 Top-K。</span>
      </div>` : ''}
    ${ui.selectedChunkIds.size ? `
      <div class="selection-strip">
        ${icon('chunk')}
        <span>已选择 ${ui.selectedChunkIds.size} 个 Chunk。</span>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-primary" data-action="draft-from-chunks" type="button">
          ${icon('plus')} ${esc(draftLabel)}
        </button>
        <button class="btn btn-sm btn-outline" data-action="show-auto-match-candidates" type="button">${icon('sparkle')} 查看自动匹配</button>
      </div>` : ''}
    <div class="result-list">
      ${items.length ? items.map(renderChunkCandidate).join('') : emptyState({
        title: isRemote ? 'RAGFlow 没有返回 Chunk' : '没有本地 Chunk 快照',
        copy: isRemote
          ? '试换问法、提高 Top K，或确认数据集与检索配置。'
          : '在搜索框输入问题后点“检索”，从 RAGFlow 选择原文。',
        compact: true,
        actions: isRemote ? '' : `<button class="btn btn-sm btn-primary" data-action="search-ragflow" type="button">${icon('search')} 检索 RAGFlow</button>`,
      })}
    </div>`;
}

function renderChunkCandidate(row) {
  const selected = ui.selectedChunkIds.has(row.chunk_id);
  const added = ui.editorDraft?.chunkIds?.includes(row.chunk_id);
  return `
    <article class="candidate-card ${selected ? 'selected' : ''} ${ui.previewChunkId === row.chunk_id ? 'active-preview' : ''}" data-action="preview-chunk" data-id="${attr(row.chunk_id)}">
      <button class="check ${selected ? 'checked' : ''}" data-action="toggle-chunk" data-id="${attr(row.chunk_id)}" type="button" aria-label="选择 ${attr(row.chunk_id)}">${selected ? icon('check') : ''}</button>
      <div class="candidate-main">
        <div class="candidate-top">
          <span class="candidate-title">${esc(row.document_name || row.document_id || '未命名文档')}</span>
          ${added ? '<span class="chip good">已在草稿</span>' : ''}
          <span class="candidate-score">${row.similarity ? `相似度 ${similarityText(row.similarity)}` : esc(row.source === 'manual' ? '手工' : '')}</span>
        </div>
        <div class="candidate-body">${esc(compactExcerpt(row.content, 220))}</div>
        <div class="candidate-foot">
          <button class="chunk-ref" data-action="preview-chunk" data-id="${attr(row.chunk_id)}" type="button">${esc(row.chunk_id)}</button>
          ${availabilityButton(row)}
          <span>${esc(pageLabel(row.page))}</span>
          ${row.document_id ? `<span class="truncate">${esc(row.document_id)}</span>` : ''}
        </div>
      </div>
    </article>`;
}

function emptyState({
  title,
  copy = '',
  actions = '',
  iconName = 'info',
}) {
  return `
    <div class="empty">
      <span class="empty-icon">${icon(iconName)}</span>
      <p class="empty-title">${esc(title)}</p>
      ${copy ? `<p class="empty-copy">${esc(copy)}</p>` : ''}
      ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
    </div>`;
}

function apiErrorText(error) {
  const message = text(error?.message) || '请求失败';
  const details = Array.isArray(error?.details)
    ? error.details.map((item) => text(item)).filter(Boolean).slice(0, 4)
    : [];
  return details.length ? `${message}：${details.join('；')}` : message;
}

function currentDraftChunks() {
  return unique(ui.editorDraft?.chunkIds || []).map(findChunk).filter(Boolean);
}

function sameIdSet(left, right) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function evidenceDraftIsDirty() {
  const draft = ui.editorDraft;
  if (!draft) return false;
  if (draft.mode === 'create') {
    return Boolean(
      text(draft.title)
      || text(draft.excerpt)
      || unique(draft.chunkIds).length
      || draft.status !== 'draft',
    );
  }
  const row = evidence(draft.evidence_id);
  if (!row) return false;
  return text(draft.title) !== text(row.title)
    || text(draft.excerpt) !== text(row.excerpt)
    || draft.status !== row.status
    || !sameIdSet(draft.chunkIds, chunkIdsOfEvidence(row.evidence_id));
}

function evidenceDraftBody() {
  const draft = ui.editorDraft;
  if (!draft) {
    toast('当前没有可保存的 Evidence 草稿', 'error');
    return null;
  }
  const title = text(draft.title);
  const excerpt = text(draft.excerpt);
  if (!title) {
    toast('请填写证据标题', 'error');
    return null;
  }
  if (!excerpt) {
    toast('请填写证据摘录', 'error');
    return null;
  }
  if (!fact(ui.factId)) {
    toast('请先在左侧选择 Fact，再保存 Evidence', 'error');
    return null;
  }

  const chunks = currentDraftChunks();
  const chunkIds = unique(draft.chunkIds);
  if (chunks.length !== chunkIds.length) {
    toast('有 Chunk 已不可用，请从草稿中移除后再保存', 'error');
    return null;
  }
  return {
    evidence_id: draft.mode === 'edit' ? draft.evidence_id : undefined,
    title,
    excerpt,
    status: draft.status || 'draft',
    fact_id: ui.factId,
    chunk_ids: chunkIds,
    chunks: chunks.map(normalizeChunkForSave),
  };
}

function renderDetailPanel() {
  const chunk = findChunk(ui.previewChunkId)
    || findChunk(ui.editorDraft?.chunkIds?.[0])
    || null;
  const draft = ui.editorDraft;
  const chunks = currentDraftChunks();
  const previewEvidence = evidence(ui.previewEvidenceId);

  return `
    <aside class="panel detail-panel">
      <div class="panel-head">
        <div class="panel-title">
          <h2>源文档预览</h2>
          ${chunk ? idChip(chunk.chunk_id) : ''}
        </div>
      </div>
      <div class="panel-body">
        <section class="detail-section">
          <div class="detail-head">
            <h3>所选 Chunk 详情</h3>
            ${previewEvidence ? `<span class="tiny muted">${esc(previewEvidence.evidence_id)}</span>` : ''}
          </div>
          ${chunk ? `
            <div class="doc-banner">
              <span class="doc-icon">${icon('doc')}</span>
              <span class="doc-copy">
                <strong>${esc(chunk.document_name || chunk.document_id || '未命名文档')}</strong>
                <span>${esc(chunk.document_id || 'document_id 未返回')} · ${esc(pageLabel(chunk.page))}</span>
              </span>
            </div>
            <div class="preview-text" data-scroll-key="chunk-preview">${esc(chunk.content)}</div>
            <dl class="metadata-grid">
              <dt>Chunk</dt>
              <dd>${esc(chunk.chunk_id)}</dd>
              <dt>数据集</dt>
              <dd>${esc(chunk.dataset_id || '未标注')}</dd>
              <dt>文档 ID</dt>
              <dd title="${attr(chunk.document_id || '')}">${esc(chunk.document_id || '未标注')}</dd>
              <dt>页码</dt>
              <dd>${esc(pageLabel(chunk.page))}</dd>
              <dt>来源</dt>
              <dd>${esc(chunk.source === 'manual' ? '手工录入' : 'RAGFlow')}</dd>
              ${chunk.similarity ? `<dt>相似度</dt><dd>${esc(similarityText(chunk.similarity))}</dd>` : ''}
            </dl>` : `
            <div class="preview-empty">
              <div>
                ${icon('chunk')}
                <span>选择一条 Chunk 查看完整原文</span>
              </div>
            </div>`}
        </section>

        <section class="detail-section">
          <div class="detail-head">
            <h3>Evidence 引用的 Chunk</h3>
            <span class="tiny muted">${chunks.length} 个</span>
          </div>
          ${chunks.length ? `
            <div class="linked-chunk-list">
              ${chunks.map((item) => `
                <div class="linked-chunk">
                  ${icon('chunk')}
                  <button class="name" data-action="preview-chunk" data-id="${attr(item.chunk_id)}" type="button" title="${attr(item.content)}">
                    ${esc(item.document_name || item.chunk_id)} · ${esc(item.chunk_id)}
                  </button>
                  <button class="unlink" data-action="remove-draft-chunk" data-id="${attr(item.chunk_id)}" type="button" aria-label="从草稿移除 ${attr(item.chunk_id)}" title="从草稿移除">${icon('x')}</button>
                </div>`).join('')}
            </div>` : `
            <div class="readiness-box blocked">
              <div class="readiness-title">${icon('info')} 尚未引用 Chunk</div>
              <p class="hint">可以保存这条 Evidence，但召回评分时只有绑定 Chunk 的 Evidence 才能计分。</p>
            </div>`}
        </section>

        <section class="detail-section">
          ${draft ? `
            <div class="editor-card">
              <div class="editor-card-head">
                <h3>${draft.mode === 'edit' ? `编辑 ${esc(draft.evidence_id)}` : '从 Chunk 摘录新 Evidence'}</h3>
                ${draft.mode === 'edit' ? statusChip(draft.status) : '<span class="chip">草稿</span>'}
              </div>
              <div class="editor-card-body">
                <label class="field">
                  <span class="field-label">证据标题 <span class="req">*</span></span>
                  <input class="input" id="evidence-title" data-bind="evidence-title" value="${attr(draft.title)}" placeholder="填写证据标题，保留限定条件" maxlength="160">
                </label>
                <label class="field">
                  <span class="field-label">证据摘录 <span class="req">*</span></span>
                  <textarea class="textarea" id="evidence-excerpt" data-bind="evidence-excerpt" placeholder="保留限定条件、数字、单位和否定语义" maxlength="500">${esc(draft.excerpt)}</textarea>
                  <span class="char-count">${text(draft.excerpt).length} / 500</span>
                </label>
                <label class="field">
                  <span class="field-label">审核状态</span>
                  <select class="select" id="evidence-status" data-bind="evidence-status">
                    ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${draft.status === value ? 'selected' : ''}>${label}</option>`).join('')}
                  </select>
                </label>
                <div class="row wrap">
                  <span class="tiny muted">关联 ${esc(draft.factId || '未选择 Fact')}</span>
                  <span class="chip plain">${chunks.length} Chunk</span>
                  ${ui.factId ? `<span class="chip good">保存后关联当前 Fact</span>` : ''}
                </div>
                <div class="form-actions">
                  <button class="btn btn-primary btn-block" data-action="save-evidence" type="button">
                    ${icon('check')} ${draft.mode === 'edit' ? '更新 Evidence' : '创建 Evidence'}
                  </button>
                  ${draft.mode === 'edit' ? `<button class="btn btn-danger" data-action="delete-evidence" data-id="${attr(draft.evidence_id)}" type="button" aria-label="删除 Evidence" title="删除 Evidence">${icon('trash')}</button>` : ''}
                </div>
              </div>
            </div>` : `
            ${emptyState({
              title: '选择 Fact 后开始摘录',
              copy: '在左侧选择 Fact，再从中部选择已有 Evidence 或原始 Chunk。',
              iconName: 'fact',
            })}`}
        </section>
      </div>
    </aside>`;
}

function renderActionDock() {
  const linked = evidenceOfFact(ui.factId);
  const selected = [...ui.selectedEvidenceIds].map(evidence).filter(Boolean);
  const hasPending = selected.length > 0;
  return `
    <div class="action-dock">
      <div class="dock-summary">
        <strong>${esc(ui.factId ? `${ui.factId} · ${currentFact()?.statement || ''}` : '尚未选择 Fact')}</strong>
        <span>已关联 ${linked.length} 条 Evidence · ${chunkIdsOfFact(ui.factId).length} 个 Chunk</span>
      </div>
      <div class="dock-chips">
        ${linked.map((item) => `
          <span class="dock-chip" title="${attr(item.excerpt)}">
            ${idChip(item.evidence_id)}
            <span>${esc(item.title)}</span>
            <button class="btn-link" data-action="unlink-fact-evidence" data-id="${attr(item.evidence_id)}" type="button" aria-label="解除关联 ${attr(item.evidence_id)}">${icon('x')}</button>
          </span>`).join('')}
        ${selected.map((item) => `
          <span class="dock-chip" title="待关联">
            ${idChip(item.evidence_id)}
            <span>${esc(item.title)} · 待关联</span>
            <button class="btn-link" data-action="remove-selected-evidence" data-id="${attr(item.evidence_id)}" type="button" aria-label="取消选择 ${attr(item.evidence_id)}">${icon('x')}</button>
          </span>`).join('')}
        ${!linked.length && !selected.length ? '<span class="tiny faint">可在中部多选 Evidence 后关联，或从 Chunk 新摘录。</span>' : ''}
      </div>
      <div class="dock-actions">
        <div class="relation-toggle" aria-label="Evidence 关联关系">
          <button class="${ui.relationOperator === 'OR' ? 'active' : ''}" data-action="set-relation" data-operator="OR" type="button" ${ui.factId ? '' : 'disabled'} title="任一 Evidence 命中即可">OR</button>
          <button class="${ui.relationOperator === 'AND' ? 'active' : ''}" data-action="set-relation" data-operator="AND" type="button" ${ui.factId ? '' : 'disabled'} title="每条有 Chunk 的 Evidence 都必须命中">AND</button>
        </div>
        <button class="btn btn-soft" data-action="link-selected-evidence" type="button" ${ui.factId && hasPending ? '' : 'disabled'}>
          ${icon('link')} 保存关联
        </button>
        <button class="btn btn-outline" data-action="save-association-next" type="button" ${ui.factId ? '' : 'disabled'}>保存并下一条</button>
      </div>
    </div>`;
}

function builderFactLink(factId) {
  return ui.builder.factLinks.find((link) => link.fact_id === factId) || null;
}

function toggleBuilderFact(factId) {
  if (!fact(factId)) return;
  const existing = builderFactLink(factId);
  if (existing) {
    ui.builder.factLinks = ui.builder.factLinks.filter((link) => link.fact_id !== factId);
    return;
  }
  ui.builder.factLinks = [...ui.builder.factLinks, { fact_id: factId, requirement: 'required', group_id: '' }];
}

function renderBuilderCandidate(candidate) {
  return `
    <article class="suggestion ${candidate.selected ? 'selected' : ''}">
      <button class="check ${candidate.selected ? 'checked' : ''}" data-action="toggle-candidate" data-id="${attr(candidate.id)}" type="button" aria-label="${candidate.selected ? '取消选择' : '选择'}候选 Query">
        ${candidate.selected ? icon('check') : ''}
      </button>
      <div class="suggestion-main">
        <textarea class="suggestion-input" id="builder-candidate-${attr(candidate.id)}" data-bind="builder-candidate" data-id="${attr(candidate.id)}" rows="2" maxlength="200">${esc(candidate.text)}</textarea>
        <div class="row wrap">
          ${variantChip(candidate.variant_type)}
          <select class="select compact" id="builder-candidate-type-${attr(candidate.id)}" data-bind="builder-candidate-type" data-id="${attr(candidate.id)}" aria-label="Query 类型">
            ${Object.entries(VARIANT_LABELS).map(([value, label]) => `<option value="${value}" ${candidate.variant_type === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        ${candidate.rationale ? `<p class="suggestion-rationale">${esc(candidate.rationale)}</p>` : ''}
      </div>
    </article>`;
}

function renderBuilder() {
  const selectedCount = ui.builder.candidates.filter((candidate) => candidate.selected && text(candidate.text)).length;
  const candidateRows = ui.builder.candidates.filter(builderCandidateVisible);
  const selectedFacts = ui.builder.factLinks.map((link) => ({ ...link, fact: fact(link.fact_id) })).filter((link) => link.fact);
  const factRows = rows('facts').filter((row) => builderFactVisible(row, builderFactLink(row.fact_id)));
  const builderAssignmentOptions = assignmentOptions(ui.builder.factLinks);
  const selectedText = selectedCount ? `${selectedCount} 条已选择` : '尚未选择候选';
  return `
    <section class="screen">
      <div class="screen-head">
        <div>
          <h1>构造 Query</h1>
          <p>先用人工 Fact 固定事实边界，再生成主问、同义句和口语化变体。第一条选中的 Query 会成为本组主问。</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-outline" data-action="reset-builder" type="button">${icon('refresh')} 重置</button>
          <button class="btn btn-primary" data-action="submit-builder" type="button" ${ui.busy ? 'disabled' : ''}>${icon('plus')} 创建 Query 组</button>
        </div>
      </div>
      <div class="builder-grid">
        <section class="panel builder-panel">
          <div class="panel-head">
            <div class="panel-title">
              <h2>1. 设定主问</h2>
              <small>事实先于问法</small>
            </div>
          </div>
          <div class="panel-body">
            <div class="builder-form">
              <label class="field">
                <span class="field-label">主问草稿</span>
                <textarea class="textarea query-textarea" id="builder-seed" data-bind="builder-seed" placeholder="输入主问，保留关键限定" maxlength="500">${esc(ui.builder.seedText)}</textarea>
                <span class="char-count">${text(ui.builder.seedText).length} / 500</span>
              </label>
              <label class="field">
                <span class="field-label">期望行为</span>
                <select class="select" id="builder-behavior" data-bind="builder-behavior">
                  ${Object.entries(BEHAVIOR_LABELS).map(([value, label]) => `<option value="${value}" ${ui.builder.expectedBehavior === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </label>
              <div class="readiness-box ${selectedFacts.length ? 'ready' : 'blocked'}">
                <div class="readiness-title">${icon(selectedFacts.length ? 'check' : 'alert')} ${selectedFacts.length} 条 Fact · ${esc(queryFactCountSummary(ui.builder.factLinks))}</div>
                ${selectedFacts.length ? `
                  <ul class="readiness-list">
                    ${selectedFacts.slice(0, 6).map((link) => `<li class="ok">${icon('fact')} ${esc(link.fact.fact_id)} · ${esc(builderAssignmentOptions.find((option) => option.value === assignmentValue(link))?.label || REQUIREMENT_LABELS[link.requirement] || link.requirement)}</li>`).join('')}
                  </ul>` : '<p class="hint">在中间面板勾选至少一条 Fact，生成与提交都需要这道事实边界。</p>'}
              </div>
              ${ui.builder.model ? `<p class="hint">最近一次生成模型：${esc(ui.builder.model)}</p>` : ''}
            </div>
          </div>
        </section>

        <section class="panel builder-panel">
          <div class="panel-head">
            <div class="panel-title">
              <h2>2. 选择 Facts</h2>
              <small>${rows('facts').length} 条可用</small>
            </div>
          </div>
          <div class="panel-body">
            ${rows('facts').length ? `
              ${listSearchBox({
                id: 'builder-fact-search',
                bind: 'builder-fact-search',
                value: ui.builder.factSearch,
                placeholder: '搜索 Fact ID、陈述、主题、状态、类型或重要性',
                clearAction: 'clear-builder-fact-search',
              })}
              <div class="fact-select-list">
                ${factRows.map((row) => {
                  const link = builderFactLink(row.fact_id);
                  return `
                    <div class="fact-option ${link ? 'selected' : ''}">
                      <button class="check ${link ? 'checked' : ''}" data-action="builder-toggle-fact" data-id="${attr(row.fact_id)}" type="button" aria-label="${link ? '移除' : '添加'} ${attr(row.fact_id)}">${link ? icon('check') : ''}</button>
                      <div class="fact-option-main">
                        <div class="fact-option-head">
                          ${idChip(row.fact_id)}
                          <span class="chip">${esc(row.importance || 'P1')}</span>
                          ${statusChip(row.status)}
                        </div>
                        <div class="fact-option-statement">${esc(row.statement)}</div>
                        <div class="fact-option-foot">
                          <span class="tiny muted">${esc(row.topic || '未分类')} · ${esc(factTypeLabel(row.fact_type))}</span>
                          <span class="spacer"></span>
                          ${assignmentSelect(link || { requirement: 'required', group_id: '' }, ui.builder.factLinks, 'builder-set-assignment', row.fact_id, !link, builderAssignmentOptions)}
                        </div>
                      </div>
                    </div>`;
                }).join('')}
              </div>
              ${factRows.length ? '' : emptyState({
                title: '没有匹配的 Fact',
                copy: '清空搜索词后再试。',
              })}` : emptyState({
                title: '还没有 Fact',
                copy: 'Fact 只能手工编造。先录入一条事实，再回来构造 Query。',
                actions: `<button class="btn btn-primary" data-action="navigate" data-screen="facts" type="button">${icon('fact')} 去录入 Fact</button>`,
              })}
          </div>
        </section>

        <section class="panel builder-panel ai-panel">
          <div class="panel-head">
            <div class="panel-title">
              <h2>3. 生成与审校</h2>
              <small>${esc(selectedText)}</small>
            </div>
          </div>
          <div class="panel-body">
            <div class="ai-intro">
              候选必须先选 Fact。LLM 只负责改写问法，数字、单位、条件、否定语义以人工 Fact 为准。
            </div>
            ${ui.builder.generating || !ui.builder.candidates.length ? '' : `
              ${listSearchBox({
                id: 'builder-candidate-search',
                bind: 'builder-candidate-search',
                value: ui.builder.candidateSearch,
                placeholder: '搜索候选文本、理由、类型或 ID',
                clearAction: 'clear-builder-candidate-search',
              })}`}
            ${ui.builder.generating ? `
              <div class="generation-state"><span class="spinner"></span><span>正在生成主问与变体…</span></div>` : ui.builder.candidates.length ? `
              ${candidateRows.length ? `
                <div class="suggestion-list">
                  ${candidateRows.map(renderBuilderCandidate).join('')}
                </div>` : emptyState({
                  title: '没有匹配的候选',
                  copy: '清空搜索词后再试。',
                  iconName: 'sparkle',
                  compact: true,
                })}` : emptyState({
                title: '还没有候选',
                copy: ui.builder.factLinks.length
                  ? '点击生成候选，或直接在左侧主问草稿中手写后提交。'
                  : '先选择 Fact。',
                iconName: 'sparkle',
                compact: true,
              })}
            ${ui.builder.error ? `<p class="error-text">${esc(ui.builder.error)}</p>` : ''}
            <div class="ai-footer">
              <button class="btn btn-primary btn-block" data-action="generate-queries" type="button" ${ui.builder.generating || !ui.builder.factLinks.length ? 'disabled' : ''}>
                ${icon('sparkle')} ${ui.builder.candidates.length ? '重新生成候选' : '用 LLM 生成候选'}
              </button>
              <button class="btn btn-outline btn-block" data-action="submit-builder" type="button" ${ui.busy ? 'disabled' : ''}>${icon('check')} 提交已选 Query</button>
            </div>
          </div>
        </section>
      </div>
    </section>`;
}

function queryMatchesSearch(row) {
  const term = normalizeText(ui.querySearch);
  if (!term) return true;
  return normalizeText(`${row.query_id} ${row.text} ${row.notes || ''} ${row.parent_query_id || ''}`).includes(term);
}

function filteredQueryGroups() {
  const all = sortedQueries();
  const rootIds = new Set(all.filter((row) => !row.parent_query_id || !query(row.parent_query_id)).map((row) => row.query_id));
  return [...rootIds].map((rootId) => {
    const root = query(rootId);
    const variants = all.filter((row) => row.parent_query_id === rootId);
    const visible = [root, ...variants].filter((row) => row
      && (!ui.queryStatus || row.status === ui.queryStatus)
      && (!ui.queryClaimFilter || queryClaimFilterMatches(queryClaim(row.query_id)))
      && queryMatchesSearch(row));
    return { root, variants, visible };
  }).filter((group) => group.visible.length);
}

function queryClaimFilterMatches(claim) {
  if (ui.queryClaimFilter === 'mine') return Boolean(claim && claim.owner === ui.reviewerName);
  if (ui.queryClaimFilter === 'others') return Boolean(claim && claim.owner !== ui.reviewerName);
  return !claim;
}

function queryClaimChip(row) {
  const claim = queryClaim(row.query_id);
  if (!claim) return '<span class="chip plain">未领取</span>';
  const mine = claim.owner === ui.reviewerName;
  const action = mine ? 'release-query-claim' : 'renew-query-claim';
  const title = mine ? '点击释放领取' : '点击尝试续期';
  return `<button class="chip chip-button ${mine ? 'claim-mine' : 'claim-other'}" data-action="${action}" data-id="${attr(row.query_id)}" type="button" title="${title}" aria-label="${title}">${icon('lock')} ${esc(claim.owner)}</button>`;
}

function queryListRow(row, depth = 0) {
  const links = factsOfQuery(row.query_id);
  const counts = queryFactRequirementCounts(links);
  return `
    <tr class="${depth ? 'variant-row' : ''}">
      <td>
        <div class="query-cell">
          ${depth ? '<span class="variant-mark">↳</span>' : ''}
          <strong>${esc(row.text)}</strong>
          <small>${esc(row.query_id)}${row.parent_query_id ? ` · 父级 ${esc(row.parent_query_id)}` : ' · 根 Query'}</small>
        </div>
      </td>
      <td>${variantChip(row.variant_type)}</td>
      <td>${statusChip(row.status)}</td>
      <td>${queryClaimChip(row)}</td>
      <td>${esc(BEHAVIOR_LABELS[row.expected_behavior] || row.expected_behavior)}</td>
      <td>${links.length} Facts <span class="tiny muted">/${counts.requiredGroups} 必需组 · ${counts.requiredSingles} 单项 · ${counts.alternatives} 任选组 · ${counts.conditions} 条件</span></td>
      <td class="hide-sm">${esc(compactExcerpt(row.notes, 50) || '—')}</td>
      <td>
        <div class="table-actions">
          <button class="icon-btn" data-action="open-query" data-id="${attr(row.query_id)}" type="button" title="打开审核">${icon('eye')}</button>
          <button class="icon-btn" data-action="edit-query" data-id="${attr(row.query_id)}" type="button" title="编辑">${icon('edit')}</button>
          <button class="icon-btn" data-action="claim-query" data-id="${attr(row.query_id)}" type="button" title="领取">${icon('lock')}</button>
          <button class="icon-btn" data-action="approve-query" data-id="${attr(row.query_id)}" data-advance="false" type="button" title="确认" ${row.status === 'approved' ? 'disabled' : ''}>${icon('check')}</button>
          <button class="icon-btn link-danger" data-action="delete-query" data-id="${attr(row.query_id)}" type="button" title="删除">${icon('trash')}</button>
        </div>
      </td>
    </tr>`;
}

function renderQueryList() {
  const groups = filteredQueryGroups();
  const visibleCount = groups.reduce((total, group) => total + group.visible.length, 0);
  return `
    <section class="screen">
      <div class="screen-head">
        <div>
          <h1>Query 清单</h1>
          <p>按主问分组查看同义句和口语化变体。领取只用于分工避重，过期后可被他人领取。</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-outline" data-action="show-reviewer-name" type="button">${icon('user')} ${ui.reviewerName ? esc(ui.reviewerName) : '设置显示名'}</button>
          <button class="btn btn-primary" data-action="navigate" data-screen="builder" type="button">${icon('plus')} 构造 Query</button>
        </div>
      </div>
      <section class="panel">
        <div class="list-toolbar">
          <label class="search-box">
            ${icon('search')}
            <input class="input" id="query-list-search" data-bind="query-list-search" value="${attr(ui.querySearch)}" placeholder="搜索 Query、ID 或备注" autocomplete="off">
            ${ui.querySearch ? `<button class="search-clear" data-action="clear-query-search" type="button" aria-label="清空">${icon('x')}</button>` : ''}
          </label>
          <select class="select" data-action="filter-query-status" aria-label="Query 状态">
            <option value="">全部状态</option>
            ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${ui.queryStatus === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <select class="select" data-action="filter-query-claim" aria-label="领取状态">
            <option value="">全部领取</option>
            <option value="free" ${ui.queryClaimFilter === 'free' ? 'selected' : ''}>未领取</option>
            <option value="mine" ${ui.queryClaimFilter === 'mine' ? 'selected' : ''}>我领取的</option>
            <option value="others" ${ui.queryClaimFilter === 'others' ? 'selected' : ''}>他人领取</option>
          </select>
          <span class="spacer"></span>
          <span class="tiny muted">显示 ${visibleCount} / ${rows('queries').length} 条</span>
        </div>
        ${groups.length ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Query</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>领取</th>
                  <th>期望行为</th>
                  <th>Fact 依赖</th>
                  <th class="hide-sm">备注</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${groups.map((group) => group.visible.map((row) => queryListRow(row, row.query_id === group.root.query_id ? 0 : 1)).join('')).join('')}
              </tbody>
            </table>
          </div>` : emptyState({
            title: rows('queries').length ? '没有匹配的 Query' : '还没有 Query',
            copy: rows('queries').length ? '换一个关键词或清空状态筛选。' : '从人工 Fact 出发构造第一条主问。',
            actions: rows('queries').length
              ? `<button class="btn btn-outline" data-action="clear-query-search" type="button">${icon('refresh')} 清空筛选</button>`
              : `<button class="btn btn-primary" data-action="navigate" data-screen="builder" type="button">${icon('plus')} 构造 Query</button>`,
          })}
      </section>
    </section>`;
}

function factMatchesSearch(row) {
  const term = normalizeText(ui.factSearch);
  if (!term) return true;
  return normalizeText(`${row.fact_id} ${row.statement} ${row.topic || ''} ${row.source_note || ''}`).includes(term);
}

function setFactDraft(id) {
  const row = fact(id);
  if (row) {
    ui.factDraft = {
      mode: 'edit',
      fact_id: row.fact_id,
      statement: row.statement || '',
      topic: row.topic || '',
      fact_type: row.fact_type || factTypeOptions()[0]?.id || '',
      importance: row.importance || 'P1',
      source_note: row.source_note || '',
      status: row.status || 'draft',
    };
    return;
  }
  ui.factDraft = {
    mode: 'create',
    fact_id: '',
    statement: '',
    topic: '',
    fact_type: factTypeOptions()[0]?.id || '',
    importance: 'P1',
    source_note: '',
    status: 'draft',
  };
}

function renderFactEditor() {
  const draft = ui.factDraft;
  if (!draft) {
    return `
      <section class="panel">
        ${emptyState({
          title: '选择或新建一条 Fact',
          copy: 'Fact 是人工事实，不从文档自动抽取。',
          actions: `<button class="btn btn-primary" data-action="new-fact" type="button">${icon('plus')} 新建 Fact</button>`,
        })}
      </section>`;
  }

  const isEdit = draft.mode === 'edit';
  const evidenceRows = isEdit ? evidenceOfFact(draft.fact_id) : [];
  const chunkIds = isEdit ? chunkIdsOfFact(draft.fact_id) : [];
  const queryLinks = isEdit ? rows('query_facts').filter((link) => link.fact_id === draft.fact_id) : [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div class="panel-title">
          <h2>${isEdit ? `编辑 ${esc(draft.fact_id)}` : '新建 Fact'}</h2>
          <small>${isEdit ? `${queryLinks.length} 条 Query 引用` : '保存后自动分配 ID'}</small>
        </div>
        <div class="table-actions">
          ${isEdit ? `<button class="btn btn-sm btn-outline" data-action="return-from-facts" type="button">${icon('left')} 返回</button>` : ''}
          ${isEdit ? `<button class="btn btn-sm btn-outline" data-action="open-fact-workbench" data-id="${attr(draft.fact_id)}" type="button">${icon('link')} 去关联证据</button>` : ''}
          ${isEdit ? `<button class="btn btn-sm btn-outline" data-action="open-fact-evidence-review" data-id="${attr(draft.fact_id)}" type="button">${icon('chunk')} 查找来源 Chunk</button>` : ''}
          ${isEdit ? `<button class="icon-btn link-danger" data-action="delete-fact" data-id="${attr(draft.fact_id)}" type="button" title="删除 Fact">${icon('trash')}</button>` : ''}
        </div>
      </div>
      <div class="fact-editor-body">
        ${isEdit ? `
          <div class="coverage-strip">
            <div class="coverage-cell"><span>关联 Query</span><strong>${queryLinks.length}</strong></div>
            <div class="coverage-cell"><span>Evidence</span><strong>${evidenceRows.length}</strong></div>
            <div class="coverage-cell"><span>覆盖 Chunk</span><strong>${chunkIds.length}</strong></div>
          </div>` : ''}
        <label class="field">
          <span class="field-label">事实陈述 <span class="req">*</span></span>
          <textarea class="textarea" id="fact-statement" data-bind="fact-statement" placeholder="用可核验的完整句子描述事实，保留数字、单位、条件和否定" maxlength="1000">${esc(draft.statement)}</textarea>
          <span class="char-count">${text(draft.statement).length} / 1000</span>
        </label>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">主题</span>
            <input class="input" id="fact-topic" data-bind="fact-topic" value="${attr(draft.topic)}" placeholder="例如：功能范围或适用条件" maxlength="120" list="fact-topic-options">
            <datalist id="fact-topic-options">
              ${topicOptions().map((topic) => `<option value="${attr(topic.name)}" label="${attr(topic.id)}"></option>`).join('')}
            </datalist>
          </label>
          <label class="field">
            <span class="field-label">事实类型</span>
            <select class="select" id="fact-type" data-bind="fact-type">
              ${factTypeOptions().map((item) => `<option value="${attr(item.id)}" ${draft.fact_type === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">重要度</span>
            <select class="select" id="fact-importance" data-bind="fact-importance">
              ${['P0', 'P1', 'P2'].map((value) => `<option value="${value}" ${draft.importance === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">审核状态</span>
            <select class="select" id="fact-status" data-bind="fact-status">
              ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${draft.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field-label">来源说明</span>
          <textarea class="textarea" id="fact-source-note" data-bind="fact-source-note" placeholder="记录手工编造依据，例如业务规则来源、适用时间或负责人确认" maxlength="1000">${esc(draft.source_note)}</textarea>
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" data-action="save-fact" type="button" ${ui.busy ? 'disabled' : ''}>${icon('check')} ${isEdit ? '保存 Fact' : '创建 Fact'}</button>
          ${isEdit ? `<button class="btn btn-outline" data-action="new-fact" type="button">${icon('plus')} 再建一条</button>` : ''}
        </div>
        ${isEdit ? `
          <div class="divider"></div>
          <div class="section-head">
            <h3>${icon('link')} 已关联 Evidence <span class="count">${evidenceRows.length}</span></h3>
          </div>
          ${evidenceRows.length ? `
            <div class="linked-evidence-list">
              ${evidenceRows.map((row) => {
                const count = chunkIdsOfEvidence(row.evidence_id).length;
                return `
                  <div class="linked-evidence-row">
                    <span class="doc-icon">${icon('fact')}</span>
                    <div class="copy">
                      <strong>${esc(row.evidence_id)} · ${esc(row.title)}</strong>
                      <small>${esc(compactExcerpt(row.excerpt, 110))} · ${count} Chunk</small>
                    </div>
                    <button class="btn btn-sm btn-outline" data-action="open-fact-evidence" data-id="${attr(row.evidence_id)}" type="button">查看证据</button>
                    ${statusChip(row.status)}
                  </div>`;
              }).join('')}
            </div>` : emptyState({
              title: '尚未关联 Evidence',
              copy: '进入工作台搜索已有 Evidence，或从 RAGFlow Chunk 摘录新的证据。',
              iconName: 'database',
              compact: true,
            })}
          <div class="formula-note">
            必需单项各计 1 项；必需组内每条都要命中且各自计分；每个任选组计 1 项，组内命中任一 Fact 即满足。当前 Fact 被 ${queryLinks.length} 条 Query 引用。
          </div>` : ''}
      </div>
    </section>`;
}

function renderFactLibrary() {
  const items = rows('facts').filter(factMatchesSearch);
  return `
    <section class="screen">
      <div class="screen-head">
        <div>
          <h1>Fact 库</h1>
          <p>事实由人工编写和维护。Evidence 负责提供可核验原文，Chunk 负责映射 RAGFlow 的可检索片段。</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-primary" data-action="new-fact" type="button">${icon('plus')} 新建 Fact</button>
        </div>
      </div>
      <div class="facts-layout">
        <section class="panel fact-list-panel">
          <div class="list-toolbar">
            <label class="search-box">
              ${icon('search')}
              <input class="input" id="fact-search" data-bind="fact-search" value="${attr(ui.factSearch)}" placeholder="搜索陈述、主题或 ID" autocomplete="off">
              ${ui.factSearch ? `<button class="search-clear" data-action="clear-fact-search" type="button" aria-label="清空">${icon('x')}</button>` : ''}
            </label>
            <span class="spacer"></span>
            <span class="tiny muted">${items.length} / ${rows('facts').length}</span>
          </div>
          <div class="panel-body" data-scroll-key="fact-list">
            ${items.length ? items.map((row) => {
              const evidenceCount = evidenceIdsOfFact(row.fact_id).length;
              const chunkCount = chunkIdsOfFact(row.fact_id).length;
              const active = ui.factDraft?.fact_id === row.fact_id;
              return `
                <button class="fact-library-item ${active ? 'active' : ''}" data-action="select-fact-draft" data-id="${attr(row.fact_id)}" type="button">
                  <span class="fact-topline">
                    ${idChip(row.fact_id)}
                    ${statusChip(row.status)}
                    <span class="chip">${esc(row.importance || 'P1')}</span>
                  </span>
                  <span class="statement">${esc(row.statement)}</span>
                  <span class="meta">
                    <span>${esc(row.topic || '未分类')}</span>
                    <span class="${evidenceCount ? 'ok' : 'gap'}">${evidenceCount} Evidence</span>
                    <span class="${chunkCount ? 'ok' : 'gap'}">${chunkCount} Chunk</span>
                  </span>
                </button>`;
            }).join('') : emptyState({
              title: rows('facts').length ? '没有匹配的 Fact' : '还没有 Fact',
              copy: rows('facts').length ? '换一个搜索词。' : '先写一条可核验的完整事实。',
              iconName: 'fact',
              actions: `<button class="btn btn-sm btn-primary" data-action="new-fact" type="button">${icon('plus')} 新建 Fact</button>`,
              compact: true,
            })}
          </div>
        </section>
        ${renderFactEditor()}
      </div>
    </section>`;
}

function ratioValue(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function renderFunnelRow({ label, note, value, total, tone = '' }) {
  const ratio = ratioValue(value, total);
  return `
    <div class="funnel-row">
      <div class="funnel-label">
        <strong>${esc(label)}</strong>
        <span>${esc(note)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${tone}" style="--bar-scale:${Math.max(0, Math.min(1, ratio))}" aria-hidden="true"></div>
      </div>
      <div class="funnel-value">${value} / ${total}</div>
    </div>`;
}

function renderGapCard({ count, label, target, params = {} }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return `
    <div class="gap-card">
      <div class="gap-num">${count}</div>
      <div class="gap-label">${esc(label)}</div>
      <div class="gap-link">
        <button class="btn-link" data-action="navigate" data-screen="${attr(target)}" ${Object.keys(params).length ? `data-params="${attr(query)}"` : ''} type="button">查看并处理 →</button>
      </div>
    </div>`;
}

function renderAttentionRow({ title, copy, action, id, screen, tone = '' }) {
  return `
    <div class="attention-row">
      <span class="recall-status">${icon(tone === 'ready' ? 'check' : tone === 'risk' ? 'alert' : 'info')}</span>
      <div class="attention-main">
        <strong>${esc(title)}</strong>
        <span>${esc(copy)}</span>
      </div>
      <button class="btn btn-sm btn-outline" data-action="${attr(action)}" data-id="${attr(id)}" data-screen="${attr(screen)}" type="button">打开</button>
    </div>`;
}

function overviewQueryVisible(row) {
  const term = normalizeText(ui.overviewSearch);
  if (!term) return true;
  return normalizeText(`${row.query_id} ${row.text} ${row.notes || ''} ${row.parent_query_id || ''} ${STATUS_LABELS[row.status] || row.status || ''}`).includes(term);
}

function overviewFactVisible(row) {
  const term = normalizeText(ui.overviewSearch);
  if (!term) return true;
  return normalizeText(`${row.fact_id} ${row.statement} ${row.topic || ''} ${factTypeLabel(row.fact_type)} ${STATUS_LABELS[row.status] || row.status || ''} ${row.importance || 'P1'}`).includes(term);
}

function overviewEvidenceVisible(row) {
  const term = normalizeText(ui.overviewSearch);
  if (!term) return true;
  return normalizeText(`${row.evidence_id} ${row.title} ${row.excerpt || ''}`).includes(term);
}

function renderOverview() {
  const facts = rows('facts');
  const queries = rows('queries');
  const evidences = rows('evidences');
  const chunks = rows('chunks');
  const gaps = ui.data?.gaps || {};
  const overviewSearchActive = Boolean(normalizeText(ui.overviewSearch));
  const approvedQueries = queries.filter((row) => row.status === 'approved').length;
  const factsWithEvidence = facts.filter((row) => evidenceIdsOfFact(row.fact_id).length > 0).length;
  const factsWithChunks = facts.filter((row) => chunkIdsOfFact(row.fact_id).length > 0).length;
  const queriesWithRequired = queries.filter((row) => queryFactLinks(row.query_id).some((link) => isScoringRequirement(link.requirement))).length;
  const evidenceWithChunks = evidences.filter((row) => chunkIdsOfEvidence(row.evidence_id).length > 0).length;
  const attentionQueries = queries
    .filter((row) => row.status !== 'approved' || !queryFactLinks(row.query_id).some((link) => isScoringRequirement(link.requirement)))
    .filter(overviewQueryVisible)
    .slice(0, 6);
  const attentionFacts = facts
    .filter((row) => !evidenceIdsOfFact(row.fact_id).length || !chunkIdsOfFact(row.fact_id).length)
    .filter(overviewFactVisible)
    .slice(0, 6);
  const attentionEvidence = evidences
    .filter((row) => !chunkIdsOfEvidence(row.evidence_id).length)
    .filter(overviewEvidenceVisible)
    .slice(0, 6);

  return `
    <section class="screen">
      <div class="screen-head">
        <div>
          <h1>数据概览</h1>
          <p>先补齐 Fact → Evidence → Chunk 的证据链，再用真实 RAGFlow 召回验证 Query。缺口数来自当前服务端状态。</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-outline" data-action="show-help" type="button">${icon('info')} 数据规则</button>
          <button class="btn btn-primary" data-action="navigate" data-screen="workbench" type="button">${icon('link')} 去审核证据</button>
        </div>
      </div>
      ${listSearchBox({
        id: 'overview-search',
        bind: 'overview-search',
        value: ui.overviewSearch,
        placeholder: '搜索待处理 Query、Fact 和 Evidence',
        clearAction: 'clear-overview-search',
      })}
      <div class="kpi-band">
        <div class="kpi">
          <div class="kpi-label">Query</div>
          <div class="kpi-value">${queries.length}<small>条</small></div>
          <div class="kpi-note">${approvedQueries} 条已确认</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Fact</div>
          <div class="kpi-value">${facts.length}<small>条</small></div>
          <div class="kpi-note">${factsWithEvidence} 条已有 Evidence</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Evidence</div>
          <div class="kpi-value">${evidences.length}<small>条</small></div>
          <div class="kpi-note">${evidenceWithChunks} 条已覆盖 Chunk</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Chunk</div>
          <div class="kpi-value">${chunks.length}<small>个</small></div>
          <div class="kpi-note">本地快照，可检索</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">确认率</div>
          <div class="kpi-value">${Math.round(ratioValue(approvedQueries, queries.length) * 100)}<small>%</small></div>
          <div class="kpi-note">${approvedQueries} / ${queries.length} Query</div>
        </div>
      </div>
      <div class="overview-grid">
        <div class="overview-stack">
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <h2>证据链完整度</h2>
                <small>按 Fact 与 Query 统计</small>
              </div>
            </div>
            <div class="funnel-list">
              ${renderFunnelRow({
                label: 'Fact 有 Evidence',
                note: '事实至少有可引用的证据',
                value: factsWithEvidence,
                total: facts.length,
                tone: ratioValue(factsWithEvidence, facts.length) >= 0.8 ? 'green' : 'amber',
              })}
              ${renderFunnelRow({
                label: 'Fact 覆盖 Chunk',
                note: '证据至少绑定一个可检索片段',
                value: factsWithChunks,
                total: facts.length,
                tone: ratioValue(factsWithChunks, facts.length) >= 0.8 ? 'green' : 'amber',
              })}
              ${renderFunnelRow({
                label: 'Query 有评分规则',
                note: '参与召回评分的 Query 基础',
                value: queriesWithRequired,
                total: queries.length,
                tone: ratioValue(queriesWithRequired, queries.length) >= 0.8 ? 'green' : 'amber',
              })}
              ${renderFunnelRow({
                label: 'Query 已确认',
                note: '完成审核可进入 Golden 集',
                value: approvedQueries,
                total: queries.length,
                tone: ratioValue(approvedQueries, queries.length) >= 0.8 ? 'green' : 'amber',
              })}
            </div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <h2>缺口清单</h2>
                <small>服务端 coverageGaps</small>
              </div>
            </div>
            <div class="gap-grid">
              ${renderGapCard({
                count: gaps.facts_without_evidence?.length || 0,
                label: 'Fact 没有 Evidence',
                target: 'facts',
              })}
              ${renderGapCard({
                count: gaps.facts_without_chunks?.length || 0,
                label: 'Fact 没有 Chunk',
                target: 'facts',
              })}
              ${renderGapCard({
                count: gaps.evidences_without_chunks?.length || 0,
                label: 'Evidence 没有 Chunk',
                target: 'workbench',
              })}
              ${renderGapCard({
                count: gaps.queries_without_required_facts?.length || 0,
                label: 'Query 没有评分规则',
                target: 'queries',
              })}
              ${renderGapCard({
                count: gaps.required_facts_without_chunks?.length || 0,
                label: '必需 Fact 未覆盖 Chunk',
                target: 'queries',
              })}
              ${renderGapCard({
                count: gaps.required_groups_without_chunks?.length || 0,
                label: '必需组有成员缺 Chunk',
                target: 'queries',
              })}
              ${renderGapCard({
                count: gaps.alternative_groups_without_chunks?.length || 0,
                label: '任选组全组无 Chunk',
                target: 'queries',
              })}
            </div>
            <div class="formula-note">
              召回口径：必需单项各计一项；必需组内每条各计一项且必须全部命中；每个任选组单独计一项，组内命中任一 Fact 即满足。Fact 内 OR 表示任一 Evidence 命中，AND 表示所有有 Chunk 的 Evidence 都命中。
            </div>
          </section>
        </div>
        <div class="overview-stack">
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <h2>待处理 Query</h2>
                <small>${attentionQueries.length} 条</small>
              </div>
            </div>
            ${attentionQueries.length ? `
              <div class="attention-list">
                ${attentionQueries.map((row) => {
                  const counts = queryFactRequirementCounts(queryFactLinks(row.query_id));
                  return renderAttentionRow({
                    title: `${row.query_id} · ${compactExcerpt(row.text, 46)}`,
                    copy: `${STATUS_LABELS[row.status] || row.status} · ${counts.requiredGroups} 个必需组 · ${counts.requiredSingles} 个必需单项 · ${counts.alternatives} 个任选组 · ${counts.conditions} 个评分条件`,
                    action: 'open-query',
                    id: row.query_id,
                    screen: 'queries',
                    tone: row.status === 'review' ? 'risk' : 'info',
                  });
                }).join('')}
              </div>` : overviewSearchActive
                ? emptyState({ title: '没有匹配的 Query', copy: '清空搜索词后再试。', compact: true })
                : emptyState({ title: '没有待处理 Query', copy: '所有 Query 都已确认且配置了评分规则。', compact: true })}
          </section>
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <h2>证据缺口</h2>
                <small>Fact 与 Evidence</small>
              </div>
            </div>
            ${attentionFacts.length || attentionEvidence.length ? `
              <div class="attention-list">
                ${attentionFacts.map((row) => {
                  const evCount = evidenceIdsOfFact(row.fact_id).length;
                  const chunkCount = chunkIdsOfFact(row.fact_id).length;
                  return renderAttentionRow({
                    title: `${row.fact_id} · ${compactExcerpt(row.statement, 44)}`,
                    copy: `${evCount} Evidence · ${chunkCount} Chunk`,
                    action: 'select-fact-draft',
                    id: row.fact_id,
                    screen: 'facts',
                    tone: chunkCount ? 'info' : 'risk',
                  });
                }).join('')}
                ${attentionEvidence.map((row) => renderAttentionRow({
                  title: `${row.evidence_id} · ${compactExcerpt(row.title, 44)}`,
                  copy: 'Evidence 尚未绑定 Chunk，召回时不会计分',
                  action: 'preview-evidence',
                  id: row.evidence_id,
                  screen: 'workbench',
                  tone: 'risk',
                })).join('')}
              </div>` : overviewSearchActive
                ? ''
                : emptyState({ title: '证据链没有明显缺口', copy: 'Fact 的 Evidence 和 Chunk 覆盖已齐全。', compact: true })}
              ${overviewSearchActive && !attentionFacts.length ? emptyState({ title: '没有匹配的 Fact', copy: '清空搜索词后再试。', compact: true }) : ''}
              ${overviewSearchActive && !attentionEvidence.length ? emptyState({ title: '没有匹配的 Evidence', copy: '清空搜索词后再试。', compact: true }) : ''}
          </section>
        </div>
      </div>
    </section>`;
}

function workspaceChunkRows() {
  const byId = new Map(ui.evidenceWorkspace.candidates.map((row) => [row.chunk_id, row]));
  for (const row of rows('chunks')) byId.set(row.chunk_id, row);
  return [...byId.values()];
}

function evidenceWorkspaceRows() {
  const workflow = ui.evidenceWorkspace.workflow;
  const term = normalizeText(workflow.search);
  const isEvidence = workflow.direction === 'evidence';
  return [...(isEvidence ? rows('evidences') : workspaceChunkRows())].filter((row) => {
    const count = isEvidence ? chunkIdsOfEvidence(row.evidence_id).length : evidenceReferencingChunk(row.chunk_id).length;
    if (workflow.filter === 'missing' && count) return false;
    if (workflow.filter === 'linked' && !count) return false;
    return !term || normalizeText(isEvidence
      ? `${row.evidence_id} ${row.title} ${row.excerpt} ${row.status} ${STATUS_LABELS[row.status] || ''}`
      : `${row.chunk_id} ${row.document_name} ${row.document_id} ${row.dataset_id} ${row.content}`).includes(term);
  }).sort((a, b) => {
    if (isEvidence) {
      const priority = Number(Boolean(chunkIdsOfEvidence(a.evidence_id).length)) - Number(Boolean(chunkIdsOfEvidence(b.evidence_id).length));
      if (priority) return priority;
    }
    return text(isEvidence ? a.evidence_id : a.chunk_id).localeCompare(text(isEvidence ? b.evidence_id : b.chunk_id), 'zh-CN', { numeric: true });
  });
}

function evidenceReferencingChunk(chunkId) {
  return [...(ui.index?.evidenceIdsByChunk.get(chunkId) || [])].map(evidence).filter(Boolean);
}

function resetWorkspaceSelection({ preserveSearch = false } = {}) {
  const workspace = ui.evidenceWorkspace;
  workspace.selectedChunkIds.clear();
  workspace.selectedChunks.clear();
  workspace.selectionOrder = [];
  if (!preserveSearch) {
    workspace.workflow.candidateSearch = '';
    workspace.workflow.evidenceTargetSearch = '';
  }
  workspace.workflow.targetEvidenceId = '';
  workspace.expandedChunkId = '';
}

function selectWorkspaceItem(id) {
  if (ui.busy) return;
  const workflow = ui.evidenceWorkspace.workflow;
  const key = workflow.direction === 'evidence' ? 'evidenceId' : 'chunkId';
  if (workflow[key] !== id) {
    resetWorkspaceSelection();
    workflow[key] = id;
  }
  render();
}

function workspaceCandidates() {
  const workspace = ui.evidenceWorkspace;
  const linked = new Set(chunkIdsOfEvidence(workspace.workflow.evidenceId));
  return workspaceChunkRows().filter((row) => !linked.has(row.chunk_id)).map(normalizeCandidate).filter(Boolean);
}

async function linkSelectedChunksToEvidence(evidenceId, candidates = selectedAutoMatchCandidates()) {
  if (ui.busy) return;
  if (!evidence(evidenceId)) return toast('目标 Evidence 不存在或已被删除', 'error');
  if (!candidates.length) return toast('请先选择至少一个来源 Chunk', 'info');
  const chunks = candidates.map((row) => normalizeChunkForSave(localChunk(row.chunk_id) || row)).filter((row) => row.chunk_id);
  const currentChunkIds = chunkIdsOfEvidence(evidenceId);
  const chunkIds = unique([...currentChunkIds, ...chunks.map((row) => row.chunk_id)]);
  if (chunkIds.length === currentChunkIds.length) return toast('所选 Chunk 已关联到这条 Evidence', 'info');
  const pending = runMutation(() => api.linkEvidenceChunks(evidenceId, chunkIds, chunks), {
    success: `已为 ${evidenceId} 绑定 ${chunkIds.length - currentChunkIds.length} 个 Chunk，可继续处理下一条`,
    after: () => resetWorkspaceSelection({ preserveSearch: true }),
  });
  render();
  return pending;
}

async function unlinkWorkspaceChunk(evidenceId, chunkId) {
  if (ui.busy || !evidence(evidenceId) || !chunkIdsOfEvidence(evidenceId).includes(chunkId)) return;
  const chunkIds = chunkIdsOfEvidence(evidenceId).filter((id) => id !== chunkId);
  const pending = runMutation(() => api.linkEvidenceChunks(evidenceId, chunkIds, []), {
    success: `已解除 ${evidenceId} 与 ${chunkId} 的关联，Chunk 及其他 Evidence 关系保留`,
  });
  render();
  return pending;
}

function renderWorkspaceChunk(chunk) {
  return `<div class="relationship-source-meta">
    <strong>${esc(chunk.document_name || chunk.document_id || '未命名文档')}</strong>
    <span class="mono">Chunk · ${esc(chunk.chunk_id)}</span>
    <span>${esc(pageLabel(chunk.page))} · ${esc(chunk.source || '来源未标注')}</span>
    ${chunk.document_id ? `<span>文档 ID · ${esc(chunk.document_id)}</span>` : ''}
    ${chunk.dataset_id ? `<span>数据集 · ${esc(chunk.dataset_id)}</span>` : ''}
  </div><pre class="relationship-content">${esc(chunk.content || '当前快照中没有原文。')}</pre>`;
}

function renderWorkspaceFacts(evidenceId) {
  const linkedFacts = rows('fact_evidence').filter((link) => (link.evidence_ids || []).includes(evidenceId));
  return `<div class="relationship-facts"><span class="field-label">关联 Fact · ${linkedFacts.length}</span>
    ${linkedFacts.length ? linkedFacts.map((link) => `<p><strong class="mono">${esc(link.fact_id)}</strong> ${esc(fact(link.fact_id)?.statement || 'Fact 不可用')}</p>`).join('') : '<p class="muted">尚未关联 Fact。可独立处理 Evidence 与 Chunk 的关系。</p>'}</div>`;
}

function renderEvidenceRetrieval() {
  const workspace = ui.evidenceWorkspace;
  const datasets = configuredDatasetOptions();
  const configured = Boolean(ui.data?.config?.ragflow?.configured);
  return `<section class="relationship-retrieval">
    <button class="btn btn-ghost" data-action="toggle-workspace-retrieval" type="button" aria-expanded="${workspace.retrievalOpen}" aria-controls="workspace-retrieval">${icon('search')} ${workspace.retrievalOpen ? '收起' : '展开'} RAGFlow 检索与 Query 匹配（可选）</button>
    <div id="workspace-retrieval" class="evidence-config-body" ${workspace.retrievalOpen ? '' : 'hidden'}>
      <p class="hint">本地 Chunk 可直接处理。需要更多原文时再检索，结果不会自动绑定。</p>
      <div class="evidence-mode-tabs" role="tablist" aria-label="Chunk 检索方式">
        ${[['keyword', '关键字检索'], ['query', 'Query 自动匹配']].map(([mode, label]) => `<button class="tab ${workspace.mode === mode ? 'active' : ''}" role="tab" aria-selected="${workspace.mode === mode}" data-action="set-evidence-mode" data-mode="${mode}" type="button" ${ui.busy ? 'disabled' : ''}>${label}</button>`).join('')}
      </div>
      <label class="field"><span class="field-label">RAGFlow 数据集</span>
        <select class="select" data-action="set-evidence-datasets" multiple size="3" aria-label="选择 RAGFlow 数据集" ${ui.busy || !datasets.length ? 'disabled' : ''}>
          ${datasets.map((item) => `<option value="${attr(item.id)}" ${workspace.datasetIds.includes(item.id) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
        </select><span class="hint">不选择时检索当前配置的全部数据集。</span>
      </label>
      ${workspace.mode === 'keyword' ? `<label class="field"><span class="field-label">检索关键字</span><input class="input" id="evidence-keyword" data-bind="evidence-keyword" value="${attr(workspace.keywordInput)}" placeholder="查找更多来源 Chunk" maxlength="300"></label>` : `
        <label class="field"><span class="field-label">Query（可选工具）</span><select class="select" data-action="select-evidence-query" aria-label="选择 Query"><option value="">选择 Query</option>${evidenceQueryOptions().map((item) => `<option value="${attr(item.id)}" ${item.id === workspace.queryId ? 'selected' : ''}>${esc(item.id)} · ${esc(compactExcerpt(item.text, 52))}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Query 文本</span><textarea class="textarea" id="evidence-query-text" data-bind="evidence-query-text" rows="3" maxlength="500">${esc(workspace.queryText)}</textarea></label>
        <label class="field"><span class="field-label">最低相似度</span><select class="select" data-action="set-evidence-min-similarity" aria-label="最低相似度">${[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((value) => `<option value="${value}" ${workspace.minSimilarity === value ? 'selected' : ''}>${value.toFixed(1)}</option>`).join('')}</select></label>`}
      <label class="field"><span class="field-label">Top K</span><select class="select" data-action="set-evidence-top-k" aria-label="Top K">${[6, 12, 24, 48].map((value) => `<option value="${value}" ${workspace.topK === value ? 'selected' : ''}>Top ${value}</option>`).join('')}</select></label>
      <button class="btn btn-primary" data-action="${workspace.mode === 'keyword' ? 'search-evidence-keywords' : 'run-evidence-auto-match'}" type="button" ${ui.busy || workspace.keywordLoading || workspace.loading || !configured ? 'disabled' : ''}>${icon('search')} ${workspace.keywordLoading || workspace.loading ? '正在检索…' : workspace.mode === 'keyword' ? '查找 Chunk' : '自动匹配 Chunk'}</button>
      ${configured ? '' : '<p class="hint">RAGFlow 未配置，仍可处理全部本地关系。</p>'}
      ${workspace.error ? `<p class="error-text" role="alert">${esc(workspace.error)}</p>` : ''}
    </div>
  </section>`;
}

function renderEvidenceRelationships(row) {
  const workspace = ui.evidenceWorkspace;
  const chunkIds = chunkIdsOfEvidence(row.evidence_id);
  const selected = selectedAutoMatchCandidates();
  return `<div class="relationship-current" data-workspace-evidence="${attr(row.evidence_id)}">
    <div class="relationship-title"><h2>${esc(row.title || '未命名 Evidence')}</h2>${statusChip(row.status)}<span class="mono">${esc(row.evidence_id)}</span>
      <button class="btn btn-sm btn-ghost link-danger" data-action="delete-evidence" data-id="${attr(row.evidence_id)}" type="button" aria-label="删除 Evidence ${attr(row.evidence_id)}" ${ui.busy ? 'disabled' : ''}>${icon('trash')} 删除 Evidence</button>
    </div>
    <pre class="relationship-content">${esc(row.excerpt || '尚未填写摘录')}</pre>
    ${renderWorkspaceFacts(row.evidence_id)}
    <section class="relationship-section"><h3>已关联 Chunk · ${chunkIds.length}</h3><p class="hint">解除只移除当前 Evidence 的这一条关系，保留 Chunk 和其他 Evidence 的引用。</p>
      ${chunkIds.length ? chunkIds.map((id) => {
        const chunk = localChunk(id) || findEvidenceCandidate(id);
        return `<article class="relationship-card" data-linked-chunk="${attr(id)}">
          ${chunk ? renderWorkspaceChunk(chunk) : `<p class="mono">${esc(id)}</p><p class="error-text">本地快照缺少此 Chunk 原文。</p>`}
          <button class="btn btn-sm btn-outline" data-action="unlink-workspace-chunk" data-evidence="${attr(row.evidence_id)}" data-chunk="${attr(id)}" type="button" aria-label="从 ${attr(row.evidence_id)} 解除 Chunk ${attr(id)}" ${ui.busy ? 'disabled' : ''}>${icon('x')} 解除此关联</button>
        </article>`;
      }).join('') : '<p class="relationship-empty">还没有来源 Chunk。在下方选择本地 Chunk，或展开 RAGFlow 检索。</p>'}
    </section>
    <section class="relationship-section"><h3>为当前 Evidence 添加 Chunk</h3>
      ${renderEvidenceRetrieval()}
      ${renderEvidenceCandidatesPanel()}
      <div class="relationship-save-bar"><strong>待添加 ${selected.length} 个 Chunk</strong><span class="mono">${esc(row.evidence_id)}</span>
        <button class="btn btn-ghost" data-action="clear-evidence-auto-selection" type="button" ${ui.busy || !selected.length ? 'disabled' : ''}>清空选择</button>
        <button class="btn btn-success" data-action="link-selected-evidence-chunks" type="button" ${ui.busy || !selected.length ? 'disabled' : ''}>${icon('link')} 保存新增关联</button>
      </div>
    </section>
  </div>`;
}

function renderChunkRelationships(chunk) {
  const workflow = ui.evidenceWorkspace.workflow;
  const linked = evidenceReferencingChunk(chunk.chunk_id);
  const term = normalizeText(workflow.evidenceTargetSearch);
  const targets = rows('evidences').filter((row) => !chunkIdsOfEvidence(row.evidence_id).includes(chunk.chunk_id)
    && (!term || normalizeText(`${row.evidence_id} ${row.title} ${row.excerpt}`).includes(term)));
  return `<div class="relationship-current" data-workspace-chunk="${attr(chunk.chunk_id)}">
    <h2>当前 Chunk 原文</h2>${renderWorkspaceChunk(chunk)}
    <section class="relationship-section"><h3>从此 Chunk 创建 Evidence</h3><p class="hint">创建独立 Evidence 并关联当前 Chunk。Fact 可在草稿中自愿选择。</p>
      <button class="btn btn-primary" data-action="create-evidence-from-workspace-chunk" type="button" ${ui.busy ? 'disabled' : ''}>${icon('plus')} 创建 Evidence 草稿</button>
    </section>
    <section class="relationship-section"><h3>引用此 Chunk 的 Evidence · ${linked.length}</h3>
      ${linked.length ? linked.map((row) => `<article class="relationship-card"><div class="relationship-title"><strong>${esc(row.title || '未命名 Evidence')}</strong>${statusChip(row.status)}<span class="mono">${esc(row.evidence_id)}</span></div><pre class="relationship-content">${esc(row.excerpt)}</pre>${renderWorkspaceFacts(row.evidence_id)}
        <button class="btn btn-sm btn-outline" data-action="unlink-workspace-chunk" data-evidence="${attr(row.evidence_id)}" data-chunk="${attr(chunk.chunk_id)}" type="button" aria-label="从 ${attr(row.evidence_id)} 解除 Chunk ${attr(chunk.chunk_id)}" ${ui.busy ? 'disabled' : ''}>${icon('x')} 解除此关联</button></article>`).join('') : '<p class="relationship-empty">尚无 Evidence 引用此 Chunk。可绑定已有 Evidence，或创建独立 Evidence。</p>'}
    </section>
    <section class="relationship-section"><h3>将此 Chunk 绑定到已有 Evidence</h3>
      ${listSearchBox({ id: 'workspace-evidence-target-search', bind: 'workspace-evidence-target-search', value: workflow.evidenceTargetSearch, placeholder: '搜索 Evidence 标题、摘录或 ID', clearAction: 'clear-workspace-evidence-target-search' })}
      <div class="relationship-target-list" role="radiogroup" aria-label="选择绑定目标 Evidence" data-scroll-key="workspace-evidence-targets">
        ${targets.length ? targets.map((row) => `<label class="relationship-target"><input type="radio" name="workspace-evidence-target" id="workspace-target-${attr(row.evidence_id)}" data-bind="workspace-target-evidence" value="${attr(row.evidence_id)}" ${workflow.targetEvidenceId === row.evidence_id ? 'checked' : ''} ${ui.busy ? 'disabled' : ''}><span><strong>${esc(row.title || '未命名 Evidence')}</strong><span class="mono">${esc(row.evidence_id)} · ${esc(STATUS_LABELS[row.status] || row.status)}</span><span>${esc(compactExcerpt(row.excerpt, 140))}</span></span></label>`).join('') : '<p class="relationship-empty">没有可绑定的 Evidence。可清空搜索或创建新 Evidence。</p>'}
      </div>
      <div class="relationship-save-bar"><span>绑定目标 · <strong>${esc(workflow.targetEvidenceId || '尚未选择')}</strong></span>
        <button class="btn btn-success" data-action="bind-workspace-chunk" type="button" ${ui.busy || !evidence(workflow.targetEvidenceId) ? 'disabled' : ''}>${icon('link')} 保存此 Chunk 关联</button>
      </div>
    </section>
  </div>`;
}

function renderEvidenceLibrary() {
  const workspace = ui.evidenceWorkspace;
  const workflow = workspace.workflow;
  const items = evidenceWorkspaceRows();
  const isEvidence = workflow.direction === 'evidence';
  const key = isEvidence ? 'evidenceId' : 'chunkId';
  const collection = isEvidence ? rows('evidences') : workspaceChunkRows();
  if (!collection.some((row) => (isEvidence ? row.evidence_id : row.chunk_id) === workflow[key])) {
    resetWorkspaceSelection();
    workflow[key] = items[0]?.[isEvidence ? 'evidence_id' : 'chunk_id'] || '';
  }
  const current = isEvidence ? evidence(workflow.evidenceId) : localChunk(workflow.chunkId) || findEvidenceCandidate(workflow.chunkId);
  const index = items.findIndex((row) => (isEvidence ? row.evidence_id : row.chunk_id) === workflow[key]);
  const missingCount = rows('evidences').filter((row) => !chunkIdsOfEvidence(row.evidence_id).length).length;
  const linkedChunkCount = rows('chunks').filter((row) => evidenceReferencingChunk(row.chunk_id).length).length;
  const kind = isEvidence ? 'Evidence' : 'Chunk';
  return `<section class="screen evidence-screen">
    <div class="screen-head"><div><h1>Evidence ↔ Chunk 关系工作台</h1><p>选择处理方向，逐条核对原文并编辑多对多关系。保存后停留当前项，可明确选择下一条。</p></div>
      <div class="head-actions"><button class="btn btn-primary" data-action="return-from-evidence" type="button" ${ui.busy ? 'disabled' : ''}>${icon('left')} 返回</button></div>
    </div>
    <div class="kpi-band evidence-kpi-band">
      ${renderEvidenceKpi('Evidence', rows('evidences').length, '条', `缺少 Chunk · ${missingCount}`)}
      ${renderEvidenceKpi('Chunk 本地快照', rows('chunks').length, '个', `未关联 · ${rows('chunks').length - linkedChunkCount}`)}
      ${renderEvidenceKpi('已关联 Chunk', linkedChunkCount, '个', '支持多个 Evidence 共同引用')}
    </div>
    <div class="relationship-directions" role="tablist" aria-label="关系处理方向">
      ${[['evidence', '从 Evidence 处理'], ['chunk', '从 Chunk 处理']].map(([direction, label]) => `<button class="tab ${workflow.direction === direction ? 'active' : ''}" role="tab" aria-selected="${workflow.direction === direction}" aria-controls="relationship-workspace" id="direction-${direction}" data-action="set-workspace-direction" data-direction="${direction}" type="button" ${ui.busy ? 'disabled' : ''}>${label}</button>`).join('')}
    </div>
    <div class="relationship-workspace" id="relationship-workspace" role="tabpanel" aria-labelledby="direction-${workflow.direction}">
      <aside class="panel relationship-queue-panel" aria-label="${kind} 队列">
        <div class="panel-head"><h2>${kind} 队列 · ${items.length}</h2></div>
        <div class="relationship-queue-tools">
          ${!isEvidence ? '<p class="hint">本地快照与检索结果 · 按 Chunk ID 去重，本地原文优先。</p>' : ''}
          ${listSearchBox({ id: 'workspace-search', bind: 'workspace-search', value: workflow.search, placeholder: isEvidence ? '搜索 Evidence 标题、摘录或 ID' : '搜索 Chunk 文档、ID 或原文', clearAction: 'clear-workspace-search' })}
          <label class="field"><span class="field-label">关系筛选</span><select class="select" data-action="set-workspace-filter" aria-label="关系筛选" ${ui.busy ? 'disabled' : ''}>${[['all', '全部'], ['missing', isEvidence ? '缺少 Chunk' : '未关联 Evidence'], ['linked', isEvidence ? '已关联 Chunk' : '已关联 Evidence']].map(([value, label]) => `<option value="${value}" ${workflow.filter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        </div>
        <div class="relationship-queue" data-scroll-key="relationship-queue-${workflow.direction}">
          ${items.length ? items.map((row) => {
            const id = isEvidence ? row.evidence_id : row.chunk_id;
            const count = isEvidence ? chunkIdsOfEvidence(id).length : evidenceReferencingChunk(id).length;
            const item = `<button class="relationship-queue-item ${workflow[key] === id ? 'active' : ''}" data-action="select-workspace-item" data-id="${attr(id)}" aria-current="${workflow[key] === id}" type="button" ${ui.busy ? 'disabled' : ''}><strong>${esc(isEvidence ? row.title || '未命名 Evidence' : row.document_name || row.document_id || '未命名文档')}</strong><span>${esc(compactExcerpt(isEvidence ? row.excerpt : row.content, 120))}</span><span class="relationship-queue-meta"><span class="mono">${esc(id)}</span>${isEvidence ? statusChip(row.status) : ''}<span class="chip ${count ? 'good' : 'warn'}">${count} ${isEvidence ? 'Chunk' : 'Evidence'}</span></span></button>`;
            return isEvidence ? item : `<div class="relationship-queue-entry">${item}${availabilityButton(row, 'relationship-queue-availability')}</div>`;
          }).join('') : emptyState({ title: collection.length ? '没有符合筛选的条目' : `${kind} 库为空`, copy: collection.length ? '清空搜索或切换“全部”继续处理。' : isEvidence ? '可切换“从 Chunk 处理”创建 Evidence。' : '展开右侧 RAGFlow 检索，查找原始 Chunk 后逐条处理。', compact: true })}
        </div>
      </aside>
      <section class="panel relationship-detail-panel" aria-label="当前 ${kind} 关系编辑">
        <div class="relationship-item-nav"><span>${index >= 0 ? `队列第 ${index + 1} / ${items.length} 项` : current ? '当前项已不在筛选结果中，仍可继续编辑' : '选择一项开始处理'}</span><div>
          <button class="btn btn-sm btn-outline" data-action="prev-workspace-item" type="button" ${ui.busy || index <= 0 ? 'disabled' : ''}>${icon('left')} 上一条</button>
          <button class="btn btn-sm btn-outline" data-action="next-workspace-item" type="button" ${ui.busy || !items.length || index >= items.length - 1 ? 'disabled' : ''}>下一条 ${icon('right')}</button>
        </div></div>
        <div class="relationship-detail" data-scroll-key="relationship-detail-${workflow.direction}-${attr(workflow[key])}">
          ${!isEvidence ? renderEvidenceRetrieval() : ''}
          ${current ? isEvidence ? renderEvidenceRelationships(current) : renderChunkRelationships(current) : emptyState({ title: `暂无当前 ${kind}`, copy: isEvidence ? '从左侧队列选择条目，或切换“从 Chunk 处理”创建 Evidence。' : '可展开上方 RAGFlow 检索，从原始 Chunk 创建 Evidence。', compact: true })}
        </div>
      </section>
    </div>
  </section>`;
}

function renderEvidenceKpi(label, value, unit, note) {
  return `
    <div class="kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${value}<small>${esc(unit)}</small></div>
      <div class="kpi-note">${esc(note)}</div>
    </div>`;
}

function renderEvidenceCandidatesPanel() {
  const workspace = ui.evidenceWorkspace;
  const candidates = workspaceCandidates();
  const visible = candidates.filter(evidenceCandidateVisible);
  const selected = selectedAutoMatchCandidates();
  return `<div class="result-summary"><span>${visible.length} 个可添加 Chunk · 已选 ${selected.length} 个</span><span>本地快照与检索结果，已排除当前关联</span></div>
    ${listSearchBox({ id: 'evidence-candidate-search', bind: 'evidence-candidate-search', value: workspace.workflow.candidateSearch, placeholder: '搜索候选 Chunk ID、文档或原文', clearAction: 'clear-evidence-candidate-search' })}
    ${selected.length ? `<div class="evidence-selected-list">${selected.map((row) => `<span class="evidence-selected-chip"><span>${esc(compactExcerpt(row.document_name || row.content || row.chunk_id, 40))}</span><small>${esc(row.chunk_id)}</small><button class="icon-btn" data-action="toggle-evidence-candidate" data-id="${attr(row.chunk_id)}" type="button" aria-label="取消选择 ${attr(row.chunk_id)}" ${ui.busy ? 'disabled' : ''}>${icon('x')}</button></span>`).join('')}</div>` : ''}
    <div class="relationship-candidates" data-scroll-key="workspace-chunk-candidates">${visible.length ? visible.map(renderEvidenceAutoCandidate).join('') : emptyState({ title: candidates.length ? '没有匹配的候选 Chunk' : '没有可添加的 Chunk', copy: candidates.length ? '清空候选搜索后再试。' : '全部本地 Chunk 已关联，或当前快照为空。可展开 RAGFlow 查找更多来源。', compact: true })}</div>`;
}

function renderEvidenceAutoCandidate(candidate) {
  const selected = ui.evidenceWorkspace.selectedChunkIds.has(candidate.chunk_id);
  const referenceCount = evidenceReferencingChunk(candidate.chunk_id).length;
  return `
    <article class="candidate-card ${selected ? 'selected' : ''}">
      <button class="check ${selected ? 'checked' : ''}" data-action="toggle-evidence-candidate" data-id="${attr(candidate.chunk_id)}" type="button" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'} ${attr(candidate.chunk_id)}" ${ui.busy ? 'disabled' : ''}>${selected ? icon('check') : ''}</button>
      <div class="candidate-main">
        <div class="candidate-top">
          <span class="candidate-title">${esc(candidate.document_name || candidate.document_id || '未命名文档')}</span>
          ${referenceCount ? `<span class="chip good">${referenceCount} 条 Evidence 引用</span>` : ''}
          ${candidate.source ? `<span class="chip plain">${esc(candidate.source)}</span>` : ''}
          <span class="candidate-score">相似度 ${esc(similarityText(candidate.similarity))}</span>
        </div>
        <div class="candidate-body">${esc(compactExcerpt(candidate.content, 220))}</div>
        <div class="candidate-foot evidence-candidate-foot">
          <button class="chunk-ref" data-action="preview-evidence-candidate" data-id="${attr(candidate.chunk_id)}" type="button" title="展开完整原文">${esc(candidate.chunk_id)}</button>
          <span>${icon('doc')} ${esc(pageLabel(candidate.page))}</span>
          ${candidate.dataset_id ? `<span class="mono">${esc(candidate.dataset_id)}</span>` : ''}
          ${candidate.matched_fact_ids.length ? `<span>命中 Fact：${candidate.matched_fact_ids.map((id) => esc(id)).join('、')}</span>` : '<span class="faint">未标注命中 Fact</span>'}
          ${candidate.matched_evidence_ids.length ? `<span>命中 Evidence：${candidate.matched_evidence_ids.map((id) => esc(id)).join('、')}</span>` : '<span class="faint">未命中已有 Evidence</span>'}
        </div>
        ${ui.evidenceWorkspace.expandedChunkId === candidate.chunk_id ? `<pre class="evidence-excerpt">${esc(candidate.content)}</pre>` : ''}
      </div>
    </article>`;
}

function modalShell({ title, subtitle = '', body, footer = '', wide = false }) {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${attr(title)}">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
          </div>
          <button class="icon-btn modal-close" data-action="close-modal" type="button" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </section>
    </div>`;
}

function renderQueryFactsPanel(review) {
  const factLinks = review.factLinks;
  const selected = new Map(factLinks.map((link) => [link.fact_id, link]));
  const factFilter = review.factFilter;
  const factFilterText = review.factFilterText;
  const factAssignmentOptions = assignmentOptions(factLinks);
  const factStatuses = review.factStatuses;
  return `<section class="panel center-panel query-facts-panel">
    <div class="panel-head"><div class="panel-title"><h2>搜索与选择 Facts</h2><small>为 ${esc(review.queryId)} 设置评分规则</small></div></div>
    <div class="panel-body" data-scroll-key="query-facts-panel">
      <p class="hint">勾选标准答案，点击 Fact ID 查看证据链。必需组每条都要命中；每个任选组命中任一条即可。全局审核状态的修改会影响其他引用此 Fact 的 Query。</p>
      ${rows('facts').length ? `
      <div class="query-facts-summary" data-query-facts-summary>${esc(queryFactCountSummary(factLinks))}</div>
      <div class="query-facts-filters">
        <button class="tab ${factFilter === 'all' ? 'active' : ''}" data-action="filter-query-facts" data-filter="all" type="button" aria-pressed="${factFilter === 'all'}">
          ${icon('fact')} 全部 <span class="tab-count" data-query-facts-total-count>${rows('facts').length}</span>
        </button>
        <button class="tab ${factFilter === 'selected' ? 'active' : ''}" data-action="filter-query-facts" data-filter="selected" type="button" aria-pressed="${factFilter === 'selected'}">
          ${icon('check')} 已勾选 <span class="tab-count" data-query-facts-selected-count>${factLinks.length}</span>
        </button>
        ${listSearchBox({
          id: 'query-facts-search',
          bind: 'query-facts-search',
          value: factFilterText,
          placeholder: '搜索 Fact ID、陈述、主题、状态或重要性',
          clearAction: 'clear-query-facts-search',
        })}
      </div>
      <div class="fact-select-list">
        ${rows('facts').map((row) => {
          const link = selected.get(row.fact_id);
          const requirement = link?.requirement;
          const visible = factOptionVisible(row, link, review);
          return `
            <div class="fact-option ${requirement ? 'selected' : ''}" data-fact-option="${attr(row.fact_id)}" ${visible ? '' : 'hidden'}>
              <button class="check ${requirement ? 'checked' : ''}" id="query-fact-toggle-${attr(row.fact_id)}" data-action="toggle-query-fact" data-id="${attr(row.fact_id)}" type="button" aria-label="${requirement ? '移除' : '添加'} ${attr(row.fact_id)}">${requirement ? icon('check') : ''}</button>
              <div class="fact-option-main">
                <div class="fact-option-head">
                  <button class="btn-link" data-action="preview-query-fact" data-id="${attr(row.fact_id)}" type="button" aria-label="查看 ${attr(row.fact_id)} 的证据链">${idChip(row.fact_id)}</button>
                  ${statusChip(factStatuses[row.fact_id] || row.status)}
                  <span class="chip">${esc(row.importance || 'P1')}</span>
                </div>
                <div class="fact-option-statement">${esc(row.statement)}</div>
                <div class="fact-option-foot">
                  <span class="tiny muted">${esc(row.topic || '未分类')}</span>
                  <span class="spacer"></span>
                  <div class="fact-option-controls">
                    <label class="fact-option-control">计分方式与分组
                      ${assignmentSelect(link || { requirement: 'required', group_id: '' }, factLinks, 'set-query-fact-assignment', row.fact_id, !link, factAssignmentOptions)}
                    </label>
                    <label class="fact-option-control">全局审核状态
                      <select class="select" id="query-fact-status-${attr(row.fact_id)}" data-action="set-query-fact-status" data-id="${attr(row.fact_id)}" aria-label="${attr(row.fact_id)} 的审核状态">
                        ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${(factStatuses[row.fact_id] || row.status) === value ? 'selected' : ''}>${label}</option>`).join('')}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>`;
        }).join('')}
        <div class="query-facts-empty" data-query-facts-empty ${rows('facts').some((row) => factOptionVisible(row, selected.get(row.fact_id), review)) ? 'hidden' : ''}>
          ${emptyState({
            title: factFilterText ? '没有匹配的 Fact' : factFilter === 'selected' ? '还没有勾选 Fact' : 'Fact 库为空',
            copy: factFilterText ? '清空搜索词后再试。' : factFilter === 'selected' ? '切回“全部”勾选需要的 Fact，再回来编辑计分方式和状态。' : '先手工录入至少一条事实，再关联到 Query。',
          })}
        </div>
      </div>` : emptyState({
      title: 'Fact 库为空',
      copy: '先手工录入至少一条事实，再关联到 Query。',
      actions: `<button class="btn btn-primary" data-action="navigate" data-screen="facts" type="button">${icon('fact')} 去录入 Fact</button>`,
    })}
    </div>
  </section>`;
}

function renderQueryEditModal(modalState) {
  const draft = modalState.draft;
  return modalShell({
    title: `编辑 ${draft.query_id}`,
    subtitle: draft.parent_query_id ? `本变体归属 ${draft.parent_query_id}` : '主问变更不会自动改写同组变体，请分别复核。',
    body: `
      <div class="builder-form">
        <label class="field">
          <span class="field-label">Query 文本 <span class="req">*</span></span>
          <textarea class="textarea query-textarea" id="query-edit-text" data-bind="query-edit-text" maxlength="500">${esc(draft.text)}</textarea>
        </label>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">期望行为</span>
            <select class="select" id="query-edit-behavior" data-bind="query-edit-behavior">
              ${Object.entries(BEHAVIOR_LABELS).map(([value, label]) => `<option value="${value}" ${draft.expected_behavior === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">审核状态</span>
            <select class="select" id="query-edit-status" data-bind="query-edit-status">
              ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${draft.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field-label">审核备注</span>
          <textarea class="textarea" id="query-edit-notes" data-bind="query-edit-notes" placeholder="记录口径、风险或待确认事项" maxlength="1000">${esc(draft.notes)}</textarea>
        </label>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-action="close-modal" type="button">取消</button>
      <button class="btn btn-primary" data-action="save-query-edit" type="button">${icon('check')} 保存 Query</button>`,
  });
}

function renderDeleteModal(modalState) {
  return modalShell({
    title: '确认删除',
    subtitle: '删除不可撤销，关联关系会由服务端同步清理。',
    body: `
      <div class="readiness-box blocked">
        <div class="readiness-title">${icon('alert')} 即将删除 ${esc(modalState.label)}</div>
        <p class="hint">${esc(modalState.description || '请确认这条记录不再需要。')}</p>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-action="close-modal" type="button">取消</button>
      <button class="btn btn-danger" data-action="confirm-delete" type="button">${icon('trash')} 确认删除</button>`,
  });
}

function recallTone(value) {
  if (value === null || value === undefined) return '';
  if (value >= 0.8) return 'good';
  if (value >= 0.5) return 'warn';
  return 'bad';
}

function renderRecallFactSelector(facts, selectedFactId) {
  return `<div class="recall-fact-selector" role="group" aria-label="选择要比较的 Fact">
    ${facts.map((fact) => `
      <button class="recall-fact-tab ${fact.fact_id === selectedFactId ? 'active' : ''}" data-action="select-recall-fact" data-id="${attr(fact.fact_id)}" type="button" aria-pressed="${fact.fact_id === selectedFactId}">
        <span class="mono">${esc(fact.fact_id)}</span>
        <span>${esc(compactExcerpt(fact.statement, 52))}</span>
        <span class="recall-fact-tab-outcome ${!fact.scorable ? 'unscorable' : fact.hit ? 'hit' : 'miss'}">${!fact.scorable ? '无 Chunk' : fact.hit ? '命中' : '未命中'}</span>
      </button>`).join('')}
  </div>`;
}

function renderRecallComparison(selectedFact, chunks) {
  const evidenceRows = selectedFact.evidence || [];
  const hitChunkIds = new Set(unique(selectedFact.matched_chunk_ids || []));
  return `<div class="recall-compare">
    <section class="recall-compare-pane">
      <div class="recall-compare-head">
        <div>
          <strong>预期证据</strong>
          <span>${esc(selectedFact.fact_id)} · ${esc(selectedFact.statement)}</span>
        </div>
        <span class="tiny muted">Evidence ${evidenceRows.length} 条</span>
      </div>
      ${evidenceRows.length ? evidenceRows.map((item) => {
        const chunkIds = unique(item.chunk_ids || []);
        const evidenceRow = evidence(item.evidence_id);
        return `<article class="recall-compare-card">
          <div class="recall-compare-card-head">
            <strong>${esc(evidenceRow?.title || item.title || item.evidence_id || '未命名 Evidence')}</strong>
            ${item.evidence_id ? `<span class="mono">${esc(item.evidence_id)}</span>` : ''}
          </div>
          ${(evidenceRow?.excerpt || item.excerpt) ? `<p class="recall-evidence-excerpt">${esc(evidenceRow?.excerpt || item.excerpt)}</p>` : ''}
          <div class="recall-gold-chunks">
            ${chunkIds.length ? chunkIds.map((chunkId) => {
              const chunk = localChunk(chunkId);
              return `<div class="recall-gold-chunk">
                <div class="recall-compare-card-head">
                  <strong>${esc(chunk?.document_name || chunk?.document_id || 'Gold Chunk')}</strong>
                  <span class="mono">${esc(chunkId)}</span>
                </div>
                ${chunk ? `<pre class="recall-chunk-text">${esc(chunk.content || '该快照没有原文内容。')}</pre>` : '<div class="recall-empty">无本地快照</div>'}
              </div>`;
            }).join('') : '<div class="recall-empty">这条 Evidence 没有关联 Chunk。</div>'}
          </div>
        </article>`;
      }).join('') : '<div class="recall-empty">这条 Fact 没有关联 Evidence。</div>'}
    </section>
    <section class="recall-compare-pane">
      <div class="recall-compare-head">
        <div>
          <strong>实际召回</strong>
          <span>RAGFlow 本轮 Top-K 结果</span>
        </div>
        <span class="tiny muted">Top ${esc(chunks.length)}</span>
      </div>
      ${chunks.length ? chunks.map((chunk) => {
        const chunkId = text(chunk.chunk_id);
        return `<article class="recall-compare-card ${hitChunkIds.has(chunkId) ? 'matched' : ''}">
          <div class="recall-compare-card-head">
            <strong>${esc(chunk.document_name || chunk.document_id || '未命名文档')}</strong>
            <span class="mono">${esc(chunkId)}</span>
          </div>
          <div class="recall-result-meta">
            <span>相似度 ${esc(similarityText(chunk.similarity))}</span>
            ${hitChunkIds.has(chunkId) ? '<span class="recall-hit-badge">matched · 当前 Fact</span>' : ''}
          </div>
          <pre class="recall-chunk-text">${esc(chunk.content || 'RAGFlow 没有返回原文内容。')}</pre>
        </article>`;
      }).join('') : '<div class="recall-empty">RAGFlow 没有返回 Chunk。</div>'}
    </section>
  </div>`;
}

function renderRecallModal(modalState) {
  const title = `召回试跑 · ${modalState.queryId}`;
  if (modalState.loading) {
    return modalShell({
      title,
      subtitle: '正在使用当前 Query 调 RAGFlow 检索，并与已人工关联的 Evidence/Chunk 对照。',
      body: `<div class="generation-state"><span class="spinner"></span><span>等待 RAGFlow 返回 Top-K…</span></div>`,
      footer: `<button class="btn btn-ghost" data-action="close-modal" type="button">关闭</button>`,
      wide: true,
    });
  }
  if (modalState.error) {
    return modalShell({
      title,
      subtitle: '本次试跑没有生成报告。',
      body: `<div class="readiness-box blocked"><div class="readiness-title">${icon('alert')} ${esc(modalState.error)}</div><p class="hint">检查 RAGFlow 配置后可重试。</p></div>`,
      footer: `
        <button class="btn btn-ghost" data-action="close-modal" type="button">关闭</button>
        <button class="btn btn-primary" data-action="run-recall" data-id="${attr(modalState.queryId)}" type="button">${icon('refresh')} 重试</button>`,
      wide: true,
    });
  }

  const report = modalState.report;
  const retrieval = modalState.retrieval;
  const groups = Array.isArray(report.groups) ? report.groups : [];
  const facts = Array.isArray(report.facts) ? report.facts : [];
  const selectedFact = facts.find((fact) => fact.fact_id === modalState.selectedFactId) || facts[0] || null;
  const chunks = Array.isArray(retrieval?.chunks) ? retrieval.chunks.slice(0, report.top_k) : [];
  return modalShell({
    title,
    subtitle: `Top ${report.top_k} · ${retrieval?.latency_ms || report.latency_ms || '—'} ms · Query 文本直接送给 RAGFlow`,
    body: `
      <div class="recall-hero">
        <div class="recall-number ${recallTone(report.recall)}">${percentText(report.recall)}</div>
        <div class="recall-copy">
          <strong>${report.scorable_total ? `${report.hit_total} / ${report.scorable_total} 个可评分条件命中` : '没有可评分的必需条件'}</strong>
          <span>必需组 ${report.required_group_count || 0} 组 · 必需单项 ${report.required_single_count || 0} 项 · 任选组 ${report.alternative_group_count || 0} 组 · 共 ${report.required_total} 个评分条件 · 不可评分 ${report.required_total - report.scorable_total} 项</span>
        </div>
      </div>
      ${groups.length ? `<div class="recall-groups">
        ${groups.map((group) => {
          const isRequiredAll = group.requirement === 'required';
          const label = isRequiredAll ? `必需组 ${group.group_id}` : `任选组 ${group.group_id}`;
          const semantics = isRequiredAll
            ? `组内 ${group.fact_ids.length} 条各计 1 项，所有成员都要命中。`
            : `组内 ${group.fact_ids.length} 选 1，命中任一 Fact 即满足 1 项。`;
          const progress = isRequiredAll
            ? `${group.complete ? '本次组内全部命中' : group.scorable_total < group.condition_total ? '本次有成员无 Chunk' : '本次未全部命中'}；${group.hit_total} / ${group.scorable_total} 个可评分条件命中，${group.fact_ids.length - group.scorable_fact_ids.length} 个成员无 Chunk。`
            : `${group.hit_total ? '本次已满足' : group.scorable_total ? '本次未命中' : '本组没有可评分成员'}；${group.scorable_fact_ids.length} / ${group.fact_ids.length} 条成员 Fact 可评分。`;
          return `<div class="recall-group-note ${isRequiredAll ? 'required-group' : 'alternative-group'}"><strong>${esc(label)}</strong><span>${esc(semantics)} ${group.fact_ids.map(esc).join('、')}。${esc(progress)}</span></div>`;
        }).join('')}
      </div>` : ''}
      ${facts.length ? `${renderRecallFactSelector(facts, selectedFact.fact_id)}${renderRecallComparison(selectedFact, chunks)}` : '<div class="recall-empty">这条 Query 没有必需 Fact 或任选组，因此 Recall 为 null。</div>'}`,
    footer: `
      <button class="btn btn-ghost" data-action="close-modal" type="button">关闭</button>
      <button class="btn btn-primary" data-action="run-recall" data-id="${attr(modalState.queryId)}" type="button">${icon('refresh')} 再跑一次</button>`,
    wide: true,
  });
}

function renderEvidenceCreateModal(modalState) {
  if (modalState.stage === 'confirm-discard') {
    return modalShell({
      title: '放弃 Evidence 草稿？',
      subtitle: '草稿尚未写入数据集。放弃后可以从候选 Chunk 重新开始。',
      body: `<div class="readiness-box blocked"><div class="readiness-title">${icon('alert')} 未保存的标题和摘录会丢失</div><p class="hint">已选来源 Chunk 会保留在候选列表中。</p></div>`,
      footer: `
        <button class="btn btn-ghost" data-action="continue-evidence-draft" type="button">继续编辑</button>
        <button class="btn btn-danger" data-action="discard-evidence-draft" type="button">放弃草稿</button>`,
    });
  }

  const draft = modalState.draft;
  const targetFact = fact(draft.fact_id);
  const chunks = Array.isArray(draft.chunks) ? draft.chunks : [];
  const saving = ui.busy;
  const polishing = Boolean(modalState.polishing);
  return modalShell({
    title: '创建 Evidence 草稿',
    subtitle: `${targetFact ? `为 ${draft.fact_id} 添加证据` : '创建独立 Evidence，Fact 关联可选'}。所选 ${chunks.length} 个 Chunk 是这条 Evidence 的来源。`,
    body: `
      <div class="readiness-box blocked evidence-draft-error" data-evidence-save-error ${modalState.error ? '' : 'hidden'}><div class="readiness-title">${icon('alert')} 保存失败</div><p class="hint">${esc(modalState.error)}</p></div>
      <div class="evidence-draft-fact">
        ${modalState.origin === 'workspace' ? `<label class="field"><span class="field-label">关联 Fact（可选）</span><select class="select" id="evidence-draft-fact" data-bind="evidence-draft-fact" aria-label="关联 Fact（可选）" ${saving || polishing ? 'disabled' : ''}><option value="">不关联 Fact，创建独立 Evidence</option>${evidenceFactOptions().map((item) => `<option value="${attr(item.id)}" ${item.id === draft.fact_id ? 'selected' : ''}>${esc(item.text)}</option>`).join('')}</select></label>` : `<span class="eyebrow">目标 Fact</span><strong>${esc(targetFact?.fact_id || draft.fact_id)}</strong>`}
        <p data-evidence-fact-summary>${esc(targetFact?.statement || '不关联 Fact，仅创建 Evidence 与 Chunk 的关系。')}</p>
      </div>
      <div class="evidence-draft-grid">
        <div class="evidence-draft-editor">
          <div class="evidence-draft-polish-bar">
            <button class="btn btn-sm btn-outline" data-action="polish-evidence-draft" type="button" ${saving || polishing || !targetFact ? 'disabled' : ''}>
              ${polishing ? '<span class="spinner"></span> LLM 润色中…' : `${icon('sparkle')} ${targetFact ? 'LLM 润色草稿' : '选择 Fact 后可润色'}`}
            </button>
            <span class="hint">仅根据已填标题、摘录和来源 Chunk 润色，结果需要人工复核后保存。</span>
          </div>
          <div class="readiness-box blocked evidence-draft-error" data-evidence-polish-error ${modalState.polishError ? '' : 'hidden'}><div class="readiness-title">${icon('alert')} 润色失败</div><p class="hint">${esc(modalState.polishError)}；原草稿已保留。</p></div>
          <div class="evidence-draft-model" data-evidence-model ${modalState.model ? '' : 'hidden'}>模型：${esc(modalState.model)}</div>
          <label class="field">
            <span class="field-label">Evidence 标题 <span class="req">*</span></span>
            <input class="input" id="evidence-draft-title" data-bind="evidence-draft-title" value="${attr(draft.title)}" placeholder="概括这条证据" maxlength="160" ${saving || polishing ? 'disabled' : ''}>
          </label>
          <label class="field">
            <span class="field-label">Evidence 摘录 <span class="req">*</span></span>
            <textarea class="textarea evidence-draft-excerpt-input" id="evidence-draft-excerpt" data-bind="evidence-draft-excerpt" rows="10" placeholder="摘录可核验的原文，保留数字、单位、条件和否定语义" ${saving || polishing ? 'disabled' : ''}>${esc(draft.excerpt)}</textarea>
            <span class="hint">一条 Evidence 记录一项可核验事实。来源不会自动拼接，可逐条插入原文后编辑；Fact 关联按上方选择保存。</span>
          </label>
          <div class="evidence-draft-save-note" data-evidence-save-note>
            保存后创建 1 条草稿 Evidence，关联 ${chunks.length} 个来源 Chunk${targetFact ? `，并关联 ${esc(draft.fact_id)}` : '，不关联 Fact'}。
          </div>
        </div>
        <section class="evidence-draft-sources">
          <div class="evidence-draft-sources-head">
            <div>
              <h3>来源 Chunk</h3>
              <p>核对每个来源，只保留能支撑这条 Evidence 的 Chunk。</p>
            </div>
            <span class="chip plain" data-evidence-source-count>${chunks.length} 个</span>
          </div>
          ${chunks.length ? chunks.map((chunk) => `
            <article class="evidence-draft-source" data-evidence-source="${attr(chunk.chunk_id)}">
              <div class="evidence-draft-source-head">
                <div class="evidence-draft-source-meta">
                  <strong>${esc(chunk.document_name || chunk.document_id || '未命名文档')}</strong>
                  <span>${esc(chunk.chunk_id)} · ${esc(pageLabel(chunk.page))}</span>
                </div>
                <div class="evidence-draft-source-actions">
                  <button class="btn btn-sm btn-outline" data-action="insert-evidence-source" data-id="${attr(chunk.chunk_id)}" type="button" ${saving || polishing ? 'disabled' : ''}>插入原文</button>
                  <button class="icon-btn" data-action="remove-evidence-source" data-id="${attr(chunk.chunk_id)}" type="button" aria-label="移除来源 ${attr(chunk.chunk_id)}" ${saving || polishing ? 'disabled' : ''}>${icon('x')}</button>
                </div>
              </div>
              <pre class="evidence-draft-source-content">${esc(chunk.content)}</pre>
            </article>`).join('') : ''}
          <div class="evidence-draft-sources-empty" data-evidence-sources-empty ${chunks.length ? 'hidden' : ''}>${emptyState({
              title: '还没有来源 Chunk',
              copy: '返回候选列表，至少选择一个 Chunk 后再保存。',
              compact: true,
              iconName: 'chunk',
            })}</div>
        </section>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-action="close-modal" type="button" ${saving || polishing ? 'disabled' : ''}>返回候选 Chunk</button>
      <button class="btn btn-primary" data-action="save-evidence-draft" type="button" ${saving || polishing || !chunks.length || (modalState.origin !== 'workspace' && !targetFact) ? 'disabled' : ''}>
        ${saving ? '<span class="spinner light"></span> 保存中…' : `${icon('check')} 保存 Evidence`}
      </button>`,
    wide: true,
  });
}

function renderConfigModal() {
  const config = ui.data?.config || {};
  const datasets = config.ragflow?.datasets || [];
  return modalShell({
    title: '上游服务配置',
    subtitle: '这里只展示非敏感连接摘要，不读取或回显 API Key。',
    body: `
      <dl class="config-grid">
        <div class="config-row"><dt>RAGFlow</dt><dd>${config.ragflow?.configured ? '已配置' : '未配置'}${config.ragflow?.host ? ` · ${esc(config.ragflow.host)}` : ''}</dd></div>
        <div class="config-row"><dt>RAGFlow 数据集</dt><dd>${datasets.length ? datasets.map((item) => esc(item.name || item.id)).join('、') : '未配置'}</dd></div>
        <div class="config-row"><dt>LLM</dt><dd>${config.llm?.configured ? '已配置' : '未配置'}${config.llm?.model ? ` · ${esc(config.llm.model)}` : ''}${config.llm?.host ? ` · ${esc(config.llm.host)}` : ''}</dd></div>
        <div class="config-row"><dt>配置文件</dt><dd class="mono truncate">${esc(config.config_file || '未返回')}</dd></div>
      </dl>
      <div class="config-code">RAGFLOW_BASE_URL=...
RAGFLOW_API_KEY=********
RAGFLOW_DATASETS=${esc(datasets.map((item) => `${item.id}:${item.name}`).join(',') || '<dataset_id>:<display_name>')}
LLM_BASE_URL=...
LLM_API_KEY=********
LLM_MODEL=${esc(config.llm?.model || '<model>')}</div>
      <p class="hint">修改后重启 golden 服务即可生效。前端搜索与召回试跑都经过本地服务端，不直接接触上游密钥。</p>`,
    footer: `<button class="btn btn-primary" data-action="close-modal" type="button">知道了</button>`,
  });
}

function renderReviewerNameModal(modalState) {
  return modalShell({
    title: '设置显示名',
    subtitle: '显示名保存在当前浏览器，只用于领取标记。',
    body: `
      ${modalState.error ? `<div class="readiness-box blocked"><div class="readiness-title">${icon('alert')} ${esc(modalState.error)}</div></div>` : ''}
      <label class="field">
        <span class="field-label">你的显示名</span>
        <input class="input" id="reviewer-name-input" data-bind="reviewer-name" value="${attr(modalState.value || '')}" placeholder="例如：张三" maxlength="40" autocomplete="off">
      </label>`,
    footer: `
      <button class="btn btn-ghost" data-action="close-modal" type="button">取消</button>
      <button class="btn btn-primary" data-action="save-reviewer-name" type="button">${icon('check')} 保存</button>`,
  });
}

function renderHelpModal() {
  return modalShell({
    title: '使用说明',
    subtitle: '以 Query 为主键组织 Golden Dataset，证据链必须逐层落到可检索 Chunk。',
    body: `
      <ol class="instruction-list">
        <li><strong>手写 Fact</strong><span>先把业务事实写成可核验陈述，保留数字、单位、适用范围和否定语义。</span></li>
        <li><strong>构造 Query 组</strong><span>选择 Facts 并分配为必需单项、必需组、任选组、可选或禁止。必需组内每条各计一项且要全部命中；每个任选组计一项，命中组内任一 Fact 即满足。生成主问、同义句和口语化变体，第一条是主问。</span></li>
        <li><strong>关联 Evidence</strong><span>已有 Evidence 可多选关联；新证据从本地或 RAGFlow Chunk 摘录，一条 Evidence 可覆盖多个 Chunk。</span></li>
        <li><strong>设置 OR / AND</strong><span>OR 表示任一 Evidence 命中即支撑 Fact；AND 表示每条带 Chunk 的 Evidence 都必须命中。</span></li>
        <li><strong>召回试跑</strong><span>用 Query 原文直接检索 RAGFlow；必需单项和必需组成员逐条计分，每个任选组独立计一项。没有可评分条件时报告为 null。</span></li>
        <li><strong>确认与推进</strong><span>确认 Query 后继续下一条。草稿和待复核仍可编辑，不会自动进入正式 Golden 集。</span></li>
      </ol>`,
    footer: `<button class="btn btn-primary" data-action="close-modal" type="button">开始审核</button>`,
  });
}

function renderModal() {
  if (!modalRoot) return;
  const modalState = ui.modal;
  if (!modalState) {
    modalRoot.innerHTML = '';
    return;
  }
  if (modalState.type === 'query-edit') modalRoot.innerHTML = renderQueryEditModal(modalState);
  else if (modalState.type === 'delete') modalRoot.innerHTML = renderDeleteModal(modalState);
  else if (modalState.type === 'recall') modalRoot.innerHTML = renderRecallModal(modalState);
  else if (modalState.type === 'evidence-create') modalRoot.innerHTML = renderEvidenceCreateModal(modalState);
  else if (modalState.type === 'config') modalRoot.innerHTML = renderConfigModal();
  else if (modalState.type === 'help') modalRoot.innerHTML = renderHelpModal();
  else if (modalState.type === 'reviewer-name') modalRoot.innerHTML = renderReviewerNameModal(modalState);
  else modalRoot.innerHTML = '';
}

function dismissToast(id) {
  ui.toasts = ui.toasts.filter((item) => item.id !== id);
  renderToasts();
}

function toast(message, type = 'info') {
  const item = {
    id: ++toastSequence,
    type: ['success', 'error', 'info'].includes(type) ? type : 'info',
    message: text(message),
  };
  if (!item.message) return;
  ui.toasts.push(item);
  renderToasts();
  window.setTimeout(() => dismissToast(item.id), type === 'error' ? 6500 : 4200);
}

function renderToasts() {
  if (!toastRoot) return;
  toastRoot.innerHTML = ui.toasts.map((item) => `
    <div class="toast ${attr(item.type)}" role="${item.type === 'error' ? 'alert' : 'status'}">
      ${icon(item.type === 'success' ? 'check' : item.type === 'error' ? 'alert' : 'info')}
      <span>${esc(item.message)}</span>
      <span class="spacer"></span>
      <button class="btn-link" data-action="dismiss-toast" data-id="${item.id}" type="button" aria-label="关闭提示">${icon('close')}</button>
    </div>`).join('');
}

async function refreshState() {
  const state = await api.getState();
  applyServerState(state);
  return state;
}

async function applyMutationResult(result) {
  if (result?.state) {
    applyServerState(result.state);
    return result.state;
  }
  return refreshState();
}

async function runMutation(task, { success = '', after = null } = {}) {
  if (ui.busy) return null;
  ui.busy = true;
  try {
    const result = await task();
    await applyMutationResult(result);
    ui.busy = false;
    if (after) after(result);
    if (success) toast(success, 'success');
    render();
    return result;
  } catch (error) {
    ui.busy = false;
    toast(apiErrorText(error), 'error');
    render();
    return null;
  }
}

async function runClaimMutation(task, successMessage) {
  if (ui.busy) return null;
  ui.busy = true;
  try {
    const result = await task();
    await applyMutationResult(result);
    toast(successMessage, 'success');
    render();
    return result;
  } finally {
    ui.busy = false;
  }
}

async function claimQueryFromList(queryId) {
  const owner = requireReviewerName();
  if (!owner) return;
  try {
    await runClaimMutation(() => api.claimQuery(queryId, owner), `已领取 ${queryId}`);
  } catch (error) {
    if (error.status === 409) promptReviewerName(error.message || '这条 Query 已被领取。');
    else toast(apiErrorText(error), 'error');
  }
}

async function renewQueryClaimFromList(queryId) {
  const owner = text(ui.reviewerName);
  if (!owner) {
    promptReviewerName('请先填写显示名。');
    return;
  }
  try {
    await runClaimMutation(() => api.renewQueryClaim(queryId, owner), '领取已续期 30 分钟');
  } catch (error) {
    toast(apiErrorText(error), 'error');
  }
}

async function releaseQueryClaimFromList(queryId) {
  const owner = text(ui.reviewerName);
  if (!owner) {
    promptReviewerName('请先填写显示名。');
    return;
  }
  try {
    await runClaimMutation(() => api.releaseQueryClaim(queryId, owner), '已释放领取');
  } catch (error) {
    toast(apiErrorText(error), 'error');
  }
}

async function setRagflowChunkAvailability(chunkId, available) {
  const chunk = ragflowChunkAvailabilityRow(chunkId);
  if (!chunk) {
    toast('找不到目标 Chunk', 'error');
    return;
  }
  const datasetId = text(chunk.dataset_id);
  const documentId = text(chunk.document_id);
  if (!datasetId || !documentId) {
    toast('该 Chunk 缺少 dataset_id 或 document_id，无法更新 RAGFlow 可用性', 'error');
    return;
  }
  const label = available ? '启用' : '禁用';
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    await api.setRagflowChunkAvailability({
      dataset_id: datasetId,
      document_id: documentId,
      chunk_ids: [chunk.chunk_id],
      available,
    });
    const patchAvailability = (item) => item?.chunk_id === chunk.chunk_id
      ? { ...item, available, available_int: available ? 1 : 0 }
      : item;
    ui.remoteChunks = ui.remoteChunks.map(patchAvailability);
    if (ui.data?.chunks) ui.data.chunks = ui.data.chunks.map(patchAvailability);
    for (const key of ['keyword', 'query']) {
      const candidates = ui.evidenceWorkspace.candidatesByMode[key];
      if (candidates) ui.evidenceWorkspace.candidatesByMode[key] = candidates.map(patchAvailability);
    }
    ui.evidenceWorkspace.candidates = ui.evidenceWorkspace.candidates.map(patchAvailability);
    for (const [id, selected] of ui.evidenceWorkspace.selectedChunks) {
      if (id === chunk.chunk_id) ui.evidenceWorkspace.selectedChunks.set(id, patchAvailability(selected));
    }
    if (localChunk(chunk.chunk_id)) {
      const local = localChunk(chunk.chunk_id);
      local.available = available;
      local.available_int = available ? 1 : 0;
    }
    toast(`${label} Chunk ${chunk.chunk_id} 成功，已调用 RAGFlow`, 'success');
  } catch (error) {
    toast(apiErrorText(error), 'error');
  } finally {
    ui.busy = false;
    render();
  }
}

function setModal(modalState) {
  ui.modal = modalState;
  renderModal();
}

function closeModal() {
  if (ui.modal?.type === 'evidence-create') {
    ui.modal.stage = ui.modal.stage === 'confirm-discard' ? 'editing' : 'confirm-discard';
    renderModal();
    return;
  }
  ui.modal = null;
  renderModal();
}

function navigationParams(element) {
  const raw = element.dataset.params || '';
  const source = raw ? new URLSearchParams(raw) : new URLSearchParams();
  if (element.dataset.query) source.set('query', element.dataset.query);
  if (element.dataset.fact) source.set('fact', element.dataset.fact);
  return normalizeNavigationParams(source);
}

function currentNavigationParams() {
  return normalizeNavigationParams(parseRoute().params);
}

function returnNavigationParams(params = currentNavigationParams()) {
  const chain = text(params.returnTo).split(',').filter(Boolean);
  const remaining = chain.slice(0, -1);
  if (!remaining.length) remaining.push(params.query ? 'workbench' : 'facts');
  return {
    query: params.query,
    fact: params.fact,
    evidence: params.evidence,
    returnTo: remaining.join(','),
  };
}

function navigateFromReturnChain() {
  const params = currentNavigationParams();
  const chain = text(params.returnTo).split(',').filter(Boolean);
  const nextScreen = chain.at(-1) || 'workbench';
  navigate(nextScreen, returnNavigationParams(params));
}

function moveToQuery(queryId, factId = '') {
  if (!query(queryId)) {
    toast('Query 不存在或已被删除', 'error');
    return;
  }
  ui.modal = null;
  selectQuery(queryId, { resetEvidence: true });
  if (factId && fact(factId)) selectFact(factId, { resetEditor: true });
  navigate('workbench', { query: queryId, fact: factId });
}

function factReviewEvidenceParams(queryId = '', factId = '', evidenceId = '') {
  const navigation = currentNavigationParams();
  return {
    query: queryId || navigation.query || ui.queryId,
    fact: factId || navigation.fact || '',
    returnTo: navigation.returnTo || 'workbench',
    evidence: evidenceId,
  };
}

function openEvidenceInFactReview(evidenceId) {
  const row = evidence(evidenceId);
  if (!row) {
    toast('Evidence 不存在或已被删除', 'error');
    return;
  }
  const linkedFactId = rows('fact_evidence')
    .find((link) => (link.evidence_ids || []).includes(evidenceId))?.fact_id || '';
  const targetFactId = linkedFactId || ui.factId;
  if (!fact(targetFactId)) {
    toast('请选择目标 Fact，再查看或编辑这条 Evidence', 'info');
    return;
  }
  ui.modal = null;
  selectFact(targetFactId, { resetEditor: false });
  loadEvidenceDraft(evidenceId, targetFactId);
  navigate('fact-review', factReviewEvidenceParams(
    currentNavigationParams().query,
    targetFactId,
    evidenceId,
  ));
}

function openQueryFacts(queryId) {
  if (queryId !== ui.queryId) moveToQuery(queryId);
  view.querySelector('[data-bind="query-facts-search"]')?.focus();
}

function openQueryEditor(queryId) {
  const row = query(queryId);
  if (!row) {
    toast('Query 不存在或已被删除', 'error');
    return;
  }
  setModal({
    type: 'query-edit',
    draft: {
      query_id: row.query_id,
      text: row.text || '',
      parent_query_id: row.parent_query_id || '',
      variant_type: row.variant_type || 'canonical',
      expected_behavior: row.expected_behavior || 'answer',
      status: row.status || 'draft',
      notes: row.notes || '',
    },
  });
}

function openDeleteConfirmation(entityType, id, label, description) {
  if (!id) return;
  setModal({ type: 'delete', entityType, id, label, description });
}

async function runRecall(queryId) {
  const targetId = queryId || ui.queryId;
  if (!query(targetId)) {
    toast('Query 不存在或已被删除', 'error');
    return;
  }
  ui.modal = { type: 'recall', queryId: targetId, loading: true, report: null, retrieval: null, error: '' };
  renderModal();
  try {
    const result = await api.runRecall({ query_id: targetId, top_k: ui.topK });
    if (ui.modal?.type !== 'recall' || ui.modal.queryId !== targetId) return;
    ui.modal = {
      type: 'recall',
      queryId: targetId,
      loading: false,
      report: result.report,
      retrieval: result.retrieval,
      error: '',
    };
    renderModal();
  } catch (error) {
    if (ui.modal?.type !== 'recall' || ui.modal.queryId !== targetId) return;
    ui.modal = {
      type: 'recall',
      queryId: targetId,
      loading: false,
      report: null,
      retrieval: null,
      error: apiErrorText(error),
    };
    renderModal();
  }
}

async function searchRagflow() {
  if (ui.remoteLoading) return;
  const term = text(ui.search) || text(ui.screen === 'fact-review' ? currentFact()?.statement : currentQuery()?.text);
  if (!term) {
    toast('请输入检索关键词或问题', 'error');
    return;
  }
  ui.centerTab = 'chunk';
  ui.search = term;
  ui.remoteSearchTerm = term;
  ui.remoteLoading = true;
  render();
  try {
    const result = await api.searchRagflow({ query: term, top_k: ui.topK });
    ui.remoteChunks = Array.isArray(result.chunks) ? result.chunks : [];
    ui.remoteMeta = result;
    ui.selectedChunkIds.clear();
    const stillPresent = findChunk(ui.previewChunkId);
    if (!stillPresent) ui.previewChunkId = ui.remoteChunks[0]?.chunk_id || '';
    toast(`RAGFlow 返回 ${ui.remoteChunks.length} 个 Chunk`, 'success');
  } catch (error) {
    ui.remoteChunks = [];
    ui.remoteMeta = null;
    toast(apiErrorText(error), 'error');
  } finally {
    ui.remoteLoading = false;
    render();
  }
}

function evidenceSelectQuery(queryId) {
  const row = query(queryId);
  if (!row) return;
  const workspace = ui.evidenceWorkspace;
  const changed = queryId !== workspace.queryId;
  workspace.queryId = queryId;
  workspace.queryText = text(row.text);
  if (changed) {
    workspace.factId = factsOfQuery(queryId)[0]?.fact_id || '';
    workspace.candidatesByMode.query = [];
    if (workspace.mode === 'query') {
      workspace.candidates = [];
      workspace.result = null;
    }
    workspace.expandedChunkId = '';
    workspace.error = '';
  }
  render();
}

function evidenceMatchBody() {
  const workspace = ui.evidenceWorkspace;
  const queryText = text(workspace.queryText);
  if (!queryText) {
    toast('请输入 Query 文本，或选择一个真实 Query', 'error');
    return null;
  }
  return {
    ...(workspace.queryId ? { query_id: workspace.queryId } : {}),
    query_text: queryText,
    ...(workspace.factId ? { fact_id: workspace.factId } : {}),
    top_k: workspace.topK,
    min_similarity: workspace.minSimilarity,
    ...(workspace.datasetIds.length ? { dataset_ids: workspace.datasetIds } : {}),
  };
}

async function loadEvidenceInventory({ silent = false } = {}) {
  const workspace = ui.evidenceWorkspace;
  try {
    const result = await api.getEvidenceInventory();
    workspace.inventory = result?.inventory || null;
    workspace.config = result?.config || null;
    if (result?.config?.ragflow?.datasets) {
      workspace.datasetIds = workspace.datasetIds.filter((id) => configuredDatasetOptions().some((item) => item.id === id));
    }
    if (!workspace.queryId) evidenceSyncCurrentQuery();
    if (!silent) render();
    return true;
  } catch (error) {
    workspace.error = apiErrorText(error);
    if (!silent) render();
    toast(workspace.error, 'error');
    return false;
  }
}

function evidenceSyncCurrentQuery() {
  const workspace = ui.evidenceWorkspace;
  const row = currentQuery();
  if (!row) return;
  workspace.queryId = row.query_id;
  workspace.queryText = text(row.text);
  workspace.factId = ui.factId || factsOfQuery(row.query_id)[0]?.fact_id || '';
}

async function runEvidenceAutoMatch() {
  const workspace = ui.evidenceWorkspace;
  if (ui.busy || workspace.loading) return;
  const body = evidenceMatchBody();
  if (!body) return;
  workspace.loading = true;
  workspace.error = '';
  render();
  try {
    const result = await api.autoMatchEvidence(body);
    const isStale = workspace !== ui.evidenceWorkspace || workspace.queryId !== (body.query_id || '');
    if (isStale) return;
    const candidates = (Array.isArray(result?.candidates) ? result.candidates : [])
      .map(normalizeCandidate)
      .filter(Boolean);
    workspace.candidatesByMode.query = candidates;
    if (workspace.mode !== 'query') return;
    workspace.candidates = candidates;
    rememberEvidenceCandidates(candidates);
    workspace.result = result;
    workspace.inventory = result?.inventory || workspace.inventory;
    if (!fact(workspace.factId)) {
      const linkedFact = workspace.candidates
        .flatMap((candidate) => candidate.matched_fact_ids)
        .find((id) => fact(id));
      if (linkedFact) workspace.factId = linkedFact;
    }
    workspace.expandedChunkId = '';
    if (!workspace.candidates.length) workspace.error = '检索返回的候选缺少 Chunk ID，请调整检索条件后重试。';
    render();
    if (workspace.candidates.length) toast(`匹配到 ${workspace.candidates.length} 个候选 Chunk`, 'success');
    return result;
  } catch (error) {
    if (workspace !== ui.evidenceWorkspace || workspace.queryId !== (body.query_id || '') || workspace.mode !== 'query') return;
    workspace.candidatesByMode.query = [];
    workspace.candidates = [];
    workspace.result = null;
    workspace.error = apiErrorText(error);
    render();
    toast(workspace.error, 'error');
  } finally {
    if (workspace === ui.evidenceWorkspace) {
      workspace.loading = false;
      render();
    }
  }
}

function openEvidenceCreateDraft(candidates = selectedAutoMatchCandidates(), { origin = ui.screen === 'evidence' ? 'workspace' : 'fact-review' } = {}) {
  const workspace = ui.evidenceWorkspace;
  if (ui.busy) return;
  if (!candidates.length) {
    toast('请先选择至少一个候选 Chunk', 'info');
    return;
  }
  const factId = origin === 'workspace' ? '' : workspace.factId;
  if (origin !== 'workspace' && !fact(factId)) {
    toast('请选择目标 Fact，再创建 Evidence', 'error');
    return;
  }
  const chunks = candidates.map(normalizeChunkForSave);
  ui.modal = {
    type: 'evidence-create',
    origin,
    stage: 'editing',
    error: '',
    polishError: '',
    polishing: false,
    model: '',
    draft: {
      fact_id: factId,
      title: defaultEvidenceTitle(candidates),
      excerpt: '',
      status: 'draft',
      chunks,
    },
  };
  renderModal();
}

function evidenceCreateDraftError(message) {
  if (ui.modal?.type !== 'evidence-create') return;
  ui.modal.error = message;
  syncEvidenceCreateModal(modalRoot, ui.modal, { skipFields: true });
}

function insertEvidenceSource(chunkId) {
  const modalState = ui.modal;
  if (modalState?.type !== 'evidence-create' || ui.busy) return;
  const source = modalState.draft.chunks.find((chunk) => chunk.chunk_id === chunkId);
  if (!source) return;
  const current = text(modalState.draft.excerpt);
  modalState.draft.excerpt = current ? `${current}\n\n${source.content}` : source.content;
  modalState.error = '';
  modalState.polishError = '';
  syncEvidenceCreateModal(modalRoot, modalState);
  const excerpt = modalRoot.querySelector('[data-bind="evidence-draft-excerpt"]');
  excerpt?.focus();
  if (excerpt && typeof excerpt.setSelectionRange === 'function') {
    const end = excerpt.value.length;
    excerpt.setSelectionRange(end, end);
  }
}

function removeEvidenceDraftSource(chunkId) {
  const modalState = ui.modal;
  if (modalState?.type !== 'evidence-create' || ui.busy) return;
  modalState.draft.chunks = modalState.draft.chunks.filter((chunk) => chunk.chunk_id !== chunkId);
  ui.evidenceWorkspace.selectedChunkIds.delete(chunkId);
  modalState.error = '';
  modalState.polishError = '';
  syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
}

async function saveEvidenceCreateDraft() {
  const modalState = ui.modal;
  if (modalState?.type !== 'evidence-create' || ui.busy) return;
  const draft = modalState.draft;
  const title = text(draft.title);
  const excerpt = text(draft.excerpt);
  const targetFact = fact(draft.fact_id);
  const chunks = unique(draft.chunks.map((chunk) => chunk.chunk_id))
    .map((chunkId) => draft.chunks.find((chunk) => chunk.chunk_id === chunkId))
    .filter(Boolean);
  if ((draft.fact_id || modalState.origin !== 'workspace') && !targetFact) return evidenceCreateDraftError('目标 Fact 已不存在，请重新选择或取消可选关联。');
  if (!title) return evidenceCreateDraftError('请填写 Evidence 标题。');
  if (!excerpt) return evidenceCreateDraftError('请填写 Evidence 摘录。');
  if (!chunks.length) return evidenceCreateDraftError('至少保留一个来源 Chunk。');
  if (chunks.some((chunk) => !text(chunk.content))) return evidenceCreateDraftError('来源 Chunk 缺少原文，请移除后重新检索。');

  const chunkIds = chunks.map((chunk) => chunk.chunk_id);
  const body = {
    title,
    excerpt,
    status: 'draft',
    ...(targetFact ? { fact_id: targetFact.fact_id } : {}),
    chunk_ids: chunkIds,
    chunks,
  };
  modalState.error = '';
  modalState.polishError = '';
  syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
  const resultPromise = runMutation(() => api.createEvidence(body), {
    success: `已创建 1 条 Evidence，关联 ${chunkIds.length} 个来源 Chunk`,
    after: (saved) => {
      const workspace = ui.evidenceWorkspace;
      resetWorkspaceSelection({ preserveSearch: true });
      const evidenceId = saved?.evidence?.evidence_id || '';
      workspace.candidates = workspace.candidates.map((candidate) => (
        chunkIds.includes(candidate.chunk_id)
          ? {
            ...candidate,
            is_linked: true,
            matched_fact_ids: unique([...(candidate.matched_fact_ids || []), ...(targetFact ? [targetFact.fact_id] : [])]),
            matched_evidence_ids: unique([...candidate.matched_evidence_ids, evidenceId].filter(Boolean)),
          }
          : candidate
      ));
      ui.modal = null;
    },
  });
  renderModal();
  const result = await resultPromise;
  if (!result && ui.modal === modalState) {
    modalState.error = '保存没有完成。草稿仍保留，请检查提示后重试。';
    syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
    return;
  }
  if (result) {
    await loadEvidenceInventory({ silent: true });
    render();
  }
}

async function polishEvidenceCreateDraft() {
  const modalState = ui.modal;
  if (modalState?.type !== 'evidence-create' || ui.busy || modalState.polishing) return;
  const draft = modalState.draft;
  if (!fact(draft.fact_id)) {
    modalState.polishError = 'LLM 润色需要先选择关联 Fact。无需润色时可直接保存独立 Evidence。';
    syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
    return;
  }
  if (!text(draft.title) && !text(draft.excerpt)) {
    modalState.polishError = '请先填写标题或摘录。';
    syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
    return;
  }
  modalState.polishing = true;
  modalState.polishError = '';
  syncEvidenceCreateModal(modalRoot, modalState, { skipFields: true });
  try {
    const result = await api.polishEvidenceDraft({
      fact_id: draft.fact_id,
      title: text(draft.title),
      excerpt: text(draft.excerpt),
      chunks: Array.isArray(draft.chunks) ? draft.chunks : [],
    });
    if (ui.modal !== modalState) return;
    const nextTitle = text(result.title);
    const nextExcerpt = text(result.excerpt);
    if (nextTitle) modalState.draft.title = nextTitle;
    if (nextExcerpt) modalState.draft.excerpt = nextExcerpt;
    modalState.model = text(result.model);
    toast('LLM 已润色草稿，请人工复核后保存', 'success');
  } catch (error) {
    if (ui.modal !== modalState) return;
    modalState.polishError = apiErrorText(error);
  } finally {
    if (ui.modal === modalState) {
      modalState.polishing = false;
      syncEvidenceCreateModal(modalRoot, modalState);
    }
  }
}

async function saveEvidence({ success = '' } = {}) {
  const draft = ui.editorDraft;
  const body = evidenceDraftBody();
  if (!body) return null;
  const result = await runMutation(() => api.createEvidence(body), {
    success: success || (draft.mode === 'edit' ? 'Evidence 已更新' : 'Evidence 已创建并关联当前 Fact'),
    after: (saved) => {
      ui.selectedChunkIds.clear();
      const evidenceId = saved?.evidence?.evidence_id;
      if (evidenceId) loadEvidenceDraft(evidenceId, ui.factId);
    },
  });
  return result;
}

async function linkSelectedEvidence() {
  if (!fact(ui.factId)) {
    toast('请先选择 Fact', 'error');
    return;
  }
  if (!ui.selectedEvidenceIds.size) {
    toast('请先选择至少一条 Evidence', 'info');
    return;
  }
  const nextIds = unique([...evidenceIdsOfFact(ui.factId), ...ui.selectedEvidenceIds])
    .filter((id) => evidence(id));
  await runMutation(() => api.linkFactEvidence(ui.factId, nextIds, ui.relationOperator), {
    success: `已关联 ${ui.selectedEvidenceIds.size} 条 Evidence`,
    after: () => ui.selectedEvidenceIds.clear(),
  });
}

async function unlinkFactEvidence(evidenceId) {
  if (!fact(ui.factId)) return;
  const nextIds = evidenceIdsOfFact(ui.factId).filter((id) => id !== evidenceId);
  await runMutation(() => api.linkFactEvidence(ui.factId, nextIds, ui.relationOperator), {
    success: '已解除 Evidence 关联',
    after: () => {
      ui.selectedEvidenceIds.delete(evidenceId);
      if (ui.editorDraft?.evidence_id === evidenceId) resetEditorForFact(ui.factId);
    },
  });
}

async function saveAssociationAndAdvance() {
  if (!fact(ui.factId)) {
    toast('请先选择 Fact', 'error');
    return;
  }
  const nextId = nextFact(ui.factId, 1);
  let savedEvidenceId = '';
  if (evidenceDraftIsDirty()) {
    const saved = await saveEvidence({ success: '' });
    if (!saved) return;
    savedEvidenceId = saved.evidence?.evidence_id || '';
  }
  const evidenceIds = unique([
    ...evidenceIdsOfFact(ui.factId),
    ...ui.selectedEvidenceIds,
    savedEvidenceId,
  ]).filter((id) => evidence(id));
  await runMutation(() => api.linkFactEvidence(ui.factId, evidenceIds, ui.relationOperator), {
    success: '关联已保存',
    after: () => {
      ui.selectedEvidenceIds.clear();
      if (nextId) moveToFact(nextId);
    },
  });
}

async function approveQuery(queryId, advance = false) {
  const row = query(queryId);
  if (!row) {
    toast('Query 不存在或已被删除', 'error');
    return;
  }
  const queryIdToAdvance = advance ? nextQuery(queryId, 1) : '';
  if (ui.screen === 'workbench' && queryId === ui.queryId) {
    if (!await saveQueryFacts({ success: '' })) return;
  }

  const latest = query(queryId) || row;
  await runMutation(() => api.saveEntity('queries', { ...latest, status: 'approved' }), {
    success: 'Query 已确认',
    after: () => {
      ui.selectedEvidenceIds.clear();
      if (advance && queryIdToAdvance && queryIdToAdvance !== queryId) moveToQuery(queryIdToAdvance);
    },
  });
}

async function generateBuilderCandidates() {
  if (ui.builder.generating) return;
  if (!ui.builder.factLinks.length) {
    toast('请先选择至少一条 Fact', 'error');
    return;
  }
  ui.builder.generating = true;
  ui.builder.error = '';
  render();
  try {
    const result = await api.draftQueries({
      fact_ids: ui.builder.factLinks.map((link) => link.fact_id),
      seed_text: text(ui.builder.seedText),
      count: 6,
    });
    const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
      .map((candidate, index) => ({
        id: `C${++candidateSequence}`,
        text: text(candidate.text),
        variant_type: index === 0
          ? 'canonical'
          : candidate.variant_type === 'canonical'
            ? 'paraphrase'
            : (VARIANT_LABELS[candidate.variant_type] ? candidate.variant_type : 'paraphrase'),
        rationale: text(candidate.rationale),
        selected: true,
      }))
      .filter((candidate) => candidate.text);
    ui.builder.candidates = candidates;
    ui.builder.model = result.model || '';
    if (!candidates.length) ui.builder.error = 'LLM 没有返回可用候选，请改写草稿后重试。';
  } catch (error) {
    ui.builder.error = apiErrorText(error);
  } finally {
    ui.builder.generating = false;
    render();
  }
}

async function submitBuilder() {
  if (!ui.builder.factLinks.length) {
    toast('请先选择至少一条 Fact', 'error');
    return;
  }
  const selected = ui.builder.candidates
    .filter((candidate) => candidate.selected && text(candidate.text))
    .map((candidate) => ({
      text: text(candidate.text),
      variant_type: candidate.variant_type,
    }));
  const seed = text(ui.builder.seedText);
  const source = selected.length
    ? selected
    : seed
      ? [{ text: seed, variant_type: 'canonical' }]
      : [];
  if (!source.length) {
    toast('请选择候选 Query，或先在左侧填写主问草稿', 'error');
    return;
  }

  const queries = source.map((candidate, index) => ({
    text: candidate.text,
    variant_type: index === 0 ? 'canonical' : candidate.variant_type === 'canonical' ? 'paraphrase' : candidate.variant_type,
    expected_behavior: ui.builder.expectedBehavior,
    status: 'draft',
  }));
  await runMutation(() => api.createQueryBundle({
    queries,
    facts: ui.builder.factLinks.map((link) => ({
      fact_id: link.fact_id,
      requirement: link.requirement,
      group_id: link.group_id || '',
    })),
  }), {
    success: `已创建 ${queries.length} 条 Query`,
    after: (result) => {
      ui.builder = emptyBuilder();
      ui.selectedEvidenceIds.clear();
      const mainQueryId = result?.main_query_id || '';
      if (mainQueryId) moveToQuery(mainQueryId);
    },
  });
}

async function saveFact() {
  const draft = ui.factDraft;
  if (!draft) return;
  const statement = text(draft.statement);
  if (!statement) {
    toast('请填写事实陈述', 'error');
    return;
  }
  const body = {
    statement,
    topic: text(draft.topic),
    fact_type: draft.fact_type,
    importance: draft.importance,
    source_note: text(draft.source_note),
    status: draft.status,
  };
  if (draft.mode === 'edit') body.fact_id = draft.fact_id;

  await runMutation(() => api.saveEntity('facts', body), {
    success: draft.mode === 'edit' ? 'Fact 已更新' : 'Fact 已创建',
    after: (result) => {
      if (result?.row?.fact_id) setFactDraft(result.row.fact_id);
    },
  });
}

function openFactWorkbench(factId, evidenceId = '') {
  if (!fact(factId)) return;
  const params = currentNavigationParams();
  ui.modal = null;
  selectFact(factId);
  navigate('fact-review', {
    query: params.query,
    fact: factId,
    evidence: evidenceId,
    returnTo: extendReturnChain(params, 'facts'),
  });
}

async function saveQueryEdit() {
  if (ui.modal?.type !== 'query-edit') return;
  const draft = ui.modal.draft;
  if (!text(draft.text)) {
    toast('Query 文本不能为空', 'error');
    return;
  }
  await runMutation(() => api.saveEntity('queries', {
    query_id: draft.query_id,
    text: text(draft.text),
    parent_query_id: draft.parent_query_id || '',
    variant_type: draft.variant_type,
    expected_behavior: draft.expected_behavior,
    status: draft.status,
    notes: text(draft.notes),
  }), {
    success: 'Query 已保存',
    after: () => {
      ui.modal = null;
    },
  });
}

async function saveQueryFacts({ success = 'Query 的 Fact 关联已保存', advance = false } = {}) {
  const review = queryReviewState();
  if (!review) return null;
  const queryId = review.queryId;
  const nextId = advance ? nextQuery(queryId, 1) : '';
  const facts = review.factLinks.map((link) => ({
    fact_id: link.fact_id,
    requirement: link.requirement,
    group_id: link.group_id || '',
  }));
  const factStatuses = Object.entries(review.factStatuses)
    .filter(([factId, status]) => fact(factId)?.status !== status)
    .map(([fact_id, status]) => ({ fact_id, status }));
  return runMutation(() => api.manageQueryFacts(queryId, facts, factStatuses), {
    success,
    after: () => {
      review.factLinks = queryFactLinks(queryId).map((link) => ({ fact_id: link.fact_id, requirement: link.requirement, group_id: link.group_id || '' }));
      review.factStatuses = {};
      if (nextId && nextId !== queryId) moveToQuery(nextId);
    },
  });
}

async function confirmDelete() {
  if (ui.modal?.type !== 'delete') return;
  const modalState = ui.modal;
  const result = await runMutation(() => api.deleteEntity(modalState.entityType, modalState.id), {
    success: `已删除 ${modalState.id}`,
    after: () => {
      ui.modal = null;
      if (modalState.entityType === 'chunks') {
        const workspace = ui.evidenceWorkspace;
        workspace.selectedChunkIds.delete(modalState.id);
        workspace.selectedChunks.delete(modalState.id);
        workspace.selectionOrder = workspace.selectionOrder.filter((id) => id !== modalState.id);
      }
      if (modalState.entityType === 'facts') {
        if (ui.factDraft?.fact_id === modalState.id) setFactDraft(rows('facts')[0]?.fact_id || '');
      }
      if (modalState.entityType === 'queries' && ui.screen === 'workbench') {
        const navigation = currentNavigationParams();
        navigate('workbench', { query: ui.queryId, returnTo: navigation.returnTo });
      }
    },
  });
  if (result && modalState.entityType === 'chunks' && ui.screen === 'evidence') {
    await loadEvidenceInventory({ silent: true });
    render();
  }
}

function updateBoundValue(bind, element) {
  const value = element.value;
  if (bind === 'workbench-search') {
    ui.search = value;
    return true;
  }
  if (bind === 'workspace-search' || bind === 'workspace-evidence-target-search' || bind === 'workspace-target-evidence') {
    if (ui.busy) return false;
    const key = { 'workspace-search': 'search', 'workspace-evidence-target-search': 'evidenceTargetSearch', 'workspace-target-evidence': 'targetEvidenceId' }[bind];
    ui.evidenceWorkspace.workflow[key] = value;
    return true;
  }
  if (bind === 'evidence-query-text') {
    ui.evidenceWorkspace.queryText = value;
    return false;
  }
  if (bind === 'evidence-keyword') {
    ui.evidenceWorkspace.keywordInput = value;
    return false;
  }
  if (bind === 'query-list-search') {
    ui.querySearch = value;
    return true;
  }
  if (bind === 'fact-search') {
    ui.factSearch = value;
    return true;
  }
  if (bind === 'builder-fact-search') {
    ui.builder.factSearch = value;
    return true;
  }
  if (bind === 'builder-candidate-search') {
    ui.builder.candidateSearch = value;
    return true;
  }
  if (bind === 'evidence-candidate-search') {
    if (ui.busy) return false;
    ui.evidenceWorkspace.workflow.candidateSearch = value;
    return true;
  }
  if (bind === 'overview-search') {
    ui.overviewSearch = value;
    return true;
  }
  if (ui.screen === 'workbench' && ui.queryReview && bind === 'query-facts-search') {
    ui.queryReview.factFilterText = value;
    syncQueryFactsPanel(view, ui.queryReview);
    return false;
  }

  if (ui.modal?.type === 'evidence-create' && bind === 'evidence-draft-fact') {
    if (ui.busy || ui.modal.polishing) return false;
    ui.modal.draft.fact_id = fact(value) ? value : '';
    ui.modal.error = '';
    ui.modal.polishError = '';
    syncEvidenceCreateModal(modalRoot, ui.modal, { skipFields: true });
    return false;
  }
  if (ui.modal?.type === 'evidence-create' && bind === 'evidence-draft-title') {
    ui.modal.draft.title = value;
    ui.modal.error = '';
    ui.modal.polishError = '';
    syncEvidenceCreateModal(modalRoot, ui.modal, { skipFields: true });
    return false;
  }
  if (ui.modal?.type === 'evidence-create' && bind === 'evidence-draft-excerpt') {
    ui.modal.draft.excerpt = value;
    ui.modal.error = '';
    ui.modal.polishError = '';
    syncEvidenceCreateModal(modalRoot, ui.modal, { skipFields: true });
    return false;
  }

  if (bind.startsWith('evidence-') && ui.editorDraft) {
    if (bind === 'evidence-title') ui.editorDraft.title = value;
    else if (bind === 'evidence-excerpt') ui.editorDraft.excerpt = value;
    else if (bind === 'evidence-status') ui.editorDraft.status = value;
    else return false;
    return true;
  }

  if (bind.startsWith('fact-') && ui.factDraft) {
    if (bind === 'fact-statement') ui.factDraft.statement = value;
    else if (bind === 'fact-topic') ui.factDraft.topic = value;
    else if (bind === 'fact-type') ui.factDraft.fact_type = value;
    else if (bind === 'fact-importance') ui.factDraft.importance = value;
    else if (bind === 'fact-status') ui.factDraft.status = value;
    else if (bind === 'fact-source-note') ui.factDraft.source_note = value;
    else return false;
    return true;
  }

  if (bind === 'builder-seed') {
    ui.builder.seedText = value;
    return true;
  }
  if (bind === 'builder-behavior') {
    ui.builder.expectedBehavior = value;
    return true;
  }
  if (bind === 'builder-candidate' || bind === 'builder-candidate-type') {
    const candidate = ui.builder.candidates.find((item) => item.id === element.dataset.id);
    if (!candidate) return false;
    if (bind === 'builder-candidate') candidate.text = value;
    else candidate.variant_type = value;
    return true;
  }

  if (ui.modal?.type === 'query-edit' && bind.startsWith('query-edit-')) {
    if (bind === 'query-edit-text') ui.modal.draft.text = value;
    else if (bind === 'query-edit-behavior') ui.modal.draft.expected_behavior = value;
    else if (bind === 'query-edit-status') ui.modal.draft.status = value;
    else if (bind === 'reviewer-name' && ui.modal?.type === 'reviewer-name') ui.modal.value = value;
    else if (bind === 'query-edit-notes') ui.modal.draft.notes = value;
    else return false;
    return true;
  }
  return false;
}

function handleInput(event) {
  const element = event.target.closest('[data-bind]');
  if (!element) return;
  if (element.tagName === 'SELECT') return;
  if (event.isComposing) return;
  if (updateBoundValue(element.dataset.bind, element)) renderWithFocus();
}

function handleCompositionEnd(event) {
  const element = event.target.closest('[data-bind]');
  if (!element || element.tagName === 'SELECT') return;
  if (updateBoundValue(element.dataset.bind, element)) {
    if (ui.screen === 'workbench' && ui.queryReview && element.dataset.bind === 'query-facts-search') return;
    renderWithFocus();
  }
}

function handleChange(event) {
  const element = event.target.closest('[data-bind], [data-action]');
  if (!element) return;
  if (element.dataset.bind) {
    if (element.tagName !== 'SELECT' && element.type !== 'radio' && element.type !== 'checkbox') return;
    if (updateBoundValue(element.dataset.bind, element)) renderWithFocus();
    return;
  }
  if (element.tagName !== 'SELECT') return;
  const action = element.dataset.action;
  if (action === 'select-query-control') {
    moveToQuery(element.value);
  } else if (action === 'select-review-fact') {
    moveToFact(element.value);
  } else if (action === 'filter-evidence-status') {
    ui.filters.status = element.value;
    render();
  } else if (action === 'filter-document') {
    ui.filters.document = element.value;
    render();
  } else if (action === 'filter-topic') {
    ui.filters.topic = element.value;
    render();
  } else if (action === 'filter-source') {
    ui.filters.source = element.value;
    render();
  } else if (action === 'filter-query-status') {
    ui.queryStatus = element.value;
    render();
  } else if (action === 'filter-query-claim') {
    ui.queryClaimFilter = element.value;
    render();
  } else if (action === 'change-top-k') {
    ui.topK = Number(element.value) || 12;
    render();
  } else if (action === 'set-evidence-datasets') {
    ui.evidenceWorkspace.datasetIds = [...element.selectedOptions].map((option) => option.value).filter(Boolean);
    render();
  } else if (action === 'select-evidence-query') {
    evidenceSelectQuery(element.value);
  } else if (action === 'select-evidence-fact') {
    ui.evidenceWorkspace.factId = fact(element.value) ? element.value : '';
    render();
  } else if (action === 'set-workspace-filter') {
    if (ui.busy) return;
    const workflow = ui.evidenceWorkspace.workflow;
    workflow.filter = element.value;
    const items = evidenceWorkspaceRows();
    const key = workflow.direction === 'evidence' ? 'evidence_id' : 'chunk_id';
    const currentId = workflow.direction === 'evidence' ? workflow.evidenceId : workflow.chunkId;
    selectWorkspaceItem(items.find((row) => row[key] === currentId)?.[key] || items[0]?.[key] || '');
  } else if (action === 'set-evidence-top-k') {
    ui.evidenceWorkspace.topK = Number(element.value) || 6;
    render();
  } else if (action === 'set-evidence-min-similarity') {
    ui.evidenceWorkspace.minSimilarity = Number(element.value) || 0;
    render();
  } else if (action === 'builder-set-assignment') {
    ui.builder.factLinks = applyAssignment(ui.builder.factLinks, element.dataset.id, element.value);
    render();
  } else if (action === 'set-query-fact-assignment' && ui.screen === 'workbench' && ui.queryReview) {
    ui.queryReview.factLinks = applyAssignment(ui.queryReview.factLinks, element.dataset.id, element.value);
    renderWithFocus();
  } else if (action === 'set-query-fact-status' && ui.screen === 'workbench' && ui.queryReview) {
    ui.queryReview.factStatuses = { ...ui.queryReview.factStatuses, [element.dataset.id]: element.value };
    renderWithFocus();
  }
}

async function dispatchClickAction(action, element) {
  if (action === 'navigate') {
    ui.modal = null;
    const explicitParams = navigationParams(element);
    const params = Object.keys(explicitParams).length ? explicitParams : currentNavigationParams();
    const screen = element.dataset.screen || 'workbench';
    if (screen === 'workbench' && !params.query) {
      params.query = ui.queryId;
      if (!factsOfQuery(ui.queryId).some((link) => link.fact_id === params.fact)) delete params.fact;
    }
    navigate(screen, params);
    if (ui.screen === 'evidence' && !ui.evidenceWorkspace.inventory) loadEvidenceInventory();
  } else if (action === 'retry-load') {
    await retryInitialLoad();
  } else if (action === 'prev-query' || action === 'next-query') {
    const nextId = nextQuery(ui.queryId, action === 'next-query' ? 1 : -1);
    if (nextId) moveToQuery(nextId);
  } else if (action === 'prev-fact' || action === 'next-fact') {
    moveToFact(nextFact(ui.factId, action === 'prev-fact' ? -1 : 1));
  } else if (action === 'select-query-id') {
    moveToQuery(element.dataset.id || '');
  } else if (action === 'preview-query-fact') {
    const factId = element.dataset.id || '';
    if (!fact(factId)) return;
    selectFact(factId);
    navigate('workbench', { ...currentNavigationParams(), query: ui.queryId, fact: factId, evidence: '' });
  } else if (action === 'open-query-fact-review') {
    if (!currentFact()) return;
    navigate('fact-review', { query: ui.queryId, fact: ui.factId, returnTo: 'workbench' });
  } else if (action === 'return-from-fact-review') {
    navigateFromReturnChain();
  } else if (action === 'open-fact-library') {
    const factId = element.dataset.id || '';
    if (!fact(factId)) return;
    setFactDraft(factId);
    const navigation = currentNavigationParams();
    const params = {
      query: ui.screen === 'workbench' ? ui.queryId : navigation.query,
      fact: factId,
      returnTo: extendReturnChain(navigation, ui.screen),
    };
    navigate('facts', params);
  } else if (action === 'select-fact') {
    const factId = element.dataset.id || '';
    if (!fact(factId)) return;
    selectFact(factId);
    navigate('workbench', { query: ui.queryId, fact: factId });
  } else if (action === 'switch-center') {
    ui.centerTab = element.dataset.tab === 'chunk' ? 'chunk' : 'evidence';
    render();
  } else if (action === 'clear-center-search') {
    ui.search = '';
    render();
  } else if (action === 'filter-evidence-status'
    || action === 'filter-document'
    || action === 'filter-topic'
    || action === 'filter-source'
    || action === 'filter-query-status'
    || action === 'change-top-k') {
    return;
  } else if (action === 'search-ragflow') {
    await searchRagflow();
  } else if (action === 'show-auto-match-candidates') {
    const navigation = currentNavigationParams();
    navigate('evidence', {
      query: navigation.query || ui.queryId,
      fact: navigation.fact,
      evidence: navigation.evidence,
      returnTo: navigation.returnTo || 'workbench',
    });
    if (!ui.evidenceWorkspace.inventory) loadEvidenceInventory();
  } else if (action === 'refresh-evidence-inventory') {
    await loadEvidenceInventory();
  } else if (action === 'run-evidence-auto-match') {
    await runEvidenceAutoMatch();
  } else if (action === 'search-evidence-keywords') {
    await searchEvidenceKeywords();
  } else if (action === 'set-evidence-mode') {
    setEvidenceMode(element.dataset.mode);
  } else if (action === 'set-workspace-direction') {
    if (ui.busy) return;
    const workflow = ui.evidenceWorkspace.workflow;
    const direction = element.dataset.direction === 'chunk' ? 'chunk' : 'evidence';
    if (workflow.direction !== direction) {
      resetWorkspaceSelection();
      workflow.direction = direction;
      workflow.search = '';
      workflow.filter = 'all';
    }
    render();
  } else if (action === 'select-workspace-item') {
    selectWorkspaceItem(element.dataset.id || '');
  } else if (action === 'prev-workspace-item' || action === 'next-workspace-item') {
    if (ui.busy) return;
    const workflow = ui.evidenceWorkspace.workflow;
    const key = workflow.direction === 'evidence' ? 'evidence_id' : 'chunk_id';
    const items = evidenceWorkspaceRows();
    const currentId = workflow.direction === 'evidence' ? workflow.evidenceId : workflow.chunkId;
    const index = items.findIndex((row) => row[key] === currentId);
    const next = items[index + (action === 'next-workspace-item' ? 1 : -1)];
    if (next) selectWorkspaceItem(next[key]);
  } else if (action === 'clear-workspace-search' || action === 'clear-workspace-evidence-target-search') {
    if (ui.busy) return;
    ui.evidenceWorkspace.workflow[action === 'clear-workspace-search' ? 'search' : 'evidenceTargetSearch'] = '';
    render();
  } else if (action === 'toggle-workspace-retrieval') {
    ui.evidenceWorkspace.retrievalOpen = !ui.evidenceWorkspace.retrievalOpen;
    render();
  } else if (action === 'unlink-workspace-chunk') {
    await unlinkWorkspaceChunk(element.dataset.evidence, element.dataset.chunk);
  } else if (action === 'bind-workspace-chunk') {
    const workflow = ui.evidenceWorkspace.workflow;
    const chunk = localChunk(workflow.chunkId) || findEvidenceCandidate(workflow.chunkId);
    if (workflow.direction === 'chunk' && chunk) await linkSelectedChunksToEvidence(workflow.targetEvidenceId, [chunk]);
  } else if (action === 'create-evidence-from-workspace-chunk') {
    const workflow = ui.evidenceWorkspace.workflow;
    const chunk = localChunk(workflow.chunkId) || findEvidenceCandidate(workflow.chunkId);
    if (workflow.direction === 'chunk' && chunk) openEvidenceCreateDraft([chunk], { origin: 'workspace' });
  } else if (action === 'link-selected-evidence-chunks') {
    const workflow = ui.evidenceWorkspace.workflow;
    if (workflow.direction === 'evidence') await linkSelectedChunksToEvidence(workflow.evidenceId);
  } else if (action === 'toggle-evidence-candidate') {
    toggleEvidenceCandidate(element.dataset.id || '');
  } else if (action === 'clear-evidence-auto-selection') {
    clearEvidenceCandidates();
  } else if (action === 'preview-evidence-candidate') {
    const candidate = localChunk(element.dataset.id) || findEvidenceCandidate(element.dataset.id);
    if (!candidate) return;
    ui.evidenceWorkspace.expandedChunkId = ui.evidenceWorkspace.expandedChunkId === candidate.chunk_id
      ? ''
      : candidate.chunk_id;
    render();
  } else if (action === 'create-evidence-draft') {
    openEvidenceCreateDraft();
  } else if (action === 'polish-evidence-draft') {
    await polishEvidenceCreateDraft();
  } else if (action === 'insert-evidence-source') {
    insertEvidenceSource(element.dataset.id || '');
  } else if (action === 'remove-evidence-source') {
    removeEvidenceDraftSource(element.dataset.id || '');
  } else if (action === 'save-evidence-draft') {
    await saveEvidenceCreateDraft();
  } else if (action === 'continue-evidence-draft') {
    if (ui.modal?.type === 'evidence-create') {
      ui.modal.stage = 'editing';
      renderModal();
    }
  } else if (action === 'discard-evidence-draft') {
    if (ui.modal?.type === 'evidence-create') {
      ui.modal = null;
      renderModal();
      render();
    }
  } else if (action === 'send-auto-match-to-workbench') {
    sendCandidatesToFactReview();
  } else if (action === 'show-local-chunks') {
    ui.remoteChunks = [];
    ui.remoteSearchTerm = '';
    ui.remoteMeta = null;
    ui.selectedChunkIds = new Set([...ui.selectedChunkIds].filter((id) => localChunk(id)));
    if (ui.previewChunkId && !localChunk(ui.previewChunkId)) {
      ui.previewChunkId = ui.editorDraft?.chunkIds?.map(localChunk).find(Boolean)?.chunk_id || '';
    }
    render();
  } else if (action === 'toggle-evidence') {
    const evidenceId = element.dataset.id || '';
    if (!evidence(evidenceId)) return;
    if (ui.selectedEvidenceIds.has(evidenceId)) ui.selectedEvidenceIds.delete(evidenceId);
    else ui.selectedEvidenceIds.add(evidenceId);
    render();
  } else if (action === 'clear-evidence-selection') {
    ui.selectedEvidenceIds.clear();
    render();
  } else if (action === 'remove-selected-evidence') {
    ui.selectedEvidenceIds.delete(element.dataset.id || '');
    render();
  } else if (action === 'toggle-chunk') {
    const chunkId = element.dataset.id || '';
    if (!findChunk(chunkId)) return;
    if (ui.selectedChunkIds.has(chunkId)) ui.selectedChunkIds.delete(chunkId);
    else ui.selectedChunkIds.add(chunkId);
    ui.previewChunkId = chunkId;
    render();
  } else if (action === 'clear-chunk-selection') {
    ui.selectedChunkIds.clear();
    render();
  } else if (action === 'preview-chunk') {
    const chunkId = element.dataset.id || '';
    if (findChunk(chunkId)) {
      ui.previewChunkId = chunkId;
      render();
    }
  } else if (action === 'set-chunk-unavailable') {
    await setRagflowChunkAvailability(element.dataset.id || '', false);
  } else if (action === 'set-chunk-available') {
    await setRagflowChunkAvailability(element.dataset.id || '', true);
  } else if (action === 'preview-evidence') {
    const evidenceId = element.dataset.id || '';
    if (ui.screen !== 'workbench' && ui.screen !== 'fact-review') openEvidenceInFactReview(evidenceId);
    else if (evidence(evidenceId)) {
      loadEvidenceDraft(evidenceId);
      render();
    }
  } else if (action === 'draft-from-chunks') {
    if (!fact(ui.factId)) {
      toast('请先选择 Fact', 'error');
      return;
    }
    const chunks = [...ui.selectedChunkIds].map(findChunk).filter(Boolean);
    if (!chunks.length) {
      toast('请先选择至少一个 Chunk', 'info');
      return;
    }
    if (ui.editorDraft?.mode === 'edit') {
      ui.editorDraft.chunkIds = unique([...ui.editorDraft.chunkIds, ...chunks.map((chunk) => chunk.chunk_id)]);
      ui.previewChunkId = chunks[0].chunk_id;
    } else {
      createEvidenceDraft(chunks, ui.factId);
    }
    ui.selectedChunkIds.clear();
    render();
  } else if (action === 'remove-draft-chunk') {
    if (!ui.editorDraft) return;
    const chunkId = element.dataset.id || '';
    ui.editorDraft.chunkIds = ui.editorDraft.chunkIds.filter((id) => id !== chunkId);
    if (ui.previewChunkId === chunkId) ui.previewChunkId = ui.editorDraft.chunkIds[0] || '';
    render();
  } else if (action === 'save-evidence') {
    await saveEvidence();
  } else if (action === 'delete-evidence') {
    const evidenceId = element.dataset.id || '';
    openDeleteConfirmation(
      'evidences',
      evidenceId,
      `${evidenceId} · ${evidence(evidenceId)?.title || 'Evidence'}`,
      '删除后，该 Evidence 会从所有 Fact 关联中移除，对应 Chunk 本身仍保留。',
    );
  } else if (action === 'link-selected-evidence') {
    await linkSelectedEvidence();
  } else if (action === 'unlink-fact-evidence') {
    await unlinkFactEvidence(element.dataset.id || '');
  } else if (action === 'set-relation') {
    const operator = element.dataset.operator === 'AND' ? 'AND' : 'OR';
    ui.relationOperator = operator;
    if (fact(ui.factId)) {
      await runMutation(
        () => api.linkFactEvidence(ui.factId, evidenceIdsOfFact(ui.factId), operator),
        { success: `Evidence 关系已设为 ${operator}` },
      );
    } else {
      render();
    }
  } else if (action === 'save-association-next') {
    await saveAssociationAndAdvance();
  } else if (action === 'approve-query') {
    await approveQuery(element.dataset.id || ui.queryId, element.dataset.advance === 'true');
  } else if (action === 'run-recall') {
    if (ui.screen === 'workbench' && !await saveQueryFacts({ success: '' })) return;
    await runRecall(element.dataset.id || ui.queryId);
  } else if (action === 'select-recall-fact' && ui.modal?.type === 'recall') {
    const factId = element.dataset.id || '';
    if ((ui.modal.report?.facts || []).some((fact) => fact.fact_id === factId)) {
      ui.modal.selectedFactId = factId;
      renderModal();
    }
  } else if (action === 'open-query') {
    moveToQuery(element.dataset.id || '');
  } else if (action === 'open-query-facts') {
    openQueryFacts(ui.queryId);
  } else if (action === 'edit-query') {
    openQueryEditor(element.dataset.id || ui.queryId);
  } else if (action === 'delete-query') {
    const queryId = element.dataset.id || '';
    openDeleteConfirmation(
      'queries',
      queryId,
      `${queryId} · ${compactExcerpt(query(queryId)?.text || '', 36)}`,
      '删除主问时，所属变体不会自动删除，但会失去父级关系，请另行复核。',
    );
  } else if (action === 'save-query-edit') {
    await saveQueryEdit();
  } else if (action === 'save-query-facts') {
    await saveQueryFacts();
  } else if (action === 'save-query-facts-next') {
    await saveQueryFacts({ advance: true });
  } else if (action === 'filter-query-facts' && ui.screen === 'workbench' && ui.queryReview) {
    ui.queryReview.factFilter = element.dataset.filter === 'selected' ? 'selected' : 'all';
    syncQueryFactsPanel(view, ui.queryReview);
  } else if (action === 'clear-query-facts-search' && ui.screen === 'workbench' && ui.queryReview) {
    ui.queryReview.factFilterText = '';
    syncQueryFactsPanel(view, ui.queryReview);
    view.querySelector('[data-bind="query-facts-search"]')?.focus();
  } else if (action === 'clear-builder-fact-search') {
    ui.builder.factSearch = '';
    renderWithFocus();
  } else if (action === 'clear-builder-candidate-search') {
    ui.builder.candidateSearch = '';
    renderWithFocus();
  } else if (action === 'clear-evidence-candidate-search') {
    ui.evidenceWorkspace.workflow.candidateSearch = '';
    renderWithFocus();
  } else if (action === 'clear-overview-search') {
    ui.overviewSearch = '';
    renderWithFocus();
  } else if (action === 'toggle-query-fact' && ui.screen === 'workbench' && ui.queryReview) {
    const factId = element.dataset.id || '';
    if (ui.queryReview.factLinks.some((link) => link.fact_id === factId)) {
      ui.queryReview.factLinks = ui.queryReview.factLinks.filter((link) => link.fact_id !== factId);
    } else if (fact(factId)) {
      ui.queryReview.factLinks = [...ui.queryReview.factLinks, { fact_id: factId, requirement: 'required', group_id: '' }];
    }
    renderWithFocus();
  } else if (action === 'clear-query-search') {
    ui.querySearch = '';
    ui.queryStatus = '';
    render();
  } else if (action === 'new-fact') {
    setFactDraft('');
    const navigation = currentNavigationParams();
    navigate('facts', {
      query: navigation.query,
      returnTo: navigation.returnTo || 'workbench',
    });
  } else if (action === 'select-fact-draft') {
    const factId = element.dataset.id || '';
    if (!fact(factId)) return;
    setFactDraft(factId);
    const navigation = currentNavigationParams();
    navigate('facts', {
      query: navigation.query,
      fact: factId,
      returnTo: navigation.returnTo || 'workbench',
    });
  } else if (action === 'save-fact') {
    await saveFact();
  } else if (action === 'delete-fact') {
    const factId = element.dataset.id || '';
    openDeleteConfirmation(
      'facts',
      factId,
      `${factId} · ${compactExcerpt(fact(factId)?.statement || '', 36)}`,
      '删除后，该 Fact 会从 Query 依赖中移除，相关 Evidence 本身仍会保留。',
    );
  } else if (action === 'open-fact-workbench') {
    ui.centerTab = 'evidence';
    openFactWorkbench(element.dataset.id || '');
  } else if (action === 'return-from-facts') {
    navigateFromReturnChain();
  } else if (action === 'return-from-evidence') {
    navigateFromReturnChain();
  } else if (action === 'open-fact-evidence') {
    const evidenceId = element.dataset.id || '';
    if (!evidence(evidenceId)) return;
    const params = currentNavigationParams();
    openFactWorkbench(ui.factDraft?.fact_id || params.fact || ui.factId, evidenceId);
  } else if (action === 'open-fact-evidence-review') {
    const factId = element.dataset.id || '';
    ui.centerTab = 'chunk';
    openFactWorkbench(factId);
  } else if (action === 'clear-fact-search') {
    ui.factSearch = '';
    render();
  } else if (action === 'builder-toggle-fact') {
    toggleBuilderFact(element.dataset.id || '');
    render();
  } else if (action === 'builder-set-assignment') {
    return;
  } else if (action === 'toggle-candidate') {
    const candidate = ui.builder.candidates.find((item) => item.id === element.dataset.id);
    if (!candidate) return;
    candidate.selected = !candidate.selected;
    render();
  } else if (action === 'generate-queries') {
    await generateBuilderCandidates();
  } else if (action === 'submit-builder') {
    await submitBuilder();
  } else if (action === 'reset-builder') {
    ui.builder = emptyBuilder();
    render();
  } else if (action === 'show-config') {
    setModal({ type: 'config' });
  } else if (action === 'show-reviewer-name') {
    promptReviewerName('');
  } else if (action === 'save-reviewer-name') {
    const name = text(ui.modal?.value);
    if (!name) {
      ui.modal.error = '显示名不能为空。';
      renderModal();
      return;
    }
    setReviewerName(name);
    ui.modal = null;
    renderModal();
    render();
    toast(`显示名已设为 ${name}`, 'success');
  } else if (action === 'claim-query') {
    await claimQueryFromList(element.dataset.id || '');
  } else if (action === 'release-query-claim') {
    await releaseQueryClaimFromList(element.dataset.id || '');
  } else if (action === 'renew-query-claim') {
    await renewQueryClaimFromList(element.dataset.id || '');
  } else if (action === 'show-help') {
    setModal({ type: 'help' });
  } else if (action === 'close-modal') {
    closeModal();
  } else if (action === 'confirm-delete') {
    await confirmDelete();
  } else if (action === 'dismiss-toast') {
    dismissToast(Number(element.dataset.id));
  } else {
    toast(`未识别的操作：${action}`, 'error');
  }
}

async function handleClick(event) {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  if (element.tagName === 'SELECT') return;
  const action = element.dataset.action;
  if (action === 'close-modal'
    && element.classList.contains('modal-backdrop')
    && event.target !== element) {
    return;
  }
  if (action === 'set-chunk-available' || action === 'set-chunk-unavailable') event.stopPropagation();
  if (action === 'claim-query' || action === 'release-query-claim' || action === 'renew-query-claim') event.stopPropagation();
  if (element.tagName === 'A') event.preventDefault();
  try {
    await dispatchClickAction(action, element);
  } catch (error) {
    toast(apiErrorText(error), 'error');
  }
}

async function retryInitialLoad() {
  ui.loading = true;
  ui.loadError = '';
  render();
  try {
    const state = await api.getState();
    applyServerState(state);
    ui.loading = false;
    applyRoute();
  } catch (error) {
    ui.loading = false;
    ui.loadError = apiErrorText(error);
    render();
  }
}

document.addEventListener('click', handleClick);
document.addEventListener('input', handleInput);
document.addEventListener('compositionend', handleCompositionEnd);
document.addEventListener('change', handleChange);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ui.modal) closeModal();
});
window.addEventListener('hashchange', () => {
  if (ui.data) applyRoute();
});

retryInitialLoad();
