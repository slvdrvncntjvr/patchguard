import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org/';
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateInputs(input) {
  requireCondition(typeof input.package === 'string' && input.package.length <= 214 && PACKAGE.test(input.package), 'Invalid npm package name');
  requireCondition(typeof input.fixed_version === 'string' && input.fixed_version.length <= 60 && STABLE.test(input.fixed_version), 'fixed_version must be an exact stable x.y.z version');
  requireCondition(input.fixed_version.split('.').every(n => Number.isSafeInteger(Number(n))), 'Version component is too large');
  requireCondition(typeof input.advisory_id === 'string' && GHSA.test(input.advisory_id), 'advisory_id must be a canonical GHSA ID; CVE-only input needs manual review');
  return input;
}

export function targetBranch(input) {
  const digest = createHash('sha256').update(input.package + '@' + input.fixed_version).digest('hex').slice(0, 24);
  return 'patchguard/' + digest;
}

function compareVersions(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}

export function registryUrl(value) {
  requireCondition(typeof value === 'string', 'Missing npm registry URL');
  const url = new URL(value);
  requireCondition(url.origin === 'https://registry.npmjs.org' && !url.username && !url.password && !url.search && !url.hash, 'Only HTTPS registry.npmjs.org package URLs are trusted');
  return url;
}

function dependencySpecs(manifest) {
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] || {})) {
      requireCondition(PACKAGE.test(name) && name.length <= 214, 'Unsupported dependency name');
      requireCondition(typeof spec === 'string' && spec.length <= 200 && /^[0-9A-Za-z*^~<>=|. +\-]+$/.test(spec) && (/\d/.test(spec) || /^[*xX]$/.test(spec)), 'Git, URL, alias, workspace, tag or local dependency requires manual review: ' + name);
    }
  }
}

export function validateLock(lock) {
  requireCondition([2, 3].includes(lock.lockfileVersion) && lock.packages && lock.packages[''], 'A package-lock.json v2/v3 is required');
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    requireCondition(location.startsWith('node_modules/') && !location.split('/').includes('..') && entry && !entry.link, 'Workspace or local lock entry requires manual review');
    registryUrl(entry.resolved);
    requireCondition(typeof entry.integrity === 'string' && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity), 'Every locked package must have sha512 integrity');
    dependencySpecs(entry);
  }
  if (lock.dependencies) {
    const inspectLegacy = entries => {
      for (const entry of Object.values(entries)) {
        requireCondition(entry && !entry.link, 'Unsupported legacy lock entry');
        if (entry.resolved) registryUrl(entry.resolved);
        if (entry.dependencies) inspectLegacy(entry.dependencies);
      }
    };
    inspectLegacy(lock.dependencies);
  }
  return lock;
}

export function validateProject(manifest, lock, input) {
  requireCondition(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid package.json');
  requireCondition(manifest.dependencies?.next || manifest.devDependencies?.next, 'This repository is not a root Next.js app');
  requireCondition(!Object.hasOwn(manifest, 'workspaces'), 'Workspaces require manual review');
  requireCondition(!manifest.packageManager || /^npm@/.test(manifest.packageManager), 'Only npm projects are supported');
  requireCondition(typeof manifest.scripts?.build === 'string' && manifest.scripts.build.trim(), 'An existing npm build script is required');
  requireCondition(typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim() && !/no test specified/i.test(manifest.scripts.test), 'Real existing tests are required; no PR is created when tests are missing');
  requireCondition(!Object.keys(manifest.scripts).some(name => /^test(?::|$)/.test(name) && /watch|update|interactive|(^|:)ui($|:)/i.test(name)), 'Interactive, watch or snapshot-update test scripts require manual configuration');
  const sections = ['dependencies', 'devDependencies'].filter(section => Object.hasOwn(manifest[section] || {}, input.package));
  requireCondition(sections.length === 1 && !Object.hasOwn(manifest.optionalDependencies || {}, input.package) && !Object.hasOwn(manifest.peerDependencies || {}, input.package), 'Target must appear exactly once as a direct dependency or devDependency');
  dependencySpecs(manifest);
  validateLock(lock);
  for (const section of SECTIONS) assert.deepEqual(lock.packages[''][section] || {}, manifest[section] || {}, 'Lockfile root differs from package.json: ' + section);
  const installed = lock.packages['node_modules/' + input.package]?.version;
  requireCondition(typeof installed === 'string' && STABLE.test(installed), 'Cannot establish installed direct version');
  requireCondition(installed.split('.')[0] === input.fixed_version.split('.')[0], 'Major upgrades require manual review');
  requireCondition(compareVersions(input.fixed_version, installed) > 0, 'Patch must be newer than the installed version');
  return sections[0];
}

export function validateAdvisory(advisory, input) {
  requireCondition(advisory.ghsa_id === input.advisory_id && !advisory.withdrawn_at, 'Advisory does not match or has been withdrawn');
  requireCondition(Array.isArray(advisory.vulnerabilities) && advisory.vulnerabilities.some(v => v.package?.ecosystem === 'npm' && v.package.name === input.package && v.first_patched_version === input.fixed_version), 'GitHub advisory does not name this exact npm package and first patched version');
}

export function validateMetadata(metadata, input) {
  requireCondition(metadata.name === input.package && metadata.version === input.fixed_version && !metadata.deprecated, 'Registry metadata does not match or the version is deprecated');
  registryUrl(metadata.dist?.tarball);
  requireCondition(typeof metadata.dist?.integrity === 'string' && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist.integrity), 'Registry metadata lacks sha512 integrity');
  dependencySpecs(metadata);
}

