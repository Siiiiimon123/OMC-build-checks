'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const [base, target, overlayPath, output] = process.argv.slice(2);
const sourcePath = 'scripts/planUpdateBlockReuse.cjs';
const overlay = JSON.parse(gunzipSync(fs.readFileSync(overlayPath)));
const row = overlay.changesByPlatform.windows.find(r => r.path === sourcePath);
const source = Buffer.from(overlay.changes[sourcePath].data, 'base64');
const sha = b => createHash('sha256').update(b).digest('hex');
assert(source.length === row.bytes && sha(source) === row.sha256);
const text = source.toString('utf8');
const first = text.indexOf('const MIN_BLOCK_BYTES = ');
const last = text.indexOf('function verifyReconstruction(');
assert(first > 0 && last > first);
const { fingerprint, matchRanges } = new Function('fs', 'createHash',
  text.slice(first, last) + '\nreturn { fingerprint, matchRanges };')(fs, createHash);
const b = fingerprint(base);
const t = fingerprint(target);
assert(b.length === 806457757 && b.sha256 === '01342c2230e7f8a01ef2b89eaf8f07fb77ea981e60bf043a27eadc7c87497860');
assert(t.length === 806461267 && t.sha256 === '4ac3fcd07425bcb32a7356a1abbbdacf9385507711e096acd7830104e7c8079f');
const ranges = matchRanges(b, t);
const unique = t.length - ranges.reduce((sum, x) => sum + x.size, 0);
assert.equal(unique, 71423274);
const header = Buffer.from(JSON.stringify({ schema: 'omc-delivery-byte-reuse-v1',
  base: { length: b.length, sha256: b.sha256 }, target: { length: t.length, sha256: t.sha256 }, ranges, unique }));
const size = Buffer.alloc(4);
size.writeUInt32LE(header.length);
const packageFd = fs.openSync(target, 'r');
const baseFd = fs.openSync(base, 'r');
const out = fs.openSync(output, 'wx');
try {
  fs.writeSync(out, size);
  fs.writeSync(out, header);
  const h = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const transfer = (fd, start, end, write) => {
    for (let offset = start; offset < end;) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, end - offset), offset);
      assert(count > 0);
      const chunk = buffer.subarray(0, count);
      h.update(chunk);
      if (write) assert.equal(fs.writeSync(out, chunk), count);
      offset += count;
    }
  };
  let cursor = 0;
  for (const range of ranges) {
    assert(range.start >= cursor && range.size > 0 && range.sourceStart + range.size <= b.length);
    transfer(packageFd, cursor, range.start, true);
    transfer(baseFd, range.sourceStart, range.sourceStart + range.size, false);
    cursor = range.start + range.size;
  }
  transfer(packageFd, cursor, t.length, true);
  assert(h.digest('hex') === t.sha256 && fs.fstatSync(out).size === 4 + header.length + unique);
  fs.fsyncSync(out);
} finally {
  fs.closeSync(out);
  fs.closeSync(baseFd);
  fs.closeSync(packageFd);
}
console.log(JSON.stringify({ status: 'EXACT_WINDOWS_DELIVERY_BYTES', unique, targetSha256: t.sha256 }));

