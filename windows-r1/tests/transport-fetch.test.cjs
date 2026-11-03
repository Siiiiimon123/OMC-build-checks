'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fetchAsset, SCHEMA } = require('../transport.cjs');

// A fake HTTPS peer supplies real AES-GCM ciphertext via a Web ReadableStream.
// No network, certificate bypass, credentials, or production timing override is used.
const key = Buffer.alloc(32, 0x23);
const timings = { idleTimeoutMs: 60, attemptTimeoutMs: 1000, totalTimeoutMs: 3000,
  maxAttempts: 3, backoffMs: 1, progressIntervalMs: 20 };

function fixture() {
  const plain = Buffer.from('authenticated test payload '.repeat(400));
  const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
  const a = { id: 'test-asset', plaintextBytes: plain.length, plaintextSha256: sha256(plain),
    ciphertextBytes: plain.length, nonceHex: Buffer.alloc(12, 7).toString('hex'),
    url: 'https://example.test/asset?secret=must-not-appear' };
  const enc = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(a.nonceHex, 'hex'));
  enc.setAAD(Buffer.from(`${SCHEMA}|${a.id}|${a.plaintextSha256}|${a.plaintextBytes}`));
  const cipher = Buffer.concat([enc.update(plain), enc.final()]);
  a.ciphertextSha256 = sha256(cipher);
  a.tagHex = enc.getAuthTag().toString('hex');
  return { a, cipher, plain };
}

function response(status, cipher, signal, stall = false) {
  const body = new ReadableStream({
    start(controller) {
      if (cipher) controller.enqueue(new Uint8Array(stall ? cipher.subarray(0, 64) : cipher));
      if (!stall) return controller.close();
      const abort = () => { try { controller.error(new Error('aborted')); } catch {} };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    }
  });
  return { ok: status >= 200 && status < 300, status, body,
    headers: new Headers(cipher ? { 'content-length': String(cipher.length) } : {}),
    url: 'https://example.test/asset?secret=must-not-appear' };
}

async function isolated(run) {
  const dir = await fsp.mkdtemp(path.join(__dirname, '.transport-test-'));
  const originalFetch = global.fetch;
  const originalWrite = process.stderr.write;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  const stderr = [];
  process.stderr.write = function(chunk, ...args) { stderr.push(String(chunk)); return true; };
  try { await run({ dir, stderr }); }
  finally {
    global.fetch = originalFetch;
    process.stderr.write = originalWrite;
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = originalGhToken;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

for (const githubStatus of [401, 403, 404]) test(`GitHub HTTP ${githubStatus} falls back to CN without leaking Bearer`, async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher, plain } = fixture();
    a.urls = ['https://api.github.com/repos/example/private/releases/assets/123', 'https://cn.example.test/cipher'];
    process.env.GITHUB_TOKEN = 'test-token-do-not-log';
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(url.host, 'api.github.com');
        assert.equal(options.headers.Accept, 'application/octet-stream');
        assert.equal(options.headers.Authorization, 'Bearer test-token-do-not-log');
        return response(githubStatus, null, options.signal);
      }
      assert.equal(url.host, 'cn.example.test');
      assert.equal(options.headers.Authorization, undefined);
      return response(200, cipher, options.signal);
    };
    await fetchAsset(a, path.join(dir, 'out'), key, timings);
    assert.equal(calls, 2);
    assert.deepEqual(await fsp.readFile(path.join(dir, 'out')), plain);
    assert.ok(entries(stderr).some(x => x.host === 'api.github.com' && x.status === githubStatus && x.reason === 'HTTP_RETRYABLE'));
    assert.ok(entries(stderr).some(x => x.host === 'cn.example.test' && x.reason === 'SUCCESS'));
    assert.doesNotMatch(stderr.join(''), /test-token-do-not-log|Bearer/);
  });
});

test('sources rotate in order across transient failures', async () => {
  await isolated(async ({ dir }) => {
    const { a, cipher, plain } = fixture();
    a.urls = ['https://api.github.com/repos/example/private/releases/assets/123', 'https://cn.example.test/cipher'];
    const hosts = [];
    global.fetch = async (url, options) => {
      hosts.push(url.host);
      return hosts.length < 3 ? response(503, null, options.signal) : response(200, cipher, options.signal);
    };
    await fetchAsset(a, path.join(dir, 'out'), key, timings);
    assert.deepEqual(hosts, ['api.github.com', 'cn.example.test', 'api.github.com']);
    assert.deepEqual(await fsp.readFile(path.join(dir, 'out')), plain);
  });
});