export function validatePayload(baseManifest, baseLock, patchedManifest, patchedLock, input, metadata) {
  const section = validateProject(baseManifest, baseLock, input);
  const expected = structuredClone(baseManifest);
  expected[section][input.package] = input.fixed_version;
  assert.deepEqual(patchedManifest, expected, 'Artifact may only change the requested direct dependency version');
  validateLock(patchedLock);
  for (const dependencySection of SECTIONS) assert.deepEqual(patchedLock.packages[''][dependencySection] || {}, expected[dependencySection] || {}, 'Patched lockfile root must match the patched manifest');
  for (const field of ['name', 'version', 'lockfileVersion']) assert.deepEqual(patchedLock[field], baseLock[field], 'Unexpected lockfile identity change');
  const entry = patchedLock.packages['node_modules/' + input.package];
  requireCondition(entry?.version === input.fixed_version && entry.integrity === metadata.dist.integrity && entry.resolved === metadata.dist.tarball, 'Patched direct lock entry must match trusted registry version, URL and integrity');
}

async function jsonFile(filename) {
  const stat = await lstat(filename);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 20 * 1024 * 1024, 'Expected a regular JSON file of at most 20 MB: ' + path.basename(filename));
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function absent(filename) {
  try { await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(filename + ' requires manual review in v1');
}

function context(env) {
  const input = validateInputs({ package: env.PG_PACKAGE, fixed_version: env.PG_FIXED_VERSION, advisory_id: env.PG_ADVISORY_ID });
  requireCondition(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || ''), 'Invalid repository context');
  requireCondition(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'A trusted 40-character dispatch commit is required');
  requireCondition(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Only workflow_dispatch is supported');
  requireCondition(typeof env.PG_DEFAULT_BRANCH === 'string' && env.PG_DEFAULT_BRANCH && env.GITHUB_REF === 'refs/heads/' + env.PG_DEFAULT_BRANCH, 'Dispatch must target the repository default branch');
  return { input, repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, base: env.PG_DEFAULT_BRANCH };
}

async function request(url, options = {}, allowMissing = false) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (allowMissing && response.status === 404) return null;
  requireCondition(response.ok, 'Trusted API request failed with HTTP ' + response.status + ' at ' + new URL(url).hostname);
  const raw = await response.text();
  requireCondition(raw.length <= 4 * 1024 * 1024, 'Trusted API response exceeded size limit');
  return raw ? JSON.parse(raw) : null;
}

function github(env, repository) {
  return (suffix, method = 'GET', body, allowMissing = false) => request('https://api.github.com/repos/' + repository + suffix, {
    method,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', Authorization: 'Bearer ' + env.GITHUB_TOKEN, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, allowMissing);
}

async function trustedMetadata(input, env) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}) };
  const advisory = await request('https://api.github.com/advisories/' + encodeURIComponent(input.advisory_id), { headers });
  validateAdvisory(advisory, input);
  const metadata = await request(REGISTRY + encodeURIComponent(input.package) + '/' + encodeURIComponent(input.fixed_version));
  validateMetadata(metadata, input);
  return metadata;
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { stdio: 'inherit', shell: false, timeout: 10 * 60 * 1000, ...options });
  if (result.error) throw result.error;
  requireCondition(result.status === 0, binary + ' ' + args[0] + ' failed; no pull request will be created');
  return result;
}

async function prepare(env) {
  const ctx = context(env);
  const manifest = await jsonFile('package.json'), lock = await jsonFile('package-lock.json');
  await absent('.npmrc');
  await absent('npm-shrinkwrap.json');
  const section = validateProject(manifest, lock, ctx.input);
  await trustedMetadata(ctx.input, env);
  const api = github(env, ctx.repository);
  const branch = targetBranch(ctx.input);
  requireCondition(!await api('/git/ref/heads/' + branch, 'GET', undefined, true), 'This target already has a patch branch; reconcile it manually before retrying');
  command('git', ['switch', '--create', branch, ctx.sha]);
  manifest[section][ctx.input.package] = ctx.input.fixed_version;
  await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log('Validated exact direct npm patch; working only on ' + branch);
}

