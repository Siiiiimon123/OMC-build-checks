'use strict';

// Execute the actual inspector in an isolated VM with a fake CDP peer and
// renderer. This does not launch the application or alter the CI-only gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const inspector = fs.readFileSync(path.join(__dirname, '..', 'inspect-installed.mjs'), 'utf8');
const importLine = "import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';";
assert.ok(inspector.includes(importLine), 'test harness must bind the inspector imports');
const source = `(async () => {\n${inspector.replace(importLine, '')}\n})()`;

async function runSeed(options = {}) {
  const events = [];
  const writes = new Map();
  let inputPolls = 0;
  let started = false;
  let imported = false;
  let selected = false;
  let kept = false;
  let importButtonPolls = 0;
  let importClicks = 0;
  let currentNodeId = 41;
  const fixture = 'fixture.jpg';
  const output = 'report.json';
  const buttons = [
    { label: '使用此编号开始选片', click() { started = true; } },
    { label: '导入照片', click() { importClicks++; imported = true; } },
    { label: '单图', click() { selected = true; } }
  ].map(b => ({ ...b, offsetWidth: 10, disabled: false,
    innerText: b.label, getAttribute(name) { return name === 'aria-label' ? this.label : null; } }));
  const root = { childElementCount: 1, innerText: 'x'.repeat(560),
    getBoundingClientRect: () => ({ width: 1008, height: 655 }) };
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '#root button') return [...buttons, {}, {}];
      if (selector === 'button') {
        if (started && options.delayImport && !imported) {
          importButtonPolls++;
          const importButton = buttons.find(b => b.label === '导入照片');
          importButton.offsetWidth = importButtonPolls === 1 ? 0 : 10;
          importButton.disabled = importButtonPolls === 2;
        }
        return buttons.filter(b => {
        if (b.label === '使用此编号开始选片') return !options.missingStart;
        if (b.label === '导入照片') return started;
        return true;
        });
      }
      if (selector === '.photo-tile') return imported && events.some(e => e.method === 'DOM.setFileInputFiles') ? [{}] : [];
      throw Error(`Unexpected selector: ${selector}`);
    },
    querySelector(selector) {
      if (selector === '#root') return root;
      if (selector === 'input[type=file]') {
        inputPolls++;
        return imported && inputPolls >= (options.inputAfter || 1) ? {} : null;
      }
      if (selector === '.photo-tile') return { click() {} };
      if (selector === '.single-photo-view') return selected ? { dataset: { decision: kept ? 'keep' : '', reviewPhotoId: 'p1' } } : null;
      if (selector === '.single-filename') return { innerText: fixture };
      if (selector === '.decision.accept') return { disabled: false, click() { kept = true; } };
      throw Error(`Unexpected selector: ${selector}`);
    }
  };
  const renderer = vm.createContext({ document, localStorage: { setItem() {} } });
  class FakeWebSocket {
    constructor() { this.listeners = {}; }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
      if (name === 'open') queueMicrotask(() => fn());
    }
    send(text) {
      const request = JSON.parse(text);
      events.push(request);
      queueMicrotask(() => {
        let result = {};
        if (request.method === 'Runtime.evaluate') {
          try { result = { result: { value: vm.runInContext(request.params.expression, renderer) } }; }
          catch (e) { result = { exceptionDetails: { text: e.message }, result: {} }; }
        } else if (request.method === 'DOM.getDocument') result = { root: { nodeId: 1 } };
        else if (request.method === 'DOM.querySelector') result = { nodeId: options.noNode ? 0 : currentNodeId };
        else if (request.method === 'DOM.setFileInputFiles') {
          assert.equal(request.params.nodeId, currentNodeId);
          assert.deepEqual(request.params.files, [fixture]);
        } else if (request.method === 'Page.captureScreenshot') result = { data: Buffer.from('mock-png').toString('base64') };
        const response = { id: request.id, result };
        if (request.method === options.errorMethod) {
          delete response.result;
          response.error = { code: -32000, message: 'bad\n' + 'x'.repeat(150), data: 'extra' };
        }
        this.listeners.message({ data: JSON.stringify(response) });
      });
    }
    close() {}
  }
  const fakeFs = {
    readFileSync(file) { assert.match(file, /DevToolsActivePort$/); return '1234\n'; },
    existsSync(file) { assert.equal(file, fixture); return options.fixtureExists !== false; },
    writeFileSync(file, data) { writes.set(file, data); }
  };
  const fakeProcess = { argv: ['node', 'inspector', '--seed', 'profile', fixture, output, 'version', 'snapshot.json'],
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Siiiiimon123/OMC-build-checks',
      GITHUB_REF: 'refs/heads/verify-windows-r1-18', GITHUB_RUN_ATTEMPT: '1' },
    platform: 'win32', arch: 'x64', exitCode: 0, exit() { throw Error('Unexpected process.exit'); } };
  const context = vm.createContext({ fs: fakeFs, path, crypto, process: fakeProcess, Buffer,
    WebSocket: FakeWebSocket, AbortSignal, fetch: async () => ({ json: async () => [
      { type: 'page', url: 'file:/app/dist/index.html', webSocketDebuggerUrl: 'ws://test' } ] }),
    setTimeout: (fn, ms) => setTimeout(fn, ms === 250 ? 1 : ms), clearTimeout,
    console: { log() {} } });
  await vm.runInContext(source, context);
  return { report: JSON.parse(writes.get(output)), events, writes, inputPolls, importButtonPolls, importClicks, exitCode: fakeProcess.exitCode };
}

