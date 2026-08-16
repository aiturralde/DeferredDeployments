// Single source of truth for the deployment-request issue body shape and the weekend rule.
'use strict';

const TZ = 'Europe/Madrid';
const NO_RESPONSE = '_No response_';

// Field id -> the `label` used in the issue form, which GitHub renders as a `### ` heading.
const FIELDS = {
  pr: 'Pull Request number',
  deploy_date: 'Deployment date (YYYY-MM-DD)',
  summary: 'What is being deployed?',
  risk: 'Risk level',
  rollback: 'Rollback plan',
};

const MERGE_SHA_MARKER = '<!-- deployment-request:merge-sha -->';
const RUN_MARKER = '<!-- deployment-request:run -->';

function renderRunRecord(date, runId, runUrl) {
  return `${RUN_MARKER}\nDeployment dispatched for \`${date}\` — run-id: \`${runId}\` ([view](${runUrl}))`;
}

function parseRunRecord(body) {
  const text = String(body || '');
  const date = text.match(/dispatched for `(\d{4}-\d{2}-\d{2})`/);
  const runId = text.match(/run-id: `(\d+)`/);
  return { date: date ? date[1] : null, runId: runId ? Number(runId[1]) : null };
}

function parseIssue(body) {
  const headingToKey = new Map(Object.entries(FIELDS).map(([key, label]) => [label.toLowerCase(), key]));
  const values = {};
  let currentKey = null;
  let buffer = [];

  const flush = () => {
    if (!currentKey) return;
    const text = buffer.join('\n').trim();
    values[currentKey] = text === NO_RESPONSE ? '' : text;
  };

  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.*)$/);
    if (heading) {
      flush();
      currentKey = headingToKey.get(heading[1].trim().toLowerCase()) || null;
      buffer = [];
      continue;
    }
    if (currentKey) buffer.push(line);
  }
  flush();

  for (const key of Object.keys(FIELDS)) {
    if (!(key in values)) values[key] = '';
  }
  return values;
}

function renderBody(values = {}) {
  return Object.entries(FIELDS)
    .map(([key, label]) => `### ${label}\n\n${values[key] ? String(values[key]).trim() : NO_RESPONSE}`)
    .join('\n\n');
}

function todayInTz(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

function classify(dateStr, today = todayInTz()) {
  const value = String(dateStr || '').trim();

  if (!value) return { valid: false, error: 'No deployment date was provided.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { valid: false, error: `\`${value}\` is not a valid date. Use the \`YYYY-MM-DD\` format, e.g. \`${today}\`.` };
  }

  // Noon UTC keeps the calendar day stable for any positive-offset zone.
  const instant = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    return { valid: false, error: `\`${value}\` is not a real calendar date.` };
  }
  if (value < today) {
    return { valid: false, error: `\`${value}\` is in the past (today is \`${today}\` in ${TZ}).` };
  }

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(instant);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  return {
    valid: true,
    date: value,
    weekday,
    isWeekend,
    environment: isWeekend ? 'production-weekend' : 'production',
    label: isWeekend ? 'deploy-weekend' : 'deploy-weekday',
  };
}

function validateRequest(body, today = todayInTz()) {
  const values = parseIssue(body);
  const errors = [];

  const date = classify(values.deploy_date, today);
  if (!date.valid) errors.push(date.error);
  if (!values.summary) errors.push('The **What is being deployed?** section is empty.');
  if (!values.rollback) errors.push('The **Rollback plan** section is empty.');

  const pr = Number.parseInt(String(values.pr).replace(/^#/, ''), 10);
  if (!Number.isInteger(pr) || pr <= 0) errors.push('The **Pull Request number** section is missing or not a number.');

  return { values, date, pr: Number.isInteger(pr) && pr > 0 ? pr : null, errors, valid: errors.length === 0 };
}

module.exports = {
  FIELDS,
  TZ,
  MERGE_SHA_MARKER,
  RUN_MARKER,
  renderRunRecord,
  parseRunRecord,
  parseIssue,
  renderBody,
  todayInTz,
  classify,
  validateRequest,
};