test('GitHub token is not forwarded to a redirected host', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher } = fixture();
    a.urls = ['https://api.github.com/repos/example/private/releases/assets/123'];
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = 'second-test-token';
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(options.headers.Authorization, 'Bearer second-test-token');
        return { status: 302, ok: false, body: null, headers: new Headers({ location: 'https://assets.example.test/download' }) };
      }
      assert.equal(url.host, 'assets.example.test');
      assert.equal(options.headers.Authorization, undefined);
      return response(200, cipher, options.signal);
    };
    await fetchAsset(a, path.join(dir, 'out'), key, timings);
    assert.equal(calls, 2);
    assert.doesNotMatch(stderr.join(''), /second-test-token|Bearer/);
  });
});

test('GitHub redirect to an unavailable CDN falls back to CN without forwarding the token', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher, plain } = fixture();
    a.urls = ['https://api.github.com/repos/example/private/releases/assets/123', 'https://cn.example.test/cipher'];
    process.env.GITHUB_TOKEN = 'redirect-test-token';
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(options.headers.Authorization, 'Bearer redirect-test-token');
        return { status: 302, ok: false, body: null, headers: new Headers({ location: 'https://release-assets.githubusercontent.com/download' }) };
      }
      assert.equal(options.headers.Authorization, undefined);
      if (calls === 2) {
        assert.equal(url.host, 'release-assets.githubusercontent.com');
        return response(403, null, options.signal);
      }
      assert.equal(url.host, 'cn.example.test');
      return response(200, cipher, options.signal);
    };
    await fetchAsset(a, path.join(dir, 'out'), key, timings);
    assert.equal(calls, 3);
    assert.deepEqual(await fsp.readFile(path.join(dir, 'out')), plain);
    assert.ok(entries(stderr).some(x => x.host === 'release-assets.githubusercontent.com' && x.status === 403 && x.reason === 'HTTP_RETRYABLE'));
    assert.doesNotMatch(stderr.join(''), /redirect-test-token|Bearer/);
  });
});

test('corrupted preferred source fails authentication without trying the fallback', async () => {
  await isolated(async ({ dir }) => {
    const { a, cipher } = fixture();
    a.urls = ['https://api.github.com/repos/example/private/releases/assets/123', 'https://cn.example.test/cipher'];
    const bad = Buffer.from(cipher); bad[0] ^= 1;
    let calls = 0;
    global.fetch = async (_url, options) => { calls++; return response(200, bad, options.signal); };
    await assert.rejects(fetchAsset(a, path.join(dir, 'out'), key, timings));
    assert.equal(calls, 1);
    assert.deepEqual(await fsp.readdir(dir), []);
  });
});

function entries(stderr) {
  return stderr.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('mid-body idle stall aborts first attempt, retries, and authenticates output', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher, plain } = fixture();
    let calls = 0;
    global.fetch = async (_url, options) => response(200, cipher, options.signal, ++calls === 1);
    const out = path.join(dir, 'out');
    const result = await fetchAsset(a, out, key, timings);
    assert.equal(calls, 2);
    assert.deepEqual(result, { id: a.id, bytes: plain.length, sha256: a.plaintextSha256, authenticated: true });
    assert.deepEqual(await fsp.readFile(out), plain);
    const logs = entries(stderr);
    assert.ok(logs.some(x => x.attempt === 1 && x.reason === 'IDLE_TIMEOUT' && x.bytes === 64));
    assert.ok(logs.some(x => x.attempt === 2 && x.status === 200 && x.bytes === cipher.length));
    for (const x of logs) {
      for (const field of ['event', 'attempt', 'status', 'bytes', 'elapsedMs', 'reason', 'host'])
        assert.ok(Object.hasOwn(x, field), `missing ${field} in ${JSON.stringify(x)}`);
      assert.ok(Number.isFinite(x.elapsedMs) && x.elapsedMs >= 0);
      assert.equal(x.host, 'example.test');
    }
    assert.doesNotMatch(stderr.join(''), /must-not-appear/);
    assert.deepEqual((await fsp.readdir(dir)).sort(), ['out']);
  });
});

test('transient non-OK status retries and succeeds', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher, plain } = fixture();
    let calls = 0;
    global.fetch = async (_url, options) => ++calls === 1
      ? response(503, null, options.signal) : response(200, cipher, options.signal);
    const out = path.join(dir, 'out');
    await fetchAsset(a, out, key, timings);
    assert.equal(calls, 2);
    assert.deepEqual(await fsp.readFile(out), plain);
    assert.ok(entries(stderr).some(x => x.attempt === 1 && x.status === 503));
  });
});

test('repeated transient non-OK statuses stop at the attempt cap', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a } = fixture();
    let calls = 0;
    global.fetch = async (_url, options) => { calls++; return response(503, null, options.signal); };
    await assert.rejects(fetchAsset(a, path.join(dir, 'out'), key, timings));
    assert.equal(calls, timings.maxAttempts);
    assert.equal(entries(stderr).filter(x => x.status === 503 && x.reason).length >= timings.maxAttempts, true);
    assert.deepEqual(await fsp.readdir(dir), []);
  });
});

