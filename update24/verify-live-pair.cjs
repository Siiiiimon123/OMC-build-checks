'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const { setTimeout: wait } = require('node:timers/promises');

const base = 'https://omc.xiaoa.cyou/updates/';
const rootHash = '144092e66523f8d67d059ae871bbd2a9ed74224aba0b4b597470490677924c10';
const newTargetsHash = '878cb62c29c842582207a654363aa85382ebdaf2bede794779b4c5a5eaaa3ca5';
const version = '1.0.21-preview.24';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expected = [
  ['WIN_X64_PREVIEW_WARNING_ONLY', 'OMC-Photo-Select-1.0.21-preview.24-x64.exe', 806461267,
    '4ac3fcd07425bcb32a7356a1abbbdacf9385507711e096acd7830104e7c8079f'],
  ['MAC_ARM64_PREVIEW_WARNING_ONLY', 'OMC-Preview-1.0.21-preview.24-mac-arm64-unsigned.pkg', 991719638,
    'c410173d2ec9088895e6d8d02c6a55785ae5c7e6a30f74ca585ffa05f3281b3b'],
];

function canonical(value) {
  if (typeof value === 'string') return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => canonical(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  assert(value === null || typeof value === 'boolean' || Number.isSafeInteger(value));
  return JSON.stringify(value);
}

function verify(role, buffer, root) {
  const { signed, signatures } = JSON.parse(buffer);
  const policy = root.roles[role];
  assert(signed._type === role && Number.isSafeInteger(signed.version) && signed.version > 0);
  assert(Date.parse(signed.expires) > Date.now(), 'EXPIRED_' + role);
  const payload = Buffer.from(canonical(signed));
  const valid = new Set();
  for (const { keyid, sig } of signatures) {
    if (!policy.keyids.includes(keyid)) continue;
    const k = root.keys[keyid];
    assert(k.keytype === 'ed25519' && k.scheme === 'ed25519');
    if (crypto.verify(null, payload, k.keyval.public, Buffer.from(sig, 'hex'))) valid.add(keyid);
  }
  assert(valid.size >= policy.threshold, 'INVALID_SIGNATURE_' + role);
  return signed;
}

function metadataBinding(buffer, ref) {
  assert.equal(buffer.length, ref.length);
  assert.equal(sha(buffer), ref.hashes.sha256);
}

function fetchBounded(rel, limit, range) {
  return new Promise((resolve, reject) => {
    const headers = { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' };
    if (range) headers.Range = 'bytes=' + range;
    const req = https.get(new URL(rel, base), { headers, signal: AbortSignal.timeout(18000) }, response => {
      response.on('error', reject);
      if (response.statusCode !== (range ? 206 : 200)) {
        reject(new Error('HTTP_' + response.statusCode + ' ' + rel));
        response.destroy();
        return;
      }
      let received = 0;
      const blocks = [];
      response.on('data', bytes => {
        received += bytes.length;
        if (received > limit) {
          response.destroy(new Error('EXCEEDED_PUBLIC_READ_LIMIT'));
        } else {
          blocks.push(bytes);
        }
      });
      response.on('end', () => resolve({ body: Buffer.concat(blocks), headers: response.headers }));
    });
    req.on('error', reject);
  });
}

async function small(rel) {
  return (await fetchBounded(rel, 65536)).body;
}

async function getRoot() {
  const bytes = await small('metadata/root.json');
  assert.equal(sha(bytes), rootHash);
  const root = verify('root', bytes, JSON.parse(bytes).signed);
  assert.equal(root.consistent_snapshot, true);
  return root;
}

async function pre() {
  await getRoot();
  await Promise.all(expected.map(async ([profile, name, size, digest]) => {
    for (const range of ['0-1023', (size - 1024) + '-' + (size - 1)]) {
      const { body, headers } = await fetchBounded('targets/releases/' + digest + '.' + name, 1024, range);
      assert.equal(body.length, 1024);
      assert.equal(headers['content-range'], 'bytes ' + range + '/' + size);
    }
    console.log(JSON.stringify({ profile, size, verifiedPublicRanges: 2, status: 206 }));
  }));
}

async function readPair(root) {
  const timestamp = verify('timestamp', await small('metadata/timestamp.json'), root);
  const snapshotRef = timestamp.meta['snapshot.json'];
  assert(Number.isSafeInteger(snapshotRef.version) && snapshotRef.version > 0);
  const snapshotBytes = await small('metadata/' + snapshotRef.version + '.snapshot.json');
  metadataBinding(snapshotBytes, snapshotRef);
  const snapshot = verify('snapshot', snapshotBytes, root);
  assert.equal(snapshot.version, snapshotRef.version);
  const targetsRef = snapshot.meta['targets.json'];
  if (targetsRef.version === 4) return false;
  assert.equal(targetsRef.version, 16);
  const targetsBytes = await small('metadata/16.targets.json');
  metadataBinding(targetsBytes, targetsRef);
  assert.equal(sha(targetsBytes), newTargetsHash);
  const targets = verify('targets', targetsBytes, root);
  assert.equal(targets.version, targetsRef.version);
  await Promise.all(expected.map(async ([profile, name, size, digest]) => {
    const directory = 'profiles/' + profile + '/';
    const ref = targets.targets[directory + 'current.json'];
    const bytes = await small('targets/' + directory + ref.hashes.sha256 + '.current.json');
    metadataBinding(bytes, ref);
    const d = JSON.parse(bytes);
    assert.equal(d.version, version);
    assert.equal(d.releaseProfileId, profile);
    assert.equal(d.targetPath, 'releases/' + name);
    assert.equal(d.artifactLength, size);
    assert.equal(d.artifactSha256, digest);
    assert.deepEqual(targets.targets[d.targetPath], { length: size, hashes: { sha256: digest } });
  }));
  console.log(JSON.stringify({ version, targets: targets.version, snapshot: snapshot.version, timestamp: timestamp.version, profiles: 2 }));
  return true;
}

async function main() {
  if (process.argv[2] === 'pre') {
    await pre();
    return;
  }
  assert.equal(process.argv[2], 'wait');
  const root = await getRoot();
  const deadline = Date.now() + 6 * 60000;
  do {
    if (await readPair(root)) return;
    await wait(8500);
  } while (Date.now() < deadline);
  throw new Error('NO_NEW_PUBLIC_TARGETS_BEFORE_DEADLINE');
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verify, metadataBinding };
