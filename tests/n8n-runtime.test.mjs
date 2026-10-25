import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const snippets = JSON.parse(await readFile(new URL('../n8n/runtime-snippets.json', import.meta.url), 'utf8'));
const config = { owner: 'slvdrvncntjvr', repository: 'patchguard', ref: 'main', triggerSource: 'manual', dryRun: true, dispatchEnabled: false, authSetupApproved: false, testsApproved: false, serializedExecutionApproved: false, telegramEnabled: false, telegramChatId: '123' };
const approved = { ...config, triggerSource: 'schedule', dryRun: false, dispatchEnabled: true, authSetupApproved: true, testsApproved: true, serializedExecutionApproved: true };
const alert = { number: 1, state: 'open', dependency: { package: { ecosystem: 'npm', name: 'lodash' }, relationship: 'direct', manifest_path: 'package-lock.json' }, security_advisory: { ghsa_id: 'GHSA-35jh-r3h4-6jhm', cve_id: 'CVE-2021-23337' }, security_vulnerability: { package: { ecosystem: 'npm', name: 'lodash' }, severity: 'high', first_patched_version: { identifier: '4.17.21' } } };
function execute(name, data, lookup = {}, state = {}) {
  const items = (Array.isArray(data) ? data : [data]).map(json => ({ json }));
  const sandbox = { $input: { first: () => items[0], all: () => items }, $getWorkflowStaticData: () => state, $execution: { id: 'isolated-unit-test' }, $: node => ({ all: () => { if (!(node in lookup)) throw Error('Not executed'); return (Array.isArray(lookup[node]) ? lookup[node] : [lookup[node]]).map(json => ({ json })); }, first: () => ({ json: lookup[node] }) }) };
  return vm.runInNewContext('(function(){' + snippets[name] + '\n})()', sandbox, { timeout: 1000 });
}
function fixture() {
  return {
    'Validate Configuration': { config },
    'GitHub — Open Repository Dependabot Alerts': { statusCode: 200, headers: {}, body: [structuredClone(alert)] },
    'CISA — Known Exploited Vulnerabilities': { statusCode: 200, body: { count: 1, dateReleased: new Date().toISOString(), vulnerabilities: [{ cveID: 'CVE-2021-23337' }] } },
    'GitHub — Root package.json': { statusCode: 200, body: { dependencies: { next: '16.0.0', lodash: '4.17.20' } } },
    'GitHub — Root package-lock.json': { statusCode: 200, body: { lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.20' } } } },
    'GitHub — Existing PATCHGUARD Runs': { statusCode: 200, headers: {}, body: { total_count: 0, workflow_runs: [] } },
  };
}
function findings(change) {
  const f = fixture(); if (change) change(f);
  return execute('triage', execute('verify', {}, f)[0].json)[0].json;
}

test('direct exact same-major KEV fix is eligible and prioritized', () => {
  const item = findings().findings[0]; assert.equal(item.patchEligible, true); assert.equal(item.knownExploited, true); assert.equal(item.priority, 130);
});
for (const statusCode of [401, 403, 404, 429, 500]) {
  test('Dependabot HTTP ' + statusCode + ' reports UNKNOWN, never a successful empty scan', () => {
    const data = findings(f => { f['GitHub — Open Repository Dependabot Alerts'] = { statusCode, body: { message: 'API failure' } }; });
    const event = execute('dedup', data)[0].json; assert.equal(event.event, 'scan_incomplete'); assert.equal(event.githubAlertCount, null); assert.equal(event.dispatchReady, false);
  });
}
test('pagination cap and malformed JSON block patch eligibility', () => {
  for (const change of [f => { f['GitHub — Open Repository Dependabot Alerts'].headers.link = '<https://api.github.com/next>; rel="next"'; }, f => { f['GitHub — Open Repository Dependabot Alerts'].body = 'not json'; }]) {
    const data = findings(change); assert.equal(execute('dedup', data)[0].json.event, 'scan_incomplete');
  }
});
test('stale, malformed and null CISA entries yield review outcomes without crashing', () => {
  for (const change of [k => { k.dateReleased = '2000-01-01'; }, k => { k.vulnerabilities = {}; }, k => { k.vulnerabilities = [null]; }]) {
    const data = findings(f => change(f['CISA — Known Exploited Vulnerabilities'].body));
    assert.equal(data.findings[0].patchEligible, false); assert.equal(execute('dedup', data)[0].json.event, 'scan_incomplete');
  }
});
test('missing workflow and malformed run history block dispatch', () => {
  for (const value of [{ statusCode: 404, body: {} }, { statusCode: 200, body: { total_count: 1, workflow_runs: [null] } }, { statusCode: 200, body: { total_count: 1001, workflow_runs: [] } }]) {
    const data = findings(f => { f['GitHub — Existing PATCHGUARD Runs'] = value; }); assert.equal(data.findings[0].patchEligible, false);
  }
});
test('transitive, no-fix, major upgrade and nested manifest findings require review', () => {
  for (const change of [a => { a.dependency.relationship = 'indirect'; }, a => { a.security_vulnerability.first_patched_version = null; }, a => { a.security_vulnerability.first_patched_version.identifier = '5.0.0'; }, a => { a.dependency.manifest_path = 'apps/web/package-lock.json'; }]) {
    assert.equal(findings(f => change(f['GitHub — Open Repository Dependabot Alerts'].body[0])).findings[0].patchEligible, false);
  }
});
test('manual preview never reserves or dispatches even when other approvals are true', () => {
  const data = findings(), state = {}; data.config = { ...approved, triggerSource: 'manual' };
  assert.equal(execute('dedup', data, {}, state)[0].json.dispatchReady, false); assert.equal(Object.keys(state).length, 0);
});
for (const gate of ['dispatchEnabled', 'authSetupApproved', 'testsApproved', 'serializedExecutionApproved']) {
  test('missing ' + gate + ' independently blocks dispatch', () => {
    const data = findings(); data.config = { ...approved, [gate]: false }; assert.equal(execute('dedup', data)[0].json.dispatchReady, false);
  });
}
test('approved schedule reserves one patch and suppresses an attempted target', () => {
  const data = findings(), state = {}; data.config = approved;
  assert.equal(execute('dedup', data, {}, state)[0].json.dispatchReady, true);
  assert.equal(execute('dedup', data, {}, state)[0].json.event, 'duplicate_suppressed');
});
test('GitHub run-title history suppresses repeated requests', () => {
  const data = findings(); data.config = approved; data.runs = [{ display_title: data.findings[0].runName, html_url: 'https://github.com/example/run' }];
  assert.equal(execute('dedup', data)[0].json.event, 'duplicate_suppressed');
});
test('dispatch is capped at one per scan', () => {
  const data = findings(); data.config = approved;
  data.findings.push({ ...data.findings[0], package: 'other', dedupeKey: 'other-target' });
  const events = execute('dedup', data).map(i => i.json); assert.equal(events.filter(e => e.dispatchReady).length, 1); assert.equal(events[1].event, 'patch_deferred');
});
test('only a fully verified empty scan reports no open npm alerts', () => {
  const data = findings(f => { f['GitHub — Open Repository Dependabot Alerts'].body = []; }); assert.equal(execute('dedup', data)[0].json.event, 'verified_no_open_npm_alerts');
});
for (const statusCode of [200, 204, 500]) {
  test('dispatch status ' + statusCode + ' is recorded without reporting remediation success', () => {
    const data = findings(), state = {}; data.config = approved;
    const reserved = execute('dedup', data, {}, state)[0].json;
    const result = execute('outcome', { statusCode, body: {} }, { 'Select Unique Patches — Approval Required': reserved }, state)[0].json;
    assert.equal(result.event, statusCode < 300 ? 'patch_attempt_accepted' : 'patch_attempt_failed_or_uncertain'); assert.equal(result.dispatchReady, false);
  });
}
test('Telegram escapes HTML and caps visible text before escaping', () => {
  const result = execute('compose', { config, event: '<b>untrusted</b>', reasons: Array(30).fill('&'.repeat(500)) })[0].json;
  assert.ok(result.telegramText.includes('&lt;b&gt;')); assert.ok(!result.telegramText.includes('<b>'));
  assert.ok(result.telegramText.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').length <= 3500);
});
test('malformed repository config fails before API calls', () => assert.equal(execute('config', { ...config, repository: '../other' })[0].json.configReady, false));
