import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProjectOverview, healthPayload } from '../lib/project-overview.mjs';
import { validateLock, validateProject } from '../.github/scripts/patchguard.mjs';

const snapshot = JSON.parse(await readFile(new URL('../n8n/saved-workflow.json', import.meta.url), 'utf8'));

test('app exposes configured repository without claiming a verified live scan', () => {
  const overview = buildProjectOverview(snapshot);
  assert.equal(overview.repository, 'slvdrvncntjvr/patchguard');
  assert.equal(overview.githubConfigured, true);
  assert.equal(overview.monitoringEnabled, false);
  assert.equal(overview.dispatchApproved, false);
  assert.equal(overview.scanStatus, 'not-verified');
  assert.equal(overview.vulnerabilityCount, null);
});

test('public overview never exposes credential IDs, tokens or Telegram chat IDs', () => {
  const copy = structuredClone(snapshot);
  copy.nodes.push({ credentials: { telegramApi: { id: 'private-telegram-credential', accessToken: 'private-token' } } });
  const result = JSON.stringify(buildProjectOverview(copy));
  assert.ok(!result.includes('private-token'));
  assert.ok(!result.includes('private-telegram-credential'));
  assert.ok(!result.includes('8sZghTGcyURX3CMo'));
  assert.ok(!result.includes('telegramChatId'));
});

test('app rejects a different workflow or injected repository path', () => {
  assert.throws(() => buildProjectOverview({ ...snapshot, id: 'different-workflow' }), /invalid/);
  const copy = structuredClone(snapshot);
  copy.nodes.find(n => n.name === 'Configuration — Repository and Safety Gates').parameters.assignments.assignments.find(a => a.name === 'repository').value = '../other';
  assert.throws(() => buildProjectOverview(copy), /repository/);
});

test('missing GitHub credentials are visible as incomplete setup', () => {
  const copy = structuredClone(snapshot);
  delete copy.nodes.find(n => n.parameters?.nodeCredentialType === 'githubApi').credentials;
  assert.equal(buildProjectOverview(copy).githubConfigured, false);
});

test('Telegram needs both a saved credential and valid chat ID', () => {
  const copy = structuredClone(snapshot);
  copy.nodes.find(n => n.type === 'n8n-nodes-base.telegram').credentials = { telegramApi: { id: 'synthetic-test-id' } };
  assert.equal(buildProjectOverview(copy).telegramConfigured, false);
  const settings = copy.nodes.find(n => n.name === 'Configuration — Repository and Safety Gates').parameters.assignments.assignments;
  settings.find(a => a.name === 'telegramChatId').value = '-100123456789';
  assert.equal(buildProjectOverview(copy).telegramConfigured, true);
  assert.equal(buildProjectOverview(copy).telegramEnabled, false);
});

test('a single approval flag never makes dispatch appear approved', () => {
  const copy = structuredClone(snapshot);
  copy.nodes.find(n => n.name === 'Configuration — Repository and Safety Gates').parameters.assignments.assignments.find(a => a.name === 'dispatchEnabled').value = true;
  assert.equal(buildProjectOverview(copy).dispatchApproved, false);
});

test('health means app availability and never claims monitoring success', () => {
  assert.equal(healthPayload().status, 'ok');
  assert.equal(healthPayload().monitoring, 'not-verified');
  assert.equal(Object.hasOwn(healthPayload(), 'vulnerabilities'), false);
});

test('the real app lockfile satisfies PATCHGUARD public-registry and direct-dependency policy', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateLock(lock));
  const [major, minor, patch] = lock.packages['node_modules/next'].version.split('.').map(Number);
  assert.equal(validateProject(manifest, lock, { package: 'next', fixed_version: `${major}.${minor}.${patch + 1}`, advisory_id: 'GHSA-35jh-r3h4-6jhm' }), 'dependencies');
});
