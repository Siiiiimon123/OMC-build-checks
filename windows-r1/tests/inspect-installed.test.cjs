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
// Instrument each direct call site so adding a new expression without running it
// in one of the three scenarios fails the coverage test. The peer below runs
// the actual expressions the inspector sends; there is no parallel expression list.
let siteCount = 0;
const instrumented = inspector.replace(importLine, '').replace(
  /(?<![.\w])(evaluate|until|click)\(/g,
  (_, name) => `(__sites.add(${siteCount++}),${name})(`
);
const source = `(async () => {\n${instrumented}\n})()`;

function assertJsonOnly(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, 'object', `non-JSON type: ${typeof value}`);
  const proto = Object.getPrototypeOf(value);
  assert.ok(Array.isArray(value) || proto === null || Object.getPrototypeOf(proto) === null,
    'only plain JSON objects and arrays are allowed');
  assert.ok(!seen.has(value), 'cyclic value');
  seen.add(value);
  for (const entry of Object.values(value)) assertJsonOnly(entry, seen);
  seen.delete(value);
}


async function runInspector(options = {}) {
  const mode = options.mode || '--seed';
  const sites = new Set();
  const serializationErrors = [];
  const rendererExceptions = [];
  const events = [];
  const writes = new Map();
  let inputPolls = 0;
  let started = false;
  let imported = mode === '--restore';
  let selected = false;
  let kept = mode === '--restore';
  let importButtonPolls = 0;
  let startButtonPolls = 0;
  let startClicks = 0;
  let restoreViewPolls = 0;
  let fakeNow = Date.now();
  class FakeDate extends Date { static now() { return fakeNow; } }
  let importClicks = 0;
  let currentNodeId = 41;
  const fixture = 'fixture.jpg';
  const output = 'report.json';
  const buttons = [
    { label: '使用此编号开始选片', click() { startClicks++; started = true; } },
    { label: '导入照片', click() { importClicks++; imported = true; } },
    { label: '单图', click() { selected = true; } }
  ].map(b => ({ ...b, offsetWidth: 10, disabled: false,
    innerText: b.label, getAttribute(name) { return name === 'aria-label' ? this.label : null; } }));
  class FakeElement {}
  const root = Object.assign(new FakeElement(), { childElementCount: 1, innerText: 'x'.repeat(560),
    getBoundingClientRect: () => ({ width: 1008, height: 655 }) });
  root.self = root;
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '#root button') return [...buttons, {}, {}];
      if (selector === 'button') {
        if (!started && options.delayStart) {
          startButtonPolls++;
          const startButton = buttons[0];
          startButton.offsetWidth = startButtonPolls === 1 ? 0 : 10;
          startButton.disabled = startButtonPolls === 2;
        }
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
      if (selector === '.photo-tile') return imported && (mode === '--restore' || events.some(e => e.method === 'DOM.setFileInputFiles')) ? [new FakeElement()] : [];
      throw Error(`Unexpected selector: ${selector}`);
    },
    querySelector(selector) {
      if (selector === '#root') return root;
      if (selector === 'input[type=file]') {
        inputPolls++;
        return imported && inputPolls >= (options.inputAfter || 1) ? {} : null;
      }
      if (selector === '.photo-tile') return Object.assign(new FakeElement(), { click() {} });
      if (selector === '.single-photo-view') {
        if (!selected) return null;
        restoreViewPolls++;
        const restored = !options.delayRestore || restoreViewPolls >= 4;
        return Object.assign(new FakeElement(), { dataset: {
          decision: restored && kept ? 'keep' : '', reviewPhotoId: restored ? 'p1' : ''
        } });
      }
      if (selector === '.single-filename') return { innerText: fixture };
      if (selector === '.decision.accept') return { disabled: false, click() { kept = true; } };
      throw Error(`Unexpected selector: ${selector}`);
    }
  };
  const storage = new Map(mode === '--restore' ? [['omc-r1-upgrade-sentinel', 'sentinel']] : []);
  const renderer = vm.createContext({ document, File, localStorage: {
    setItem(key, value) { storage.set(key, value); }, getItem(key) { return storage.get(key) ?? null; }
  } });
  vm.runInContext(`window = { electronAPI: {
    getAiDiagnostics: async () => ({ appVersion: 'version', isPackaged: true }),
    beginAiAnalysis: ${options.syncBegin ? '()' : 'async ()'} => ({ runtimePreparation: { accepted: true } }),
    getAiServiceStatus: async () => ({ port: 4567, token: 'token', lastHealth: { fullAiReady: true } })
  } }`, renderer);
  class FakeWebSocket {
    constructor() { this.listeners = {}; }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
      if (name === 'open') queueMicrotask(() => fn());
    }
    send(text) {
      const request = JSON.parse(text);
      events.push(request);
      queueMicrotask(async () => {
        let result = {};
        if (request.method === 'Runtime.evaluate') {
          let value;
          try {
            assert.equal(request.params.returnByValue, true);
            value = await vm.runInContext(request.params.expression, renderer);
          } catch (e) {
            rendererExceptions.push(e.message);
            result = { exceptionDetails: { text: e.message }, result: {} };
          }
          if (!result.exceptionDetails) {
            try {
              assertJsonOnly(value);
              result = { result: { value: JSON.parse(JSON.stringify(value)) } };
            } catch (e) {
              serializationErrors.push(e.message);
              result = { exceptionDetails: { text: e.message }, result: {} };
            }
          }
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
    readFileSync(file) {
      if (/DevToolsActivePort$/.test(file)) return '1234\n';
      if (file === fixture) return Buffer.from('synthetic fixture');
      if (file === 'snapshot.json') return JSON.stringify({ sentinel: 'sentinel', state: { photoId: 'p1', fileName: fixture, decision: 'keep' } });
      throw Error(`Unexpected read: ${file}`);
    },
    existsSync(file) { assert.equal(file, fixture); return options.fixtureExists !== false; },
    writeFileSync(file, data) { writes.set(file, data); }
  };
  const fakeProcess = { argv: ['node', 'inspector', mode, 'profile', fixture, output, 'version', 'snapshot.json'],
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Siiiiimon123/OMC-build-checks',
      GITHUB_REF: 'refs/heads/verify-windows-r1-18', GITHUB_RUN_ATTEMPT: '1' },
    platform: 'win32', arch: 'x64', exitCode: 0, exit() { throw Error('Unexpected process.exit'); } };
  const context = vm.createContext({ fs: fakeFs, path, crypto, process: fakeProcess, Buffer, Date: FakeDate,
    __sites: sites, FormData, Blob, WebSocket: FakeWebSocket, AbortSignal,
    fetch: async (url, request) => {
      if (url.endsWith('/json/list')) return { json: async () => [
        { type: 'page', url: 'file:/app/dist/index.html', webSocketDebuggerUrl: 'ws://test' } ] };
      assert.match(url, /\/analyze\/photo$/);
      const fields = Object.fromEntries([...request.body.entries()].filter(([key]) => key !== 'image'));
      return { ok: true, json: async () => ({ available: true, technical: { available: true,
        qualityReference: { available: true }, defectProbabilities: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, 0.5])) },
        themes: { available: true, sportsEventPrediction: { available: true } }, feature_hash: fields.asset_id,
        analysis_input_identity: { ...fields, input_sha256: fields.asset_id }, runtime: { provider_id: 'fake' } }) };
    },
    setTimeout: (fn, ms) => {
      if (ms === 250) return setTimeout(() => { fakeNow += 250; fn(); }, 1);
      return setTimeout(fn, ms);
    }, clearTimeout,
    console: { log() {} } });
  const script = options.injectExpression === undefined ? source : source.replace(
    "await call('Runtime.enable');", `await call('Runtime.enable');await evaluate(${JSON.stringify(options.injectExpression)});`
  );
  await vm.runInContext(script, context);
  return { report: JSON.parse(writes.get(output)), events, writes, sites, serializationErrors, rendererExceptions, inputPolls, importButtonPolls, importClicks, startButtonPolls, startClicks, restoreViewPolls, exitCode: fakeProcess.exitCode };
}

