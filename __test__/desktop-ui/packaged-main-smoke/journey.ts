import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { App, BrowserWindow as ElectronWindow } from 'electron';
import { startNovelHttpBackend, type NovelBackendHandle } from '@oh-awesome-novel/backend';

const execFileAsync = promisify(execFile);
const CHAPTER = 'chapters/0001/0001.md';
const APPROVED = '冒烟验收：林安推开旧城的门，晨光落在书页上。';
const REJECTED = '这段候选将在重启后拒绝，不能进入正文。';
const API_KEY = 'packaged-smoke-local-only';
const MODEL = 'oan-packaged-smoke-local';
interface Action { id: string; status: string; diff: string; git?: { status: string; commit?: string }; changes: Array<{ operation: string; path: string }> }
interface ActionEnvelope { pendingAction: Action }
interface Evidence {
  schemaVersion: 1; workspaceRoot: string; acceptedId: string; pendingId: string;
  chapterHash: string; receiptHash: string; head: string; providerRequests: number;
}
interface DesktopContext {
  app: App;
  BrowserWindow: typeof ElectronWindow;
  rendererPath: string;
  preloadPath: string;
  setWorkspacePickerPath(path: string): void;
}

/** Executed only behind the explicit packaged smoke flag, using a runner-owned
 * temporary root. There are no model/repository/store mocks in this journey. */
export async function runPackagedWritingJourney(context: DesktopContext) {
  const fixture = await readRunnerFixture();
  check(context.app.isPackaged, 'This journey must run from a packaged Electron application.');
  await mkdir(path.join(fixture.root, 'electron'), { recursive: true });
  context.app.setPath('userData', path.join(fixture.root, 'electron'));
  context.setWorkspacePickerPath(path.join(fixture.root, 'novel'));
  await context.app.whenReady();
  const rendererErrors: string[] = [];
  const blockedNetwork: string[] = [];
  let backend: NovelBackendHandle | undefined;
  let window: ElectronWindow | undefined;
  let provider: Awaited<ReturnType<typeof startLocalProvider>> | undefined;
  try {
    backend = await startNovelHttpBackend({ globalConfigDir: path.join(fixture.root, 'config') });
    if (fixture.phase === 'write') {
      provider = await startLocalProvider();
      await json(backend.url, '/api/provider-config', { id: 'packaged-smoke', kind: 'custom', model: MODEL,
        baseUrl: `${provider.url}/v1`, apiKey: API_KEY, default: true });
    }
    window = new context.BrowserWindow({ show: false, width: 1360, height: 1000, webPreferences: {
      preload: context.preloadPath, additionalArguments: [`--oan-backend-base-url=${backend.url}`],
      contextIsolation: true, nodeIntegration: false,
    } });
    window.webContents.on('console-message', (details) => { if (details.level === 'error') rendererErrors.push(details.message); });
    window.webContents.on('render-process-gone', (_event, details) => { rendererErrors.push(`Renderer exited: ${details.reason}`); });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const allowed = ['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol)
        || (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === backend?.url);
      if (!allowed) blockedNetwork.push(url.origin);
      callback({ cancel: !allowed });
    });
    await window.loadFile(context.rendererPath);
    const ui = rendererDriver(window);
    await ui.waitFor('preload bridge', `typeof window.ohAwesomeNovel?.backendBaseUrl === 'string'`);
    const bridgeUrl = await ui.evaluate<string>('window.ohAwesomeNovel.backendBaseUrl');
    check(bridgeUrl === backend.url, 'Packaged preload did not expose the real isolated backend.');
    const checks: string[] = ['packaged-renderer-preload'];
    if (fixture.phase === 'write') {
      await writeJourney(fixture.root, backend.url, ui, checks, provider!);
    } else {
      await reopenJourney(fixture.root, backend.url, ui, checks);
    }
    check(blockedNetwork.length === 0, `Renderer attempted non-fixture network access: ${blockedNetwork.join(', ')}`);
    check(rendererErrors.length === 0, `Packaged renderer errors: ${rendererErrors.join('\n')}`);
    return { ok: true, component: 'packaged-writing-journey', phase: fixture.phase, platform: process.platform,
      arch: process.arch, checks, provider: 'deterministic-local-http', rendererErrors: 0, blockedNetwork: 0 };
  } catch (error) {
    if (window && !window.isDestroyed()) {
      const visible = await window.webContents.executeJavaScript('document.body?.innerText.slice(0, 5000)').catch(() => 'Renderer unavailable.');
      process.stderr.write(`Packaged ${fixture.phase} renderer at failure:\n${String(visible)}\n`);
    }
    throw error;
  } finally {
    window?.destroy();
    await backend?.close();
    await provider?.close();
  }
}