async function checkLock(env) {
  const ctx = context(env);
  const manifest = await jsonFile('package.json'), lock = await jsonFile('package-lock.json');
  validateLock(lock);
  requireCondition(['dependencies', 'devDependencies'].some(s => manifest[s]?.[ctx.input.package] === ctx.input.fixed_version), 'Patch changed the wrong dependency');
  for (const section of SECTIONS) assert.deepEqual(lock.packages[''][section] || {}, manifest[section] || {});
  requireCondition(lock.packages['node_modules/' + ctx.input.package]?.version === ctx.input.fixed_version, 'Target lock entry differs from the requested exact version');
}

async function checks(env) {
  await checkLock(env);
  const manifest = await jsonFile('package.json');
  requireCondition(typeof manifest.scripts?.test === 'string' && !/no test specified/i.test(manifest.scripts.test), 'Tests are missing');
  const scripts = Object.keys(manifest.scripts).filter(name => name === 'test' || name.startsWith('test:')).sort();
  for (const script of scripts) command('npm', ['run', script]);
  command('npm', ['audit', '--audit-level=low', '--registry=' + REGISTRY]);
  await checkLock(env);
  const diff = command('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' });
  const changed = diff.stdout.trim().split(/\r?\n/).filter(Boolean);
  requireCondition(changed.includes('package.json') && changed.includes('package-lock.json') && changed.every(name => ['package.json', 'package-lock.json'].includes(name)), 'Checks changed unexpected tracked files or did not produce a patch');
}

async function publish(env) {
  const ctx = context(env);
  requireCondition(typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length > 0, 'Publisher token is missing');
  requireCondition(typeof env.PG_PAYLOAD_DIR === 'string' && path.isAbsolute(env.PG_PAYLOAD_DIR), 'An absolute artifact directory is required');
  const payload = path.resolve(env.PG_PAYLOAD_DIR);
  const workspace = path.resolve('.');
  requireCondition(payload !== workspace && !payload.startsWith(workspace + path.sep), 'Artifact must be outside the trusted checkout');
  const directoryStat = await lstat(payload);
  requireCondition(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Artifact directory cannot be a symlink');
  const baseManifest = await jsonFile('package.json'), baseLock = await jsonFile('package-lock.json');
  const patchedManifest = await jsonFile(path.join(payload, 'package.json')), patchedLock = await jsonFile(path.join(payload, 'package-lock.json'));
  const metadata = await trustedMetadata(ctx.input, env);
  validatePayload(baseManifest, baseLock, patchedManifest, patchedLock, ctx.input, metadata);
  const api = github(env, ctx.repository);
  const branch = targetBranch(ctx.input);
  if (await api('/git/ref/heads/' + branch, 'GET', undefined, true)) {
    console.log('Patch branch already exists; no force push or duplicate pull request. Reconcile manually.');
    return;
  }
  const base = await api('/git/ref/heads/' + ctx.base);
  requireCondition(base.object?.sha === ctx.sha, 'Default branch moved since checks; rerun from the latest default branch');
  const commit = await api('/git/commits/' + ctx.sha);
  const tree = [];
  for (const filename of ['package.json', 'package-lock.json']) {
    const content = await readFile(path.join(payload, filename));
    const blob = await api('/git/blobs', 'POST', { encoding: 'base64', content: content.toString('base64') });
    tree.push({ path: filename, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await api('/git/trees', 'POST', { base_tree: commit.tree.sha, tree });
  const newCommit = await api('/git/commits', 'POST', { message: 'fix(deps): patch ' + ctx.input.package + ' for ' + ctx.input.advisory_id, tree: newTree.sha, parents: [ctx.sha] });
  await api('/git/refs', 'POST', { ref: 'refs/heads/' + branch, sha: newCommit.sha });
  const pr = await api('/pulls', 'POST', {
    title: 'PATCHGUARD: ' + ctx.input.package + ' → ' + ctx.input.fixed_version,
    head: branch,
    base: ctx.base,
    draft: true,
    body: [
      'Updates the direct npm dependency `' + ctx.input.package + '` to `' + ctx.input.fixed_version + '`.',
      'Advisory: https://github.com/advisories/' + ctx.input.advisory_id,
      'Checks completed in https://github.com/' + ctx.repository + '/actions/runs/' + env.GITHUB_RUN_ID + ': npm ci (install scripts disabled), build, all existing test/test:* scripts, and npm audit --audit-level=low.',
      'Only package.json and package-lock.json are committed. Review the full lockfile diff and confirm compatibility before merging. No merge or deployment is performed.',
      'GITHUB_TOKEN-created PR workflows can require a user to approve their runs. Review and approve any additional required PR checks explicitly.',
    ].join('\n\n'),
  });
  console.log('Created draft pull request: ' + pr.html_url);
}

export async function main(mode, env = process.env) {
  if (mode === 'prepare') return prepare(env);
  if (mode === 'check-lock') return checkLock(env);
  if (mode === 'checks') return checks(env);
  if (mode === 'publish') return publish(env);
  throw new Error('Expected prepare, check-lock, checks, or publish');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error('PATCHGUARD stopped: ' + error.message); process.exitCode = 1; });
}
