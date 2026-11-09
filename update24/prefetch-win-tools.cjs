'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mirror = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
const archives = [
  ['7zip%401.0.0','7zip-win-x64.tar.gz','be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3'],
  ['nsis-3.0.4.1','nsis-3.0.4.1.7z','9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'],
  ['nsis-resources-3.4.1','nsis-resources-3.4.1.7z','593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'],
];

async function download(output, [tag, file, expected]) {
  const url = mirror + tag + '/' + file;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(url, {signal:AbortSignal.timeout(30000)});
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1500 * attempt);
      continue;
    }
    if (response.status >= 500 && attempt < 3) {
      await response.body.cancel();
      await delay(1500 * attempt);
      continue;
    }
    assert(response.ok, 'APPROVED_7ZIP_FETCH_' + response.status);
    const pieces = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(size <= 16 * 1024**2, 'LOCKED_TOOL_SIZE_BOUND');
      pieces.push(chunk);
    }
    const bytes = Buffer.concat(pieces);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, 'LOCKED_TOOL_ARCHIVE_HASH:'+file);
    await fs.writeFile(require('node:path').join(output,file), bytes, {flag:'wx'});
    console.log(JSON.stringify({file,archiveBytes:size,sha256:expected,attempt}));
    return;
  }
}
async function main() {
  assert(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true');
  const output = process.argv[2];
  assert(output);
  await Promise.all(archives.map(asset=>download(output,asset)));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
