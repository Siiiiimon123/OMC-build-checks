'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const url = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/7zip%401.0.0/7zip-win-x64.tar.gz';
const expected = 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3';

async function main() {
  assert(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true');
  const output = process.argv[2];
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
      assert(size <= 4 * 1024**2, 'APPROVED_7ZIP_SIZE_BOUND');
      pieces.push(chunk);
    }
    const bytes = Buffer.concat(pieces);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, 'APPROVED_7ZIP_ARCHIVE_HASH');
    await fs.writeFile(output, bytes, {flag:'wx'});
    console.log(JSON.stringify({archiveBytes:size,sha256:expected,attempt}));
    return;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