test('CDP error exposes method, bounded error details and seed stage', async () => {
  const { report, exitCode } = await runInspector({ errorMethod: 'DOM.enable' });
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
  const { report, events } = await runInspector({ missingStart: true });
  assert.equal(report.failureCode, 'RENDERER_CONDITION_TIMEOUT');
  assert.equal(report.seedStage, 'start_selection');
  assert.ok(!events.some(e => e.method.startsWith('DOM.')));
});

test('waits for start-selection button to become visible and enabled before clicking', async () => {
  const { report, rendererExceptions, startButtonPolls, startClicks } = await runInspector({ delayStart: true });
  assert.equal(report.status, 'PASS_REAL16_SYNTHETIC_IMPORT_KEEP_AND_SENTINEL', JSON.stringify({report, rendererExceptions}));
  assert.ok(startButtonPolls >= 3);
  assert.equal(startClicks, 1);
});

test('waits for restored photo identity and decision after single-view node appears', async () => {
  const { report, restoreViewPolls } = await runInspector({ mode: '--restore', delayRestore: true });
  assert.equal(report.status, 'PASS_REAL16_TO18_PROJECT_KEEP_FULL_AI', JSON.stringify(report));
  assert.ok(restoreViewPolls >= 4);
  assert.equal(report.restored.photoId, 'p1');
  assert.equal(report.restored.decision, 'keep');
});

