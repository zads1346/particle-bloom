import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { makeStaticServer } from '../release/server.mjs';

test('release server serves local assets with correct MIME and rejects unsafe paths/methods', async () => {
  const tempBase = resolve(tmpdir());
  const testRoot = await mkdtemp(join(tempBase, 'bloom-release-test-'));
  const root = join(testRoot, 'served');
  const outside = join(testRoot, 'outside');
  let server;
  try {
    await Promise.all([mkdir(root), mkdir(outside)]);
    await Promise.all([
      writeFile(join(root, 'index.html'), '<h1>Local artwork</h1>'),
      writeFile(join(root, 'runtime.wasm'), 'wasm'),
      writeFile(join(root, '.env'), 'not-served'),
      writeFile(join(outside, 'private.txt'), 'outside'),
    ]);
    // Windows file symlinks may need elevated privileges. Directory junctions
    // are unprivileged and exercise the same realpath escape protection.
    const escapeUrl = process.platform === 'win32' ? '/escape/private.txt' : '/escape.txt';
    if (process.platform === 'win32') {
      await symlink(outside, join(root, 'escape'), 'junction');
    } else {
      await symlink(join(outside, 'private.txt'), join(root, 'escape.txt'));
    }
    server = makeStaticServer(root);
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(url);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /Local artwork/);
    const wasm = await fetch(url + '/runtime.wasm');
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(await wasm.text(), 'wasm');
    const head = await fetch(url + '/runtime.wasm', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '4');
    assert.equal(await head.text(), '');
    assert.equal((await fetch(url + '/runtime.wasm', { headers: { 'if-none-match': wasm.headers.get('etag') } })).status, 304);
    assert.equal((await fetch(url + '/.env')).status, 403);
    const escape = await fetch(url + escapeUrl);
    assert.equal(escape.status, 403);
    assert.equal(await escape.text(), 'Forbidden');
    assert.equal((await fetch(url + '/missing')).status, 404);
    assert.equal((await fetch(url + '/bad%GG')).status, 400);
    const post = await fetch(url, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  } finally {
    if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
    // Both the served and outside fixture, including the junction target, are
    // inside this newly created test root. Verify the bounded cleanup target.
    const relativeRoot = relative(tempBase, resolve(testRoot));
    assert.ok(relativeRoot && !relativeRoot.startsWith('..') && !isAbsolute(relativeRoot));
    assert.ok(basename(testRoot).startsWith('bloom-release-test-'));
    await rm(testRoot, { recursive: true, force: true });
  }
});
