import fs from 'node:fs';
import assert from 'node:assert/strict';
import { launch } from './normal-cdp.mjs';

const [app, profile, output] = process.argv.slice(2);
fs.mkdirSync(profile);
const client = await launch(app, profile);
let state;
try {
  await client.until("document.querySelector('#root')?.childElementCount > 0 && Boolean(window.electronAPI?.getUpdateStatus)", 45000);
  state = await client.evaluate('window.electronAPI.getUpdateStatus()');
  assert(state?.state === 'idle' && state?.distributionTrust?.platform === 'darwin');
} finally {
  const closed = await client.close();
  assert(closed.code === 0 && closed.normalBrowserClose && closed.descendantsSettled && !closed.cleanupKilled.length);
}
fs.writeFileSync(output, JSON.stringify({status:'PASS_NATIVE_MAC_LAUNCH', updateState:state.state, nativeExit:true})+'\n', {flag:'wx'});