test('accepts a synchronous beginAiAnalysis result as well as a promise', async () => {
  const { report } = await runInspector({ mode: '--inspect', syncBegin: true });
  assert.equal(report.status, 'PASS_INSTALLED18_REAL_ROOT_FULL_AI', JSON.stringify(report));
});

test('the only direct Runtime.evaluate call belongs to the JSON wrapper', () => {
  const directCalls = /\bcall\s*\(\s*(['"])Runtime\.evaluate\1/g;
  const wrapperStart = inspector.indexOf('const evaluate=');
  const wrapperEnd = inspector.indexOf('const until=', wrapperStart);
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart, 'locate the evaluate wrapper');
  assert.equal([...inspector.matchAll(directCalls)].length, 1, 'one direct Runtime.evaluate call only');
  assert.equal([...inspector.slice(wrapperStart, wrapperEnd).matchAll(directCalls)].length, 1,
    'the direct call must be inside the JSON wrapper');
});

test('waits for import button to become visible and enabled before clicking', async () => {
  const { report, importButtonPolls, importClicks } = await runInspector({ delayImport: true });
  assert.equal(report.status, 'PASS_REAL16_SYNTHETIC_IMPORT_KEEP_AND_SENTINEL', JSON.stringify(report));
  assert.ok(importButtonPolls >= 3);
  assert.equal(importClicks, 1);
});

test('waits for async file input, re-queries its node and enables Page before capture', async () => {
  const { report, events, inputPolls, writes } = await runInspector({ inputAfter: 3 });
  assert.equal(report.status, 'PASS_REAL16_SYNTHETIC_IMPORT_KEEP_AND_SENTINEL', JSON.stringify(report));
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
  const { report, events } = await runInspector({ fixtureExists: false });
  assert.equal(report.failureCode, 'FIXTURE_FILE_NOT_FOUND');
  assert.equal(report.seedStage, 'set_file_input');
  assert.ok(!events.some(e => e.method === 'DOM.setFileInputFiles'));
});

test('missing re-queried node fails before setting files', async () => {
  const { report, events } = await runInspector({ noNode: true });
  assert.equal(report.failureCode, 'REAL_IMPORT_INPUT_NOT_FOUND');
  assert.ok(!events.some(e => e.method === 'DOM.setFileInputFiles'));
});


test('all inspector evaluation call sites run through a JSON-only CDP peer in seed, inspect and restore', async () => {
  const runs = await Promise.all(['--seed', '--inspect', '--restore'].map(mode => runInspector({ mode })));
  for (const { report, events, serializationErrors } of runs) {
    assert.match(report.status, /^PASS_/, JSON.stringify({ report, serializationErrors }));
    assert.deepEqual(serializationErrors, []);
    assert.ok(events.some(e => e.method === 'Runtime.evaluate'));
  }
  const covered = new Set(runs.flatMap(run => [...run.sites]));
  assert.deepEqual([...covered].sort((a, b) => a - b), Array.from({ length: siteCount }, (_, i) => i),
    'every direct evaluate/until/click call site must execute in a scenario');
});

test('rejects DOM nodes, File, functions, and cycles before CDP by-value serialization', async () => {
  for (const [expression, expected] of [
    ['document.querySelector("#root")', 'NON_JSON_OBJECT'],
    ['new File(["x"], "x.txt")', 'NON_JSON_OBJECT'],
    ['(()=>{})', 'NON_JSON_VALUE'],
    ['(()=>{const x={};x.self=x;return x;})()', 'CYCLIC_JSON_VALUE']
  ]) {
    const { report, rendererExceptions, serializationErrors } = await runInspector({ injectExpression: expression });
    assert.equal(report.status, 'FAIL', expression);
    assert.equal(report.failureCode, 'RENDERER_EVALUATION_FAILED');
    assert.deepEqual(rendererExceptions, [expected]);
    assert.deepEqual(serializationErrors, [], 'renderer must reject before returning a value to CDP');
  }
});
