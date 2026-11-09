'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const https = require('node:https');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fixture = ['electron/updateService.cjs','electron/updateArtifactTransfer.cjs','electron/strictTufFetcher.cjs',
  'electron/updatePolicy.cjs','electron/updateGenerationStore.cjs','electron/updateMetadataPolicy.cjs',
  'contracts/update-client-v1.json','contracts/release-profiles-v1.json'];
const read = (file) => JSON.parse(fs.readFileSync(file));

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REPOSITORY, 'Siiiiimon123/OMC-build-checks');
  const [source, appAsar, baseFile, targetFile, work, reportFile] = process.argv.slice(2);
  const req = createRequire(path.join(source, 'package.json'));
  const asar = req('@electron/asar');
  const bindingFiles = fixture.map((member) => {
    const bytes = fs.readFileSync(path.join(source, member));
    assert(bytes.equals(asar.extractFile(appAsar, path.join(...member.split('/')))), 'ASAR_BINDING:'+member);
    return { member, sha256: sha(bytes) };
  });
  assert.equal(JSON.parse(asar.extractFile(appAsar, 'package.json')).version, '1.0.21-preview.24');
  assert.equal(JSON.parse(asar.extractFile(appAsar, path.join('dist','release-metadata.json'))).version, '1.0.21-preview.24');
  const { canonicalize } = req('@tufjs/canonical-json');
  const { UpdateService, hashedArtifactFileName } = req('./electron/updateService.cjs');
  const { planUpdateBlockReuse } = req('./scripts/planUpdateBlockReuse.cjs');
  const platform = process.platform;
  const win = platform === 'win32';
  assert(win || (platform === 'darwin' && process.arch === 'arm64'));
  const baseVersion = '1.0.21-preview.23';
  const kind = win ? 'x64.exe' : 'arm64.pkg';
  const baseName = 'omc-preview23-' + kind;
  const fileName = 'omc-preview24-' + kind;
  const plan = planUpdateBlockReuse({ baseFile, targetFile, baseVersion, baseReleaseFileName: baseName });
  const length = plan.target.length;
  const profile = (win ? 'WIN_X64' : 'MAC_ARM64') + '_PREVIEW_WARNING_ONLY';
  const config = read(path.join(source, 'contracts/update-client-v1.json'));
  const requestLog = [];
  let interrupt = false;
  let ignoreRanges = false;
  const routes = new Map();
  const targetPath = 'artifacts/' + fileName;
  const payloadRoute = '/targets/artifacts/' + plan.target.sha256 + '.' + fileName;

  async function respond(request, response) {
    const data = routes.get(request.url);
    if (data) {
      response.writeHead(200, { 'Content-Length': data.length });
      response.end(data);
      return;
    }
    if (request.url !== payloadRoute) { response.writeHead(404).end(); return; }
    const range = request.headers.range ?? null;
    const parsed = range && /^bytes=(\d+)-(\d+)$/.exec(range);
    let start = 0, end = length - 1;
    if (range && !ignoreRanges) {
      assert(parsed);
      start = Number(parsed[1]); end = Number(parsed[2]);
      assert(start >= 0 && end >= start && end < length);
      response.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + length, 'Content-Length': end - start + 1 });
    } else {
      response.writeHead(200, { 'Content-Length': length });
    }
    const row = { range, status: response.statusCode, payloadBytes: 0 };
    requestLog.push(row);
    if (interrupt) {
      interrupt = false;
      assert(!range);
      const handle = await fsp.open(targetFile, 'r');
      const bytes = Buffer.alloc(8 * 1024 * 1024);
      try { await handle.read(bytes, 0, bytes.length, 0); } finally { await handle.close(); }
      await new Promise((resolve, reject) => response.write(bytes, (err) => err ? reject(err) : resolve()));
      row.payloadBytes = bytes.length;
      await new Promise((resolve) => setTimeout(resolve, 400));
      response.destroy();
      return;
    }
    const stream = fs.createReadStream(targetFile, { start, end });
    stream.on('data', (b) => { row.payloadBytes += b.length; });
    await pipeline(stream, response);
  }

  const serverErrors = [];
  const server = https.createServer({ cert: fs.readFileSync(path.join(work, 'fixture.crt')),
    key: fs.readFileSync(path.join(work, 'fixture.key')) }, (request, response) => {
    respond(request, response).catch((error) => { serverErrors.push(String(error.code ?? error.message)); response.destroy(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = 'https://127.0.0.1:' + server.address().port;
    config.allowedOrigins = [origin];
    config.metadataBaseUrl = origin + '/metadata/';
    config.targetBaseUrl = origin + '/targets/';
    const roleNames = ['root','targets','snapshot','timestamp'];
    const keys = Object.fromEntries(roleNames.map((role) => [role, crypto.generateKeyPairSync('ed25519')]));
    function sign(role, fields) {
      const body = { _type: role, spec_version: '1.0.31', version: 3,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), ...fields };
      return Buffer.from(JSON.stringify({ signed: body, signatures: [{ keyid: role,
        sig: crypto.sign(null, Buffer.from(canonicalize(body)), keys[role].privateKey).toString('hex') }] }));
    }
    const root = sign('root', { consistent_snapshot: true,
      keys: Object.fromEntries(roleNames.map((role) => [role, { keytype: 'ed25519', scheme: 'ed25519',
        keyval: { public: keys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString() } }])),
      roles: Object.fromEntries(roleNames.map((role) => [role, { keyids: [role], threshold: 1 }])) });
    const identity = { resourcePath: 'contracts/update-root.json', sha256: sha(root), minimumVersion: 3 };
    config.initialTrustedRoot = identity;
    fs.mkdirSync(path.join(work, 'contracts'));
    fs.writeFileSync(path.join(work, identity.resourcePath), root);
    const descriptorPath = config.descriptorTargets[profile];
    const descriptor = Buffer.from(JSON.stringify({ schemaVersion: 'omc-update-release-descriptor-v1',
      releaseProfileId: profile, version: '1.0.21-preview.24', platform, arch: process.arch, channel: 'preview',
      targetPath, artifactFileName: fileName, artifactLength: length, artifactSha256: plan.target.sha256,
      releaseNotes: 'OMC isolated transport test', publishedAt: new Date().toISOString() }));
    const describe = (data) => ({ length: data.length, hashes: { sha256: sha(data) } });
    const targetMetadata = { length, hashes: { sha256: plan.target.sha256 } };
    if (plan.custom) targetMetadata.custom = plan.custom;
    const targets = sign('targets', { targets: { [descriptorPath]: describe(descriptor), [targetPath]: targetMetadata } });
    const snapshot = sign('snapshot', { meta: { 'targets.json': { version: 3, ...describe(targets) } } });
    routes.set('/metadata/timestamp.json', sign('timestamp', { meta: { 'snapshot.json': { version: 3, ...describe(snapshot) } } }));
    routes.set('/metadata/3.snapshot.json', snapshot);
    routes.set('/metadata/3.targets.json', targets);
    routes.set('/targets/' + path.posix.dirname(descriptorPath) + '/' + sha(descriptor) + '.current.json', descriptor);
    const userDataPath = path.join(work, 'profile');
    const downloads = path.join(userDataPath, 'update-client', 'downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const baseCache = path.join(downloads, hashedArtifactFileName(baseName, plan.baseSha256));
    const releaseCapabilities = { schemaVersion: 'omc-release-capabilities-v1', releaseProfileId: profile,
      platform, arch: process.arch, channel: 'preview', wasteAutoRejectEnabled: false,
      updateRequired: true, tufRootFingerprint: identity.sha256 };
    const newClient = () => new UpdateService({ config, releaseCapabilities, currentVersion: baseVersion,
      platform, arch: process.arch, userDataPath, appRootPath: work });
    async function download(client, state = 'downloaded') {
      const result = await client.check();
      assert.equal(result.state, 'available', result.reasonCode);
      const downloaded = await client.download(result.candidate.token);
      assert.equal(downloaded.state, state, downloaded.reasonCode);
      if (state === 'downloaded') {
        const final = client.pendingOpen.filePath;
        assert.equal(path.dirname(final).toLowerCase(), downloads.toLowerCase());
        assert.equal(path.basename(final), hashedArtifactFileName(fileName, plan.target.sha256));
        assert.equal(fs.statSync(final).size, length);
        fs.unlinkSync(final);
      }
      return downloaded;
    }
    const results = {};
    if (plan.reconstructionVerified) {
      fs.renameSync(baseFile, baseCache);
      try {
        await download(newClient());
        const actual = requestLog.splice(0);
        assert.equal(actual.length, plan.rangedRequests);
        assert(actual.every((r) => r.status === 206));
        assert.equal(actual.reduce((n,r) => n+r.payloadBytes,0), plan.plannedDownloadBytes);
        results.incremental = { passed:true, transferredBytes:plan.plannedDownloadBytes, requests:actual };
      } finally { fs.renameSync(baseCache, baseFile); }
    } else {
      results.incremental = { passed:false, reason:'NO_ELIGIBLE_REAL_PACKAGE_DELTA', matchedBytes:plan.matchedBytes };
    }
    interrupt = true;
    const stopped = await download(newClient(), 'error');
    assert.equal(stopped.reasonCode, 'UPDATE_DOWNLOAD_INTERRUPTED');
    const saved = fs.statSync(path.join(downloads, '.omc-update-' + plan.target.sha256 + '.part')).size;
    assert(saved > 0 && saved <= 8*1024*1024);
    await download(newClient());
    const resumed = requestLog.splice(0);
    assert.equal(resumed.length, 2);
    assert.equal(resumed[1].range, 'bytes=' + saved + '-' + (length-1));
    assert.equal(resumed[1].status, 206);
    assert.equal(resumed[1].payloadBytes, length-saved);
    results.resume = { passed:true, savedBytes:saved, requests:resumed };

    if (plan.reconstructionVerified) fs.renameSync(baseFile, baseCache);
    ignoreRanges = true;
    try { await download(newClient()); }
    finally { if (plan.reconstructionVerified) fs.renameSync(baseCache, baseFile); }
    const fallback = requestLog.splice(0);
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].status, 200);
    assert.equal(fallback[0].payloadBytes, length);
    if (plan.plannedDownloadBytes > 0 && plan.reconstructionVerified) assert(fallback[0].range);
    results.fallback = { passed:true, requests:fallback };
    assert.deepEqual(serverErrors, []);
    fs.writeFileSync(reportFile, JSON.stringify({ passed:results.incremental.passed, platform,
      installedVersionMetadata:'1.0.21-preview.24', bootstrapIdentityForTest:baseVersion, transport:'TLS loopback, ephemeral signed TUF',
      productionEndpointUsed:false, baseSha256:plan.baseSha256, target:plan.target, bindingFiles, results }, null, 2)+'\n', { flag:'wx' });
    if (!results.incremental.passed) process.exitCode = 3;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((err) => { console.error(err.stack ?? err); process.exitCode = 1; });
