'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const area = process.env.OMC_ECS_EPHEMERAL_RELEASE_ROOT;
const stage = process.env.OMC_ECS_PRIVATE_RELEASE_STAGE;
const fingerprint = '0aba4803e3ea58d026f832683f36be36ce736c3e34e7b5fdb66831abe893dc4d';
const domain = Buffer.from('omc-preview24-ecs-delivery-v1');
const floor = 2 * 1024**3;
const expected = {
  windows: ['payload.exe', 806461267, '4ac3fcd07425bcb32a7356a1abbbdacf9385507711e096acd7830104e7c8079f'],
  mac: ['payload.pkg', 991719638, 'c410173d2ec9088895e6d8d02c6a55785ae5c7e6a30f74ca585ffa05f3281b3b'],
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const unbase = s => Buffer.from(s, 'base64');

function unwrap(privateKey, wrapped) {
  assert(unbase(wrapped).length === 256);
  const key = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256', oaepLabel: domain }, unbase(wrapped));
  assert(key.length === 32);
  return key;
}

function openLocator(privateKey, input) {
  const envelope = JSON.parse(unbase(input.trim()));
  assert(envelope.v === 1 && envelope.pub === fingerprint);
  assert(unbase(envelope.iv).length === 12 && unbase(envelope.tag).length === 16);
  const key = unwrap(privateKey, envelope.key);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, unbase(envelope.iv));
    d.setAAD(domain);
    d.setAuthTag(unbase(envelope.tag));
    return JSON.parse(Buffer.concat([d.update(unbase(envelope.cipher)), d.final()]));
  } finally { key.fill(0); }
}

async function* storedEntry(source, row, progress = () => {}) {
  const h = crypto.createHash('sha256');
  let raw = 0, written = 0, ready = false, header = Buffer.alloc(0);
  for await (const block of source) {
    raw += block.length;
    assert(raw <= row.bytes);
    h.update(block);
    let data = block;
    if (!ready) {
      header = Buffer.concat([header, block]);
      if (header.length < 30) continue;
      assert(header.readUInt32LE(0) === 0x04034b50 && header.readUInt16LE(8) === 0 && !(header.readUInt16LE(6) & 1), 'ARCHIVE_NOT_STORED_ZIP');
      const nameLength = header.readUInt16LE(26);
      const start = 30 + nameLength + header.readUInt16LE(28);
      assert(start < 4096 && nameLength === Buffer.byteLength('payload.enc'));
      if (header.length < start) continue;
      assert.equal(header.subarray(30, 30 + nameLength).toString('utf8'), 'payload.enc');
      data = header.subarray(start);
      header = null;
      ready = true;
    }
    const count = Math.min(data.length, row.asset.ciphertextBytes - written);
    if (count > 0) {
      written += count;
      progress(written);
      yield data.subarray(0, count);
    }
  }
  assert(ready && written === row.asset.ciphertextBytes && raw === row.bytes && h.digest('hex') === row.sha256,
    'ZIP_STREAM_IDENTITY');
}

function available() {
  const info = fs.statfsSync(stage);
  return info.bavail * info.bsize;
}

async function main() {
  assert(typeof area === 'string' && typeof stage === 'string' && path.isAbsolute(area) && path.isAbsolute(stage));
  const helper = path.join(area, 'transport.cjs');
  assert(hash(fs.readFileSync(helper)) === '19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f');
  const transport = require(helper);
  assert(process.getuid() === 0 && fs.realpathSync(stage) === stage && (fs.statSync(stage).mode & 0o777) === 0o700);
  const pem = path.join(area, 'recipient.pem');
  assert(fs.lstatSync(pem).isFile() && (fs.statSync(pem).mode & 0o777) === 0o600);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(pem));
  assert(hash(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })) === fingerprint);
  const input = fs.readFileSync(path.join(area, 'locators.sealed'), 'utf8');
  const packageSet = openLocator(privateKey, input);
  assert(packageSet.pub === fingerprint && packageSet.packages.length === 2);
  assert(new Set(packageSet.packages.map(x => x.platform)).size === 2);
  assert(available() >= floor + 1798180905 + 16 * 1024**2);
  const rows = packageSet.packages.map(row => {
    const [file, bytes, sha256] = expected[row.platform];
    const url = new URL(row.url);
    assert(url.protocol === 'https:' && /^productionresultssa\d+\.blob\.core\.windows\.net$/.test(url.hostname));
    assert(url.pathname.startsWith('/actions-results/') && url.searchParams.get('sp') === 'r');
    assert(row.expires > Date.now() + 15000 && row.asset.id === 'preview24-' + row.platform);
    assert(row.asset.plaintextBytes === bytes && row.asset.plaintextSha256 === sha256 && row.asset.ciphertextBytes === bytes);
    assert(Number.isSafeInteger(row.id) && row.id > 0 && /^[a-f0-9]{64}$/.test(row.sha256));
    assert(row.bytes > bytes && row.bytes - bytes < 65536);
    const output = path.join(stage, file);
    assert(!fs.existsSync(output));
    return { row, url, output };
  });
  const results = await Promise.allSettled(rows.map(async ({ row, url, output }) => {
    const aes = unwrap(privateKey, row.key);
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(48 * 60 * 1000) });
      assert(response.ok && response.body && Number(response.headers.get('content-length')) === row.bytes, 'ARTIFACT_HTTP_LENGTH');
      console.log(JSON.stringify({ phase: 'BODY_OPEN', platform: row.platform, archiveBytes: row.bytes }));
      let last = 0;
      const payload = storedEntry(response.body, row, transferred => {
        if (transferred - last < 64 * 1024**2) return;
        last = transferred;
        assert(available() >= floor, 'SERVER_MINIMUM_FREE_SPACE');
        console.log(JSON.stringify({ phase: 'RECEIVING', platform: row.platform, transferred }));
      });
      const proof = await transport.decryptStream(Readable.from(payload), row.asset, output, aes);
      assert(proof.authenticated);
      const fd = fs.openSync(output, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const sha = crypto.createHash('sha256');
      for await (const b of fs.createReadStream(output)) sha.update(b);
      assert(sha.digest('hex') === row.asset.plaintextSha256);
      const receipt = { platform: row.platform, artifact: row.id, bytes: proof.bytes, sha256: proof.sha256,
        nativePackageTransferred: true, receivedFromGitHub: true };
      console.log(JSON.stringify({ phase: 'SERVER_SHA_VERIFIED', ...receipt }));
      return receipt;
    } finally { aes.fill(0); }
  }));
  const accepted = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') console.error(JSON.stringify({ phase: 'FAILED',
      platform: rows[i].row.platform, reason: results[i].reason?.code ?? results[i].reason?.name }));
  }
  if (accepted.length !== 2) { process.exitCode = 1; return; }
  assert(available() >= floor);
  fs.writeFileSync(path.join(stage, 'SERVER_PAYLOAD_RECEIPT.json'), JSON.stringify({ status: 'SERVER_BOTH_NATIVE_PACKAGES_VERIFIED',
    recipientFingerprint: fingerprint, available: available(), packages: accepted }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ phase: 'BOTH_PRIVATE_FILES_READY', available: available() }));
}

if (require.main === module) main().catch(e => { console.error(e.code ?? e.name); process.exitCode = 1; });
module.exports = { storedEntry, unwrap };
