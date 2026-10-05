const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtemp, realpath, stat, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const REQUIRED = {
  write: ['packaged-renderer-preload', 'ui-create-workspace-real-git', 'ui-import-approval-canonical-boundary',
    'sdk-http-sse-bash-candidate', 'ui-diff-before-canonical-write', 'ui-accept-real-git-scoped-commit',
    'ui-markdown-txt-download', 'pending-and-receipt-persisted'],
  reopen: ['packaged-renderer-preload', 'process-restart-canonical-and-git', 'process-restart-accepted-receipt',
    'process-restart-pending-candidate', 'ui-reject-no-canonical-or-git-write', 'ui-markdown-txt-download'],
};

if (require.main === module) void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((argument) => !argument.startsWith('--'));
  if (positional.length > 1 || args.some((argument) => argument.startsWith('--') && argument !== '--no-sandbox')) {
    throw new Error('Usage: node packaged-main-smoke/run.cjs [packaged directory or executable] [--no-sandbox]');
  }
  const executable = await findPackagedExecutable(path.resolve(positional[0] ?? path.join(__dirname, '../../../apps/desktop/out')));
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'oan-packaged-journey-')));
  const token = randomBytes(32).toString('hex');
  await writeFile(path.join(root, 'runner.json'), JSON.stringify({ schemaVersion: 1, token }));
  await writeFile(path.join(root, 'gitconfig'), '');
  const env = createSmokeEnvironment(root);
  try {
    const reports = [];
    for (const phase of ['write', 'reopen']) {
      reports.push(await runPhase(executable, ['--oan-packaged-main-smoke=1', `--oan-smoke-root=${root}`,
        `--oan-smoke-token=${token}`, `--oan-smoke-phase=${phase}`, ...(args.includes('--no-sandbox') ? ['--no-sandbox'] : [])], env, phase));
    }
    const evidence = JSON.parse(await readFile(path.join(root, 'evidence.json'), 'utf8'));
    if (evidence.schemaVersion !== 1 || evidence.providerRequests !== 4 || !/^[a-f0-9]{64}$/u.test(evidence.chapterHash)
      || !/^[a-f0-9]{64}$/u.test(evidence.receiptHash) || !/^[a-f0-9]{40}$/u.test(evidence.head)) throw new Error('Missing cross-process persistence evidence.');
    process.stdout.write(`${JSON.stringify({ ok: true, component: 'packaged-writing-journey-complete',
      platform: process.platform, arch: process.arch, processes: 2, checks: reports.flatMap((report) => report.checks),
      providerRequests: evidence.providerRequests, canonicalHash: evidence.chapterHash, receiptHash: evidence.receiptHash, gitHead: evidence.head })}\n`);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}

async function runPhase(executable, args, env, phase) {
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let timedOut = false;
  // Full renderer/SDK/Git/download checks need more time than the old VFS-only
  // 30 s smoke. Individual HTTP requests and UI waits are bounded separately.
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 180_000);
  child.stdout.on('data', (chunk) => { const value = chunk.toString(); stdout += value; process.stdout.write(value); if (stdout.length > 4 * 1024 * 1024) child.kill('SIGKILL'); });
  child.stderr.on('data', (chunk) => { const value = chunk.toString(); stderr += value; process.stderr.write(value); if (stderr.length > 4 * 1024 * 1024) child.kill('SIGKILL'); });
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } finally { clearTimeout(timeout); }
  if (result.code !== 0 || result.signal || timedOut) throw new Error(`Packaged ${phase} process failed: code=${result.code}, signal=${result.signal}, timeout=${timedOut}.\n${stderr.slice(-4000)}`);
  return parsePhaseReport(stdout, phase);
}

function parsePhaseReport(stdout, phase) {
  const reports = stdout.split(/\r?\n/u).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((value) => value?.component === 'packaged-writing-journey');
  const report = reports[0];
  if (reports.length !== 1 || report?.ok !== true || report.phase !== phase || report.platform !== process.platform
    || report.arch !== process.arch || report.provider !== 'deterministic-local-http' || report.rendererErrors !== 0 || report.blockedNetwork !== 0
    || !Array.isArray(report.checks) || REQUIRED[phase].some((check) => !report.checks.includes(check))) {
    throw new Error(`Packaged ${phase} process did not provide its complete verified journey report.`);
  }
  return report;
}

async function findPackagedExecutable(input, platform = process.platform, arch = process.arch) {
  const info = await stat(input);
  if (info.isFile()) return input;
  const relativeExecutable = platform === 'darwin' ? 'oan.app/Contents/MacOS/oan' : platform === 'win32' ? 'oan.exe' : 'oan';
  const candidates = [path.join(input, relativeExecutable), path.join(input, `oan-${platform}-${arch}`, relativeExecutable),
    ...(platform === 'darwin' && input.endsWith('.app') ? [path.join(input, 'Contents/MacOS/oan')] : [])];
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`No ${platform}/${arch} packaged oan executable found at ${input}. Run the desktop package command first.`);
}

function createSmokeEnvironment(root, inherited = process.env) {
  const env = { ...inherited };
  // Inherited Git object/index/worktree overrides can redirect writes even
  // when every command uses -C. Start with only this fixture's Git settings.
  for (const key of Object.keys(env)) if (key.startsWith('OAN_') || key.startsWith('GIT_')) delete env[key];
  for (const key of ['OPENAI_API_KEY', 'AI_GATEWAY_API_KEY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  return { ...env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0',
    GIT_AUTHOR_NAME: 'OAN Packaged Smoke', GIT_AUTHOR_EMAIL: 'packaged-smoke@example.invalid',
    GIT_COMMITTER_NAME: 'OAN Packaged Smoke', GIT_COMMITTER_EMAIL: 'packaged-smoke@example.invalid' };
}

module.exports = { findPackagedExecutable, parsePhaseReport, createSmokeEnvironment, REQUIRED };
