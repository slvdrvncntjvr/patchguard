import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateInputs, targetBranch, registryUrl, validateProject, validateLock, validateAdvisory, validateMetadata, validatePayload, main } from '../.github/scripts/patchguard.mjs';

const input = { package: 'lodash', fixed_version: '4.17.21', advisory_id: 'GHSA-35jh-r3h4-6jhm' };
const integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
const metadata = { name: 'lodash', version: '4.17.21', dist: { tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', integrity } };
function project() {
  const manifest = { name: 'demo', version: '1.0.0', private: true, scripts: { build: 'next build', test: 'node --test' }, dependencies: { next: '16.0.0', lodash: '4.17.20' } };
  const lock = { name: 'demo', version: '1.0.0', lockfileVersion: 3, packages: { '': { dependencies: { ...manifest.dependencies } }, 'node_modules/lodash': { version: '4.17.20', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz', integrity } } };
  return { manifest, lock };
}
function payload() {
  const base = project(), manifest = structuredClone(base.manifest), lock = structuredClone(base.lock);
  manifest.dependencies.lodash = input.fixed_version;
  lock.packages[''].dependencies.lodash = input.fixed_version;
  lock.packages['node_modules/lodash'] = { version: input.fixed_version, resolved: metadata.dist.tarball, integrity };
  return { base, manifest, lock };
}

test('accepts canonical exact stable inputs', () => assert.equal(validateInputs(input), input));
test('accepts a scoped npm dependency', () => assert.equal(validateInputs({ ...input, package: '@scope/pkg' }).package, '@scope/pkg'));
for (const value of ['--help', 'pkg; echo injected', 'pkg$(id)', '../pkg', '@scope/pkg/other', 'UPPER', 'pkg\nother', 'https://evil.test/pkg']) {
  test('rejects package injection: ' + JSON.stringify(value), () => assert.throws(() => validateInputs({ ...input, package: value })));
}
for (const value of ['latest', '^4.17.21', '4.17.21;id', '04.17.21', '4.17.21-beta.1', '4.17.21\n', '999999999999999999999.0.0']) {
  test('rejects non-exact version: ' + JSON.stringify(value), () => assert.throws(() => validateInputs({ ...input, fixed_version: value })));
}
test('rejects CVE-only and path-like advisory inputs', () => {
  for (const advisory_id of ['CVE-2021-23337', '../advisory', input.advisory_id + '\n']) assert.throws(() => validateInputs({ ...input, advisory_id }));
});
test('branch is deterministic, safe and independent of advisory aliases', () => {
  assert.match(targetBranch(input), /^patchguard\/[0-9a-f]{24}$/);
  assert.equal(targetBranch(input), targetBranch({ ...input, advisory_id: 'GHSA-jf85-cpcp-j695' }));
  assert.notEqual(targetBranch(input), targetBranch({ ...input, fixed_version: '4.17.22' }));
});
test('rejects registry impersonation, credentials, insecure URLs and redirects as sources', () => {
  for (const url of ['http://registry.npmjs.org/a.tgz', 'https://registry.npmjs.org.evil.test/a.tgz', 'https://user@registry.npmjs.org/a.tgz', 'https://evil.test/a.tgz', 'https://registry.npmjs.org/a.tgz?redirect=evil']) assert.throws(() => registryUrl(url));
});
test('requires direct dependency and preserves dependency section', () => {
  const { manifest, lock } = project();
  assert.equal(validateProject(manifest, lock, input), 'dependencies');
  delete manifest.dependencies.lodash;
  assert.throws(() => validateProject(manifest, lock, input), /direct/);
});
test('missing tests, non-Next.js and workspaces fail closed', () => {
  for (const change of [m => delete m.scripts.test, m => delete m.dependencies.next, m => { m.workspaces = []; }]) {
    const { manifest, lock } = project(); change(manifest); assert.throws(() => validateProject(manifest, lock, input));
  }
});
test('rejects duplicate direct dependency sections and major upgrades', () => {
  const { manifest, lock } = project();
  manifest.devDependencies = { lodash: '4.17.20' };
  assert.throws(() => validateProject(manifest, lock, input));
  delete manifest.devDependencies;
  assert.throws(() => validateProject(manifest, lock, { ...input, fixed_version: '5.0.0' }), /Major/);
});
test('rejects lockfile drift, links, private registries and missing integrity', () => {
  for (const change of [l => { l.packages[''].dependencies.lodash = '4.0.0'; }, l => { l.packages['node_modules/lodash'].link = true; }, l => { l.packages['node_modules/lodash'].resolved = 'https://evil.test/a.tgz'; }, l => { delete l.packages['node_modules/lodash'].integrity; }]) {
    const { manifest, lock } = project(); change(lock); assert.throws(() => validateProject(manifest, lock, input));
  }
});
test('allows semver prerelease peer ranges but rejects URL dependencies in metadata', () => {
  const { lock } = project();
  lock.packages['node_modules/lodash'].peerDependencies = { react: '^19.0.0 || 19.0.0-rc-123' };
  assert.doesNotThrow(() => validateLock(lock));
  lock.packages['node_modules/lodash'].dependencies = { other: 'git+https://evil.test/repo.git' };
  assert.throws(() => validateLock(lock));
});
test('advisory must name the exact npm package and patched version and be current', () => {
  const advisory = { ghsa_id: input.advisory_id, withdrawn_at: null, vulnerabilities: [{ package: { ecosystem: 'npm', name: 'lodash' }, first_patched_version: '4.17.21' }] };
  assert.doesNotThrow(() => validateAdvisory(advisory, input));
  assert.throws(() => validateAdvisory({ ...advisory, withdrawn_at: '2026-01-01' }, input));
  assert.throws(() => validateAdvisory(advisory, { ...input, package: 'other' }));
  assert.throws(() => validateAdvisory(advisory, { ...input, fixed_version: '4.17.22' }));
});
test('registry metadata identity and integrity are required', () => {
  assert.doesNotThrow(() => validateMetadata(metadata, input));
  assert.throws(() => validateMetadata({ ...metadata, name: 'other' }, input));
  assert.throws(() => validateMetadata({ ...metadata, deprecated: 'Do not use' }, input));
  assert.throws(() => validateMetadata({ ...metadata, dist: { ...metadata.dist, integrity: 'sha1-bad' } }, input));
});
test('publisher accepts only the exact intended manifest patch and trusted lock entry', () => {
  const p = payload();
  assert.doesNotThrow(() => validatePayload(p.base.manifest, p.base.lock, p.manifest, p.lock, input, metadata));
  p.manifest.scripts.build = 'echo bypass';
  assert.throws(() => validatePayload(p.base.manifest, p.base.lock, p.manifest, p.lock, input, metadata));
});
test('publisher rejects artifact target hash or registry tampering', () => {
  const p = payload();
  p.lock.packages['node_modules/lodash'].integrity = 'sha512-YQ==';
  assert.throws(() => validatePayload(p.base.manifest, p.base.lock, p.manifest, p.lock, input, metadata));
});
test('helper refuses an unknown mode or forged execution context before networking', async () => {
  await assert.rejects(main('shell'), /Expected/);
  await assert.rejects(main('prepare', { PG_PACKAGE: input.package, PG_FIXED_VERSION: input.fixed_version, PG_ADVISORY_ID: input.advisory_id, GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'pull_request_target' }), /workflow_dispatch/);
});

async function publisherFixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'patchguard-publisher-test-'));
  const work = path.join(root, 'checkout'), artifact = path.join(root, 'artifact');
  await mkdir(work); await mkdir(artifact);
  const p = payload();
  if (options.tampered) p.manifest.scripts.build = 'echo bypass';
  for (const [directory, manifest, lock] of [[work, p.base.manifest, p.base.lock], [artifact, p.manifest, p.lock]]) {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock));
  }
  const previousDirectory = process.cwd(), originalFetch = globalThis.fetch, requests = [];
  t.after(async () => {
    process.chdir(previousDirectory); globalThis.fetch = originalFetch;
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('patchguard-publisher-test-'));
    await rm(root, { recursive: true, force: true });
  });
  process.chdir(work);
  globalThis.fetch = async (url, request = {}) => {
    const method = request.method || 'GET';
    requests.push({ url: String(url), method, body: request.body ? JSON.parse(request.body) : undefined });
    assert.ok(['api.github.com', 'registry.npmjs.org'].includes(new URL(url).hostname));
    assert.equal(request.redirect, 'error');
    if (String(url).includes('/advisories/')) return Response.json({ ghsa_id: input.advisory_id, vulnerabilities: [{ package: { ecosystem: 'npm', name: input.package }, first_patched_version: input.fixed_version }] });
    if (new URL(url).hostname === 'registry.npmjs.org') return Response.json(metadata);
    if (String(url).includes('/git/ref/heads/patchguard/')) return options.existing ? Response.json({ object: { sha: 'b'.repeat(40) } }) : Response.json({}, { status: 404 });
    if (String(url).endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: (options.moved ? 'f' : 'a').repeat(40) } });
    if (method === 'GET' && String(url).includes('/git/commits/')) return Response.json({ tree: { sha: 'b'.repeat(40) } });
    if (String(url).endsWith('/pulls')) return Response.json({ html_url: 'https://github.com/owner/demo/pull/1' });
    assert.equal(method, 'POST');
    return Response.json({ sha: 'c'.repeat(40) });
  };
  const env = { PG_PACKAGE: input.package, PG_FIXED_VERSION: input.fixed_version, PG_ADVISORY_ID: input.advisory_id, PG_DEFAULT_BRANCH: 'main', PG_PAYLOAD_DIR: artifact, GITHUB_REPOSITORY: 'owner/demo', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'synthetic-test-token', GITHUB_RUN_ID: '123' };
  return { env, requests };
}