async function writeJourney(root: string, baseUrl: string, ui: ReturnType<typeof rendererDriver>, checks: string[], provider: Awaited<ReturnType<typeof startLocalProvider>>) {
  await ui.waitFor('workspace launcher', 'Boolean(document.querySelector(".launcher-main"))');
  await ui.clickText('新建', '.launcher-main');
  await ui.waitFor('new workspace guide', 'Boolean(document.querySelector(".onboarding-guide"))');
  const workspaceRoot = await realpath(path.join(root, 'novel'));
  const status = await json<{ git: { available: boolean; repository: boolean; head?: string } }>(baseUrl, '/api/workspace/status');
  check(status.git.available && status.git.repository && Boolean(status.git.head), 'UI-created workspace has no usable real Git baseline.');
  checks.push('ui-create-workspace-real-git');
  await ui.clickText('跳过', '.onboarding-guide');
  await ui.waitFor('writing composer', 'Boolean(document.querySelector("#agent-composer-input"))');

  // Establish an existing author chapter through the public deterministic
  // import workflow so the writing UI can select a trusted exact edit target.
  await ui.click('[aria-label="导入旧稿 Markdown"]');
  await ui.setValue('#manuscript-text', '# 第一章 旧城\n\n林安停在旧城门前。\n');
  await ui.clickText('拆章并预览', '[role="dialog"][aria-label="导入旧稿 Markdown"]');
  await ui.waitFor('import preview', 'Boolean(document.querySelector("[aria-label=旧稿导入预览]"))');
  await absent(path.join(workspaceRoot, CHAPTER));
  await ui.clickText('创建待审批导入', '[role="dialog"][aria-label="导入旧稿 Markdown"]');
  await ui.waitFor('import approval', `Boolean(document.querySelector('[aria-label="PendingAction approval"] .pending-card'))`);
  const imported = await onlyPending(baseUrl);
  check(imported.changes.length === 1 && imported.changes[0]?.path === CHAPTER && imported.changes[0].operation === 'create', 'Import did not propose the selected new chapter.');
  await absent(path.join(workspaceRoot, CHAPTER));
  await ui.clickText('Accept', '[aria-label="PendingAction approval"]');
  await waitUntil('import acceptance', async () => (await readAction(baseUrl, imported.id)).pendingAction.status === 'accepted');
  check((await readAction(baseUrl, imported.id)).pendingAction.git?.status === 'committed', 'Initial accepted chapter was not committed.');
  const baseline = await readFile(path.join(workspaceRoot, CHAPTER), 'utf8');
  checks.push('ui-import-approval-canonical-boundary');

  await ui.click('[aria-label="Chapters"]');
  await ui.waitFor('chapter row', 'Boolean(document.querySelector(".chapter-row"))');
  await ui.click('.chapter-row');
  await ui.waitFor('selected source viewer', `Boolean(document.querySelector('[aria-label="File viewer"]')) || document.body.innerText.includes('chapters/0001/0001.md')`);
  await ui.setValue('#agent-composer-input', '写当前章节：追加一段旧城晨光。[smoke-approve]');
  await ui.click('[aria-label="Send message"]');
  await waitUntil('SDK writing proposal', async () => (await pending(baseUrl)).length === 1);
  await ui.waitFor('SDK chat completed', '!document.querySelector("#agent-composer-input")?.disabled');
  const writing = await onlyPending(baseUrl);
  check(writing.changes.length === 1 && writing.changes[0]?.operation === 'update' && writing.changes[0].path === CHAPTER, 'SDK bash writing did not yield the expected chapter update.');
  check(writing.diff.includes(APPROVED), 'Writing diff omits the model-generated candidate text.');
  check(await readFile(path.join(workspaceRoot, CHAPTER), 'utf8') === baseline, 'SDK candidate changed canonical bytes before review.');
  await ui.click('[aria-label="Pending actions"]');
  await ui.waitFor('writing approval', `Boolean(document.querySelector('[aria-label="PendingAction approval"] .pending-card'))`);
  await ui.clickText('Diff', '[aria-label="PendingAction approval"]');
  await ui.waitFor('real renderer candidate diff', `document.querySelector('[aria-label="PendingAction diff text"]')?.textContent.includes(${JSON.stringify(APPROVED)}) === true`);
  check(await readFile(path.join(workspaceRoot, CHAPTER), 'utf8') === baseline, 'Opening the renderer diff materialized a candidate.');
  await ui.click('[aria-label="Pending actions"]');
  await ui.clickText('Accept', '[aria-label="PendingAction approval"]');
  await waitUntil('writing acceptance', async () => (await readAction(baseUrl, writing.id)).pendingAction.status === 'accepted');
  const accepted = await readAction(baseUrl, writing.id);
  check(accepted.pendingAction.git?.status === 'committed', 'Writing Accept did not produce an automatic Git commit.');
  const chapter = await readFile(path.join(workspaceRoot, CHAPTER), 'utf8');
  check(chapter === `${baseline}\n${APPROVED}\n`, 'Accepted canonical content differs from the approved SDK candidate.');
  const head = await git(workspaceRoot, 'rev-parse', 'HEAD');
  check(head === accepted.pendingAction.git.commit, 'Receipt Git commit does not match the real repository HEAD.');
  check(await git(workspaceRoot, 'show', '--format=', '--name-only', 'HEAD') === CHAPTER, 'Automatic commit included files outside the accepted chapter.');
  // Accept refreshes the selected source viewer after its HTTP result. Wait
  // for that visible completion before beginning a new navigation action.
  await ui.waitFor('renderer accepted-source refresh', `document.querySelector('[aria-label="File viewer"] pre')?.textContent.includes(${JSON.stringify(APPROVED)}) === true`);
  await ui.click('[aria-label="Git"]');
  await ui.waitFor('Git history in real renderer', 'Boolean(document.querySelector(".git-log-row"))');
  checks.push('sdk-http-sse-bash-candidate', 'ui-diff-before-canonical-write', 'ui-accept-real-git-scoped-commit');
  await assertExports(root, baseUrl, ui, chapter, checks);

  // Leave a second candidate pending for a completely separate app process.
  await ui.click('[aria-label="Chapters"]');
  await ui.click('.chapter-row');
  await ui.setValue('#agent-composer-input', '写当前章节：提出另一段文字供拒绝测试。[smoke-reject]');
  await ui.click('[aria-label="Send message"]');
  await waitUntil('persisted pending candidate', async () => (await pending(baseUrl)).length === 1);
  await ui.waitFor('second SDK chat completed', '!document.querySelector("#agent-composer-input")?.disabled');
  const second = await onlyPending(baseUrl);
  check(second.diff.includes(REJECTED), 'Restart candidate has unexpected content.');
  check(await readFile(path.join(workspaceRoot, CHAPTER), 'utf8') === chapter, 'Unaccepted restart candidate changed canonical bytes.');
  check(provider.requests === 4 && provider.toolRequests === 2, `Expected two real SDK tool/final-text steps per turn, saw ${provider.requests}/${provider.toolRequests}.`);
  const receiptHash = sha256(await readFile(path.join(workspaceRoot, '.workspace/change-engine/v1/receipts', `${writing.id}.json`), 'utf8'));
  const evidence: Evidence = { schemaVersion: 1, workspaceRoot, acceptedId: writing.id, pendingId: second.id, chapterHash: sha256(chapter), receiptHash, head, providerRequests: provider.requests };
  await writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence));
  checks.push('pending-and-receipt-persisted');
}