test('CDP error exposes method, bounded error details and seed stage', async () => {
  const { report, exitCode } = await runSeed({ errorMethod: 'DOM.enable' });
  assert.equal(exitCode, 1);
  assert.equal(report.seedStage, 'set_file_input');
  assert.equal(report.lastCdp.method, 'DOM.enable');
  assert.equal(report.lastCdp.error.code, '-32000');
  assert.equal(report.lastCdp.error.message.length, 100);
  assert.doesNotMatch(report.lastCdp.error.message, /\n/);
  assert.equal(report.lastCdp.error.data, 'extra');
  assert.equal(report.failureCode, `CDP_METHOD_FAILED:DOM.enable:-32000:${report.lastCdp.error.message}`);
});

test('missing start-selection button fails closed before import', async () => {
  const { report, events } = await runSeed({ missingStart: true });
  assert.equal(report.failureCode, 'CONTROL_NOT_READY');
  assert.equal(report.seedStage, 'start_selection');
  assert.ok(!events.some(e => e.method.startsWith('DOM.')));
});

test('waits for import button to become visible and enabled before clicking', async () => {
  const { report, importButtonPolls, importClicks } = await runSeed({ delayImport: true });
  assert.equal(report.status, 'PASS_REAL16_SYNTHETIC_IMPORT_KEEP_AND_SENTINEL');
  assert.ok(importButtonPolls >= 3);
  assert.equal(importClicks, 1);
});

test('waits for async file input, re-queries its node and enables Page before capture', async () => {
  const { report, events, inputPolls, writes } = await runSeed({ inputAfter: 3 });
  assert.equal(report.status, 'PASS_REAL16_SYNTHETIC_IMPORT_KEEP_AND_SENTINEL');
  assert.equal(report.seedStage, 'complete');
  assert.equal(inputPolls, 3);
  const index = method => events.findIndex(e => e.method === method);
  const lastInputPoll = events.map((e, i) => ({ e, i })).filter(({ e }) => e.method === 'Runtime.evaluate' && e.params.expression.includes('input[type=file]')).at(-1).i;
  assert.ok(lastInputPoll < index('DOM.enable'));
  assert.ok(index('DOM.getDocument') < index('DOM.querySelector'));
  assert.ok(index('DOM.querySelector') < index('DOM.setFileInputFiles'));
  assert.ok(index('Page.enable') < index('Page.captureScreenshot'));
  assert.ok(writes.has('snapshot.json'));
  assert.ok(writes.has('report.json.png'));
});

test('missing fixture fails clearly before setting files', async () => {
  const { report, events } = await runSeed({ fixtureExists: false });
  assert.equal(report.failureCode, 'FIXTURE_FILE_NOT_FOUND');
  assert.equal(report.seedStage, 'set_file_input');
  assert.ok(!events.some(e => e.method === 'DOM.setFileInputFiles'));
});

test('missing re-queried node fails before setting files', async () => {
  const { report, events } = await runSeed({ noNode: true });
  assert.equal(report.failureCode, 'REAL_IMPORT_INPUT_NOT_FOUND');
  assert.ok(!events.some(e => e.method === 'DOM.setFileInputFiles'));
});
