const { spawn } = require('node:child_process');
const { readdir, stat } = require('node:fs/promises');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '../../../apps/desktop');
const outRoot = path.join(desktopRoot, 'out');

void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  const requestedPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : outRoot;
  const requestedStats = await stat(requestedPath);
  const executable = requestedStats.isDirectory()
    ? await findPackagedExecutable(requestedPath)
    : requestedPath;
  const child = spawn(executable, ['--oan-packaged-main-smoke=1'], {
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, exitSignal) => resolve({
      code: exitCode,
      signal: exitSignal,
    }));
  });
  clearTimeout(timeout);
  const result = stdout.split(/\r?\n/u).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  }).find((value) => value?.component === 'sandbox-change-engine');
  if (
    code !== 0
    || signal
    || result?.ok !== true
    || result?.operation !== 'update'
    || result?.path !== 'summaries/smoke.md'
  ) {
    throw new Error(
      `Packaged main smoke failed (code=${String(code)}, signal=${String(signal)}).${stderr ? `\n${stderr}` : ''}`,
    );
  }
}

async function findPackagedExecutable(root) {
  const candidates = [];
  await walk(root, candidates);
  const executable = candidates.find((candidate) =>
    candidate.endsWith('/oan.app/Contents/MacOS/oan'))
    ?? candidates.find((candidate) =>
      candidate.includes('.app/Contents/MacOS/')
        && !candidate.includes('/Frameworks/'))
    ?? candidates.find((candidate) => candidate.endsWith('.exe'))
    ?? candidates.find((candidate) => /-linux-[^/]+\/[^/]+$/u.test(candidate));
  if (!executable) {
    throw new Error(
      `No packaged Electron executable found below ${root}. Run npm run package --workspace @oh-awesome-novel/desktop first.`,
    );
  }
  return executable;
}

async function walk(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(target, files);
    } else if (entry.isFile() && (await stat(target)).mode & 0o111) {
      files.push(target);
    }
  }
}
