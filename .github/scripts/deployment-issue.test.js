'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('./deployment-issue.js');

const TODAY = '2026-08-15';

test('classify routes weekend dates to the gated environment', () => {
  const result = lib.classify('2026-08-15', TODAY);
  assert.equal(result.valid, true);
  assert.equal(result.isWeekend, true);
  assert.equal(result.environment, 'production-weekend');
  assert.equal(result.label, 'deploy-weekend');
});

test('classify routes weekday dates to the ungated environment', () => {
  const result = lib.classify('2026-08-17', TODAY);
  assert.equal(result.valid, true);
  assert.equal(result.isWeekend, false);
  assert.equal(result.environment, 'production');
});

test('classify rejects past, malformed and impossible dates', () => {
  assert.equal(lib.classify('2020-01-01', TODAY).valid, false);
  assert.equal(lib.classify('15/08/2026', TODAY).valid, false);
  assert.equal(lib.classify('2026-02-31', TODAY).valid, false);
  assert.equal(lib.classify('', TODAY).valid, false);
});

test('parseIssue round-trips renderBody and treats _No response_ as empty', () => {
  const body = lib.renderBody({ pr: '123', deploy_date: '2026-08-17', summary: 'API v2', risk: 'low' });
  const values = lib.parseIssue(body);
  assert.equal(values.pr, '123');
  assert.equal(values.deploy_date, '2026-08-17');
  assert.equal(values.summary, 'API v2');
  assert.equal(values.rollback, '');
});

test('parseIssue ignores preamble before the first field heading', () => {
  const body = `Tracking https://github.com/o/r/pull/7\n\n${lib.renderBody({ pr: '7' })}`;
  assert.equal(lib.parseIssue(body).pr, '7');
});

test('validateRequest reports every missing section at once', () => {
  const result = lib.validateRequest(lib.renderBody({}), TODAY);
  assert.equal(result.valid, false);
  assert.equal(result.pr, null);
  assert.equal(result.errors.length, 4);
});

test('validateRequest accepts a fully populated request', () => {
  const body = lib.renderBody({
    pr: '#123',
    deploy_date: '2026-08-16',
    summary: 'Ship the payments migration.',
    risk: 'medium',
    rollback: 'Revert the migration and redeploy the previous tag.',
  });
  const result = lib.validateRequest(body, TODAY);
  assert.equal(result.valid, true);
  assert.equal(result.pr, 123);
  assert.equal(result.date.environment, 'production-weekend');
});

test('run records round-trip the dispatched date and run id', () => {
  const body = lib.renderRunRecord('2026-08-17', 12345, 'https://example.test/run');
  assert.ok(body.includes(lib.RUN_MARKER));
  const parsed = lib.parseRunRecord(body);
  assert.equal(parsed.date, '2026-08-17');
  assert.equal(parsed.runId, 12345);
});

test('parseRunRecord returns nulls for unrelated comments', () => {
  const parsed = lib.parseRunRecord('Deployed abc123 to production.');
  assert.equal(parsed.date, null);
  assert.equal(parsed.runId, null);
});
