const TARGET_OWNER = 'tornado404';
const TARGET_NAME = 'rag-eval-dataset';
const TARGET_HOST = 'github.com';
const TARGET_PATH_PREFIX = `/${TARGET_OWNER}/${TARGET_NAME}`;
const APPROVED_LABEL = 'ai-approved';
const MAX_BODY_BYTES = 256 * 1024;

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseAllowlist(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: `${name} is not configured` };
  }

  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  if (ids.length === 0 || ids.some((entry) => !/^\d+$/.test(entry))) {
    return { ok: false, reason: `${name} is not configured` };
  }

  const numericIds = ids.map(Number);
  if (numericIds.some((id) => !isPositiveInteger(id))) {
    return { ok: false, reason: `${name} is not configured` };
  }

  return { ok: true, ids: new Set(numericIds) };
}

function matchesTargetUrl(value) {
  if (typeof value !== 'string' || value === '') {
    return false;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.host !== TARGET_HOST) {
    return false;
  }

  return (
    url.pathname === TARGET_PATH_PREFIX ||
    url.pathname.startsWith(`${TARGET_PATH_PREFIX}/`)
  );
}

export function evaluateIssueEvent(event, config = {}) {
  const reject = (reason) => ({ matched: false, reason });

  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return reject('invalid event data');
  }

  const repo = event.repository;
  if (repo === null || typeof repo !== 'object' || Array.isArray(repo)) {
    return reject('repository metadata is invalid');
  }

  if (repo.full_name !== `${TARGET_OWNER}/${TARGET_NAME}`) {
    return reject('repository is not the target repository');
  }
  if (!isPositiveInteger(repo.id)) {
    return reject('repository id is invalid');
  }

  const issue = event.issue;
  if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
    return reject('issue metadata is invalid');
  }

  if (Object.prototype.hasOwnProperty.call(event, 'pull_request')) {
    return reject('pull request events are not accepted');
  }
  if (issue.state !== 'open') {
    return reject('issue is not open');
  }
  if (!isPositiveInteger(issue.id)) {
    return reject('issue id is invalid');
  }
  if (!isPositiveInteger(issue.number)) {
    return reject('issue number is invalid');
  }
  if (!matchesTargetUrl(issue.html_url)) {
    return reject('issue URL is invalid');
  }

  const author = issue.user;
  if (author === null || typeof author !== 'object' || Array.isArray(author)) {
    return reject('issue author is invalid');
  }
  if (!isPositiveInteger(author.id)) {
    return reject('issue author id is invalid');
  }

  const authorIds = parseAllowlist(config.authorIds, 'AI_AUTHOR_IDS');
  if (!authorIds.ok) {
    return reject(authorIds.reason);
  }
  const approverIds = parseAllowlist(config.approverIds, 'AI_APPROVER_IDS');
  if (!approverIds.ok) {
    return reject(approverIds.reason);
  }

  const action = event.action;
  let authorization;

  if (action === 'opened') {
    if (!authorIds.ids.has(author.id)) {
      return reject('issue author is not in the allowlist');
    }
    authorization = { kind: 'author', actor_id: author.id };
  } else if (action === 'labeled') {
    const label = event.label;
    if (label === null || typeof label !== 'object' || Array.isArray(label)) {
      return reject('label metadata is invalid');
    }
    if (label.name !== APPROVED_LABEL) {
      return reject('label is not ai-approved');
    }

    const sender = event.sender;
    if (sender === null || typeof sender !== 'object' || Array.isArray(sender)) {
      return reject('sender metadata is invalid');
    }
    if (!isPositiveInteger(sender.id)) {
      return reject('sender id is invalid');
    }
    if (!approverIds.ids.has(sender.id)) {
      return reject('label actor is not in the approver allowlist');
    }
    authorization = { kind: 'label', actor_id: sender.id, label: APPROVED_LABEL };
  } else {
    return reject('issue action is not supported');
  }

  return {
    matched: true,
    decision: {
      event: 'github.issue.intake',
      action,
      repository: {
        name: repo.full_name,
        id: repo.id,
      },
      github_issue_number: issue.number,
      github_issue_id: issue.id,
      github_issue_url: issue.html_url,
      author_id: author.id,
      authorization,
    },
  };
}

export function maximumEventBodyBytes() {
  return MAX_BODY_BYTES;
}
