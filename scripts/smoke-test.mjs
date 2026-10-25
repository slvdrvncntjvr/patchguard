import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let logs = '', launchError;
const capture = data => { logs = (logs + data.toString()).slice(-10000); };
child.stdout.on('data', capture);
child.stderr.on('data', capture);
child.on('error', error => { launchError = error; });

try {
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Next.js exited before startup:\n' + logs);
    try { const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) }); ready = response.ok; } catch {}
    if (ready) break;
    await pause(250);
  }
  assert.ok(ready, 'Production server did not become healthy:\n' + logs);
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { application: 'PATCHGUARD', status: 'ok', monitoring: 'not-verified' });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('slvdrvncntjvr/patchguard'));
  assert.ok(html.includes('Waiting for a verified scan'));
  assert.ok(!html.includes('8sZghTGcyURX3CMo'));
  assert.ok(!html.includes('CONFIGURE_TELEGRAM_CHAT_ID'));
  assert.equal(page.headers.get('x-powered-by'), null);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(base + '/this-route-does-not-exist')).status, 404);
  console.log('Production smoke test passed: homepage, health JSON, cache policy, security headers, credential privacy and 404 route.');
} finally {
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]);
}