test('publisher integration writes only two manifests to a new branch and a draft PR', async t => {
  const { env, requests } = await publisherFixture(t);
  await main('publish', env);
  const writes = requests.filter(r => r.method === 'POST');
  assert.equal(writes.length, 6);
  assert.deepEqual(writes.find(r => r.url.endsWith('/git/trees')).body.tree.map(f => f.path), ['package.json', 'package-lock.json']);
  assert.equal(writes.find(r => r.url.endsWith('/git/refs')).body.ref, 'refs/heads/' + targetBranch(input));
  assert.equal(writes.find(r => r.url.endsWith('/pulls')).body.draft, true);
  assert.equal(writes.find(r => r.url.endsWith('/pulls')).body.base, 'main');
  assert.ok(writes.every(r => !/\/merges?$|\/deployments$/.test(r.url)));
});
test('publisher integration never writes when the branch already exists', async t => {
  const { env, requests } = await publisherFixture(t, { existing: true });
  await main('publish', env);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});
test('publisher integration refuses a moved default branch without any writes', async t => {
  const { env, requests } = await publisherFixture(t, { moved: true });
  await assert.rejects(main('publish', env), /Default branch moved/);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});
test('publisher integration rejects a tampered artifact before any writes', async t => {
  const { env, requests } = await publisherFixture(t, { tampered: true });
  await assert.rejects(main('publish', env), /Artifact may only change/);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});