async function reopenJourney(root: string, baseUrl: string, ui: ReturnType<typeof rendererDriver>, checks: string[]) {
  const evidence = JSON.parse(await readFile(path.join(root, 'evidence.json'), 'utf8')) as Evidence;
  check(evidence.schemaVersion === 1 && evidence.workspaceRoot === await realpath(path.join(root, 'novel')), 'Restart evidence belongs to another workspace.');
  await ui.waitFor('persisted launcher workspace', 'Boolean(document.querySelector(".project-row"))');
  await ui.evaluate('document.querySelector(".project-row").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await ui.waitFor('reopened writing workspace', 'Boolean(document.querySelector(".workspace-toolbar"))');
  check(sha256(await readFile(path.join(evidence.workspaceRoot, CHAPTER), 'utf8')) === evidence.chapterHash, 'Canonical chapter changed across application restart.');
  const accepted = await readAction(baseUrl, evidence.acceptedId);
  check(accepted.pendingAction.status === 'accepted' && accepted.pendingAction.git?.status === 'committed' && accepted.pendingAction.git.commit === evidence.head, 'Accepted receipt was not persisted across process restart.');
  check(sha256(await readFile(path.join(evidence.workspaceRoot, '.workspace/change-engine/v1/receipts', `${evidence.acceptedId}.json`), 'utf8')) === evidence.receiptHash, 'Decision receipt bytes changed across restart.');
  check(await git(evidence.workspaceRoot, 'rev-parse', 'HEAD') === evidence.head, 'Real Git history changed across restart.');
  const action = await onlyPending(baseUrl);
  check(action.id === evidence.pendingId && action.diff.includes(REJECTED), 'Pending candidate did not survive application restart.');
  await ui.click('[aria-label="Pending actions"]');
  await ui.waitFor('restored approval in renderer', `Boolean(document.querySelector('[aria-label="PendingAction approval"] .pending-card'))`);
  await ui.clickText('Reject', '[aria-label="PendingAction approval"]');
  await waitUntil('rejection persisted', async () => (await readAction(baseUrl, action.id)).pendingAction.status === 'rejected');
  const chapter = await readFile(path.join(evidence.workspaceRoot, CHAPTER), 'utf8');
  check(sha256(chapter) === evidence.chapterHash && !chapter.includes(REJECTED), 'Reject changed canonical chapter content.');
  check(await git(evidence.workspaceRoot, 'rev-parse', 'HEAD') === evidence.head, 'Reject created or changed a Git commit.');
  checks.push('process-restart-canonical-and-git', 'process-restart-accepted-receipt', 'process-restart-pending-candidate', 'ui-reject-no-canonical-or-git-write');
  await assertExports(root, baseUrl, ui, chapter, checks);
}

async function assertExports(root: string, baseUrl: string, ui: ReturnType<typeof rendererDriver>, chapter: string, checks: string[]) {
  await mkdir(path.join(root, 'exports'), { recursive: true });
  await ui.click('[aria-label="Export manuscript"]');
  for (const format of ['md', 'txt'] as const) {
    const exported = await json<{ content: string; chapterPaths: string[] }>(baseUrl, `/api/workspace/manuscript/export?format=${format}`);
    check(exported.chapterPaths.join() === CHAPTER && exported.content.includes(APPROVED) && !exported.content.includes(REJECTED), `Invalid ${format} export source coverage.`);
    check(!exported.content.includes('volume: 1') && !exported.content.includes('chapter: 1'), 'Export leaked chapter frontmatter.');
    const outputPath = path.join(root, 'exports', `verified-${format}.${format}`);
    const downloaded = ui.download(outputPath);
    await ui.clickText(format === 'md' ? '下载 Markdown' : '下载 TXT', '[role="dialog"][aria-label="Export manuscript"]');
    await downloaded;
    check(await readFile(outputPath, 'utf8') === exported.content, `Renderer ${format} download bytes differ from canonical export API.`);
  }
  await ui.click('[aria-label="Close export"]');
  check(chapter.includes(APPROVED), 'Export ran without the accepted source.');
  checks.push('ui-markdown-txt-download');
}

function rendererDriver(window: ElectronWindow) {
  const evaluate = <T = unknown>(source: string): Promise<T> => window.webContents.executeJavaScript(source);
  async function waitFor(label: string, source: string) { await waitUntil(label, async () => Boolean(await evaluate(source))); }
  async function click(selector: string) {
    await waitFor(`enabled ${selector}`, `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  async function clickText(label: string, scope = 'body') {
    const expression = `Array.from(document.querySelector(${JSON.stringify(scope)})?.querySelectorAll('button') ?? []).find(button => button.textContent.replace(/\\s+/gu, ' ').trim() === ${JSON.stringify(label)} && !button.disabled)`;
    await waitFor(`button ${label}`, `Boolean(${expression})`);
    await evaluate(`(${expression}).click()`);
  }
  async function setValue(selector: string, value: string) {
    await waitFor(`input ${selector}`, `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`);
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  function download(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.webContents.session.removeListener('will-download', onDownload); reject(new Error('Renderer download timed out.')); }, 20_000);
      const onDownload = (_event: Electron.Event, item: Electron.DownloadItem) => {
        item.setSavePath(outputPath);
        item.once('done', (_doneEvent, state) => { clearTimeout(timer); if (state === 'completed') resolve(); else reject(new Error(`Renderer download ${state}.`)); });
      };
      window.webContents.session.once('will-download', onDownload);
    });
  }
  return { evaluate, waitFor, click, clickText, setValue, download };
}

async function startLocalProvider() {
  let requests = 0; let toolRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      check(request.method === 'POST' && request.url === '/v1/chat/completions', 'Unexpected provider route.');
      check(request.headers.authorization === `Bearer ${API_KEY}`, 'The default SDK resolver did not send the fixture API key.');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; check(size <= 4 * 1024 * 1024, 'Provider request exceeds smoke limit.'); chunks.push(bytes); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; model?: string; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name?: string } }> };
      check(body.stream === true && body.model === MODEL && Array.isArray(body.messages), 'Default SDK streaming/model contract changed.');
      requests++;
      check(requests <= 4, 'Unexpected additional model step.');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const toolResult = body.messages.at(-1)?.role === 'tool';
      const rejected = JSON.stringify(body.messages.filter((message) => message.role === 'user').at(-1)).includes('[smoke-reject]');
      const delta = toolResult ? { role: 'assistant', content: '候选已准备好，请审阅差异后接受或拒绝。' } : { role: 'assistant', tool_calls: [{ index: 0, id: `smoke-call-${requests}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: `printf '\\n${rejected ? REJECTED : APPROVED}\\n' >> ${CHAPTER}` }) } }] };
      if (!toolResult) { check(body.tools?.some((tool) => tool.function?.name === 'bash'), 'The actual SDK request did not expose the sandbox bash tool.'); toolRequests++; }
      const base = { id: `chatcmpl-smoke-${requests}`, object: 'chat.completion.chunk', created: 1_700_000_000, model: MODEL };
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: toolResult ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 64, completion_tokens: 32, total_tokens: 96 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) { if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error), type: 'smoke_failure' } })); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); check(address && typeof address !== 'string', 'Local provider did not bind.');
  return { url: `http://127.0.0.1:${address.port}`, get requests() { return requests; }, get toolRequests() { return toolRequests; }, close: () => closeServer(server) };
}