test('ciphertext hash mismatch fails immediately without retry or output', async () => {
  await isolated(async ({ dir }) => {
    const { a, cipher } = fixture();
    a.ciphertextSha256 = '0'.repeat(64);
    let calls = 0;
    global.fetch = async (_url, options) => { calls++; return response(200, cipher, options.signal); };
    await assert.rejects(fetchAsset(a, path.join(dir, 'out'), key, timings), /CONTENT_MISMATCH/);
    assert.equal(calls, 1);
    assert.deepEqual(await fsp.readdir(dir), []);
  });
});

test('GCM tag mismatch fails immediately without retry or output', async () => {
  await isolated(async ({ dir }) => {
    const { a, cipher } = fixture();
    a.tagHex = '0'.repeat(32);
    let calls = 0;
    global.fetch = async (_url, options) => { calls++; return response(200, cipher, options.signal); };
    await assert.rejects(fetchAsset(a, path.join(dir, 'out'), key, timings));
    assert.equal(calls, 1);
    assert.deepEqual(await fsp.readdir(dir), []);
  });
});

test('invalid manifest and HTTP URLs never trigger a request', async () => {
  await isolated(async ({ dir }) => {
    const { a } = fixture();
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('unexpected request'); };
    await assert.rejects(fetchAsset({ ...a, nonceHex: 'broken' }, path.join(dir, 'one'), key, timings), /INVALID_MANIFEST/);
    await assert.rejects(fetchAsset({ ...a, url: 'http://example.test/a' }, path.join(dir, 'two'), key, timings), /HTTPS_REQUIRED/);
    assert.equal(calls, 0);
  });
});

test('redirects remain HTTPS, log final host, and do not expose URLs or query secrets', async () => {
  await isolated(async ({ dir, stderr }) => {
    const { a, cipher } = fixture();
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (calls === 1) return { status: 302, ok: false, body: null,
        headers: new Headers({ location: 'https://mirror.test/asset?another-secret=hidden' }) };
      assert.equal(url.host, 'mirror.test');
      return response(200, cipher, options.signal);
    };
    await fetchAsset(a, path.join(dir, 'out'), key, timings);
    assert.equal(calls, 2);
    assert.ok(entries(stderr).some(x => x.host === 'mirror.test' && x.reason === 'SUCCESS'));
    assert.doesNotMatch(stderr.join(''), /secret|hidden|\/asset/);
  });
});

test('redirect to HTTP is rejected without requesting the insecure destination', async () => {
  await isolated(async ({ dir }) => {
    const { a } = fixture();
    let calls = 0;
    global.fetch = async () => { calls++; return { status: 302, ok: false, body: null,
      headers: new Headers({ location: 'http://insecure.test/asset' }) }; };
    await assert.rejects(fetchAsset(a, path.join(dir, 'out'), key, timings), /HTTPS_REQUIRED/);
    assert.equal(calls, 1);
    assert.deepEqual(await fsp.readdir(dir), []);
  });
});

test('CLI success emits exactly one JSON line on stdout', async () => {
  await isolated(async ({ dir }) => {
    const { a, cipher, plain } = fixture();
    const manifest = path.join(dir, 'manifest.json');
    const blob = path.join(dir, 'cipher.bin');
    const preload = path.join(dir, 'preload.cjs');
    const out = path.join(dir, 'out');
    await fsp.writeFile(manifest, JSON.stringify({ schema: SCHEMA, assets: [a] }));
    await fsp.writeFile(blob, cipher);
    await fsp.writeFile(preload, `const fs = require('node:fs');\n` +
      `const b = fs.readFileSync(process.env.TEST_CIPHER_PATH);\n` +
      `global.fetch = async () => ({ok:true,status:200,headers:new Headers({'content-length':String(b.length)}),` +
      `body:new ReadableStream({start(c){c.enqueue(new Uint8Array(b));c.close();}})});\n`);
    const child = spawnSync(process.execPath, ['--require', preload, path.join(__dirname, '..', 'transport.cjs'),
      'fetch', '--manifest', manifest, '--id', a.id, '--output', out],
      { env: { ...process.env, TEST_CIPHER_PATH: blob, OMC_PREVIEW15_TRANSPORT_KEY: key.toString('hex') }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const lines = child.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { id: a.id, bytes: plain.length, sha256: a.plaintextSha256, authenticated: true });
    assert.deepEqual(await fsp.readFile(out), plain);
    assert.doesNotMatch(child.stderr, /must-not-appear/);
  });
});
