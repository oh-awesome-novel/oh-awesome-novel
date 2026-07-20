const { spawn } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const mainPath = path.join(__dirname, 'main.cjs');
const child = spawn(electronPath, [mainPath], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});
child.on('error', (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  const passed = stdout.split(/\r?\n/u).some((line) => {
    try {
      const result = JSON.parse(line);
      return result?.ok === true && result?.component ===
        'apps/desktop-ui/src/components/play/PlayWorkspace.vue';
    } catch {
      return false;
    }
  });
  if (passed && code === 0 && !signal) return;
  if (!passed) {
    process.stderr.write('Renderer smoke did not emit a verified PlayWorkspace success result.\n');
  }
  process.exitCode = typeof code === 'number' && code !== 0 ? code : 1;
});