async function readRunnerFixture() {
  const argument = (name: string) => process.argv.find((value) => value.startsWith(`--oan-smoke-${name}=`))?.slice(`--oan-smoke-${name}=`.length);
  const rootArgument = argument('root'); const token = argument('token'); const phase = argument('phase');
  check(rootArgument && /^[a-f0-9]{64}$/u.test(token ?? '') && (phase === 'write' || phase === 'reopen'), 'Run the packaged journey with __test__/desktop-ui/packaged-main-smoke/run.cjs.');
  const root = await realpath(rootArgument);
  check(root === path.resolve(rootArgument) && /^oan-packaged-journey-/u.test(path.basename(root)) && await realpath(path.dirname(root)) === await realpath(tmpdir()), 'Smoke root must be a runner-owned direct temporary directory.');
  check((await lstat(root)).isDirectory(), 'Invalid smoke root.');
  const marker = JSON.parse(await readFile(path.join(root, 'runner.json'), 'utf8')) as { token?: string; schemaVersion?: number };
  check(marker.schemaVersion === 1 && marker.token === token, 'Smoke root ownership token mismatch.');
  return { root, phase };
}
async function json<T = Record<string, unknown>>(baseUrl: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  const result = await response.json(); check(response.ok, `${route}: ${response.status} ${JSON.stringify(result)}`); return result as T;
}
async function pending(baseUrl: string) { return (await json<{ pendingActions: Action[] }>(baseUrl, '/api/workspace/pending-actions')).pendingActions; }
async function onlyPending(baseUrl: string) { const actions = await pending(baseUrl); check(actions.length === 1, `Expected exactly one PendingAction, received ${actions.length}.`); return actions[0]!; }
async function readAction(baseUrl: string, id: string) { return json<ActionEnvelope>(baseUrl, `/api/workspace/pending-actions/${encodeURIComponent(id)}`); }
async function absent(file: string) { try { await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; } throw new Error('Canonical target exists before Accept.'); }
async function git(root: string, ...args: string[]) { return (await execFileAsync('git', ['--literal-pathspecs', '-C', root, ...args], { encoding: 'utf8', timeout: 20_000 })).stdout.trim(); }
async function closeServer(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
async function waitUntil(label: string, checkCondition: () => Promise<boolean>) {
  const deadline = Date.now() + 30_000; let lastError: unknown;
  while (Date.now() < deadline) {
    try { if (await checkCondition()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${String(lastError)}` : ''}`);
}
function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
