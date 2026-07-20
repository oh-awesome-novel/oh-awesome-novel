const { app, BrowserWindow } = require('electron');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let outputDirectory;
let smokeWindow;

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(run).catch(fail);

async function run() {
  const { build } = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  const smokeRoot = __dirname;
  const repositoryRoot = path.resolve(smokeRoot, '../../..');
  const productionClient = path.resolve(repositoryRoot, 'apps/desktop-ui/src/client');
  const mockClient = path.resolve(smokeRoot, 'mock-oan-client.ts');
  outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'oan-play-workspace-smoke-'));

  await build({
    root: smokeRoot,
    base: './',
    logLevel: 'warn',
    plugins: [{
      name: 'oan-renderer-smoke-client',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return null;
        const cleanSource = source.replace(/\?.*$/u, '');
        const cleanImporter = importer.replace(/\?.*$/u, '');
        const candidate = path.isAbsolute(cleanSource)
          ? cleanSource
          : path.resolve(path.dirname(cleanImporter), cleanSource);
        return candidate === productionClient || candidate === `${productionClient}.ts`
          ? mockClient
          : null;
      },
    }, vue()],
    resolve: {
      alias: [
        { find: productionClient, replacement: mockClient },
        { find: `${productionClient}.ts`, replacement: mockClient },
      ],
    },
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
    },
  });

  smokeWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await smokeWindow.loadURL(pathToFileURL(path.join(outputDirectory, 'index.html')).href);
  await waitFor(() => evaluate('Boolean(window.__playRendererSmoke?.ready)'));
  await waitForSelector('.play-session-card');
  await waitForText('.play-transcript', 'latest message 4');

  const summaryTitles = await evaluate(`Array.from(
    document.querySelectorAll('.play-session-title'),
    (node) => node.textContent.trim(),
  )`);
  assertDeepEqual(summaryTitles, [
    'Long-running station journey',
    'Last train character rehearsal',
  ], 'summary read model');

  await waitForText('.play-context-trace-list', '2 of 4 messages selected');
  await waitForText('.play-source-drift-controls', 'Continue frozen');

  await clickButton('Load earlier transcript', '.play-transcript');
  await waitForText('.play-transcript', 'earlier message 1');
  await clickButton('Load earlier events', '.play-event-feed');
  await waitForText('.play-event-feed', 'Earlier event 1');
  await clickButton('Check', '.play-source-drift-controls');
  await waitForCallCount('getPlaySourceDrift', 2);

  const m5 = await evaluate(`({
    selectedSummary: document.querySelector('.play-session-card[aria-current="true"] .play-session-title')?.textContent.trim(),
    transcriptMessages: document.querySelectorAll('.play-transcript .play-turn').length,
    eventCards: document.querySelectorAll('.play-event-list .play-event-card').length,
    traceText: document.querySelector('.play-context-trace-list')?.textContent.replace(/\\s+/gu, ' ').trim(),
    driftButtons: Array.from(
      document.querySelectorAll('.play-source-decision-row button'),
      (button) => button.textContent.trim(),
    ),
  })`);
  assertEqual(m5.selectedSummary, 'Long-running station journey', 'summary selection');
  assertEqual(m5.transcriptMessages, 4, 'transcript cursor prepend');
  assertEqual(m5.eventCards, 4, 'event cursor prepend');
  assertDeepEqual(m5.driftButtons, [
    'Continue frozen',
    'Reassemble',
    'Fork session',
  ], 'source drift controls');
  const cursorRequests = await evaluate(`window.__playRendererSmoke.calls
    .filter((call) => call.method === 'getPlaySessionDetail')
    .map((call) => call.args[1] ?? {})`);
  assertEqual(
    cursorRequests.some((options) =>
      options.transcriptCursor === 'transcript-before-latest'),
    true,
    'transcript opaque cursor request',
  );
  assertEqual(
    cursorRequests.some((options) => options.eventCursor === 'events-before-latest'),
    true,
    'event opaque cursor request',
  );

  await clickSession('Last train character rehearsal');
  await waitForText('.play-rehearsal-workspace', 'Mara keeps the sealed letter');
  await waitForEnabledButton('Modify', '.play-director-controls');
  assertEqual(
    await evaluate(`document.querySelector(
      '.play-session-card[aria-current="true"] .play-session-title',
    )?.textContent.trim()`),
    'Last train character rehearsal',
    'rehearsal summary selection',
  );

  const directorButtons = await evaluate(`Array.from(
    document.querySelectorAll('.play-director-control-row > button'),
    (button) => button.textContent.trim(),
  )`);
  assertDeepEqual(directorButtons, [
    'Accept',
    'Modify',
    'Retry',
    'Insert actor',
    'Grant knowledge',
    'Finish',
    'Cancel',
  ], 'F4 Director controls');

  await clickButton('Modify', '.play-director-controls');
  await waitForText('.play-director-intervention-panel', 'Revise projection');
  await setValue(
    '.play-director-intervention-panel textarea',
    'Mara places the sealed letter inside her coat.',
  );
  await clickButton('Apply intervention', '.play-director-intervention-panel');
  await waitForCallCount('intervenePlayTurnAttempt', 1);
  await waitForText(
    '.play-rehearsal-workspace-announcement',
    'Projection revision applied',
  );
  await waitForText('.play-rehearsal-step[data-status="provisional"]', 'inside her coat');

  const modifyCall = await evaluate(`window.__playRendererSmoke.calls.find(
    (call) => call.method === 'intervenePlayTurnAttempt',
  )`);
  const modifyInput = modifyCall?.args?.[2];
  assertEqual(modifyInput?.kind, 'reviseProjection', 'typed Modify kind');
  assertEqual(modifyInput?.stepRef, 'step-mara-draft', 'typed Modify target');
  assertEqual(
    modifyInput?.expectedEffectFingerprint,
    'effect-fingerprint-mara-1',
    'typed Modify effect fingerprint',
  );
  assertEqual(modifyInput?.replacementBlocks?.length, 2, 'typed Modify evidence closure');
  assertEqual(
    modifyInput?.replacementBlocks?.find((block) => block.id === 'block-mara-visible')?.content,
    'Mara places the sealed letter inside her coat.',
    'typed Modify visible projection',
  );
  assertEqual(
    modifyInput?.replacementBlocks?.find((block) => block.id === 'block-mara-hidden')?.content,
    'The letter names the stationmaster as an informant.',
    'typed Modify hidden projection preservation',
  );

  const harnessState = await evaluate(`({
    errors: window.__playRendererSmoke.errors,
    unexpectedCalls: window.__playRendererSmoke.unexpectedCalls,
    callMethods: window.__playRendererSmoke.calls.map((call) => call.method),
  })`);
  assertDeepEqual(harnessState.errors, [], 'renderer runtime errors');
  assertDeepEqual(harnessState.unexpectedCalls, [], 'unexpected client calls');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    component: 'apps/desktop-ui/src/components/play/PlayWorkspace.vue',
    summaryTitles,
    m5,
    directorButtons,
    typedModify: {
      kind: modifyInput.kind,
      stepRef: modifyInput.stepRef,
      replacementBlockCount: modifyInput.replacementBlocks.length,
    },
    callMethods: harnessState.callMethods,
  })}\n`);
  await cleanup();
  app.exit(0);
}

async function clickSession(title) {
  const clicked = await evaluate(`(() => {
    const title = ${JSON.stringify(title)};
    const card = Array.from(document.querySelectorAll('.play-session-card')).find(
      (candidate) => candidate.querySelector('.play-session-title')?.textContent.trim() === title,
    );
    if (!card || card.disabled) return false;
    card.click();
    return true;
  })()`);
  assertEqual(clicked, true, `click session ${title}`);
  await delay(20);
}

async function clickButton(label, scopeSelector = 'body') {
  const clicked = await evaluate(`(() => {
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    const label = ${JSON.stringify(label)};
    const button = scope && Array.from(scope.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.replace(/\\s+/gu, ' ').trim() === label,
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assertEqual(clicked, true, `click ${label}`);
  await delay(20);
}

async function setValue(selector, value) {
  const updated = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return false;
    }
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
      element,
      ${JSON.stringify(value)},
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assertEqual(updated, true, `set value ${selector}`);
  await delay(20);
}

async function waitForSelector(selector) {
  await waitFor(() => evaluate(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
  ));
}

async function waitForText(selector, expected) {
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(selector)})
    ?.textContent.includes(${JSON.stringify(expected)}) === true`));
}

async function waitForEnabledButton(label, scopeSelector) {
  await waitFor(() => evaluate(`(() => {
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    const button = scope && Array.from(scope.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.replace(/\\s+/gu, ' ').trim() === ${JSON.stringify(label)},
    );
    return Boolean(button && !button.disabled);
  })()`));
}

async function waitForCallCount(method, count) {
  await waitFor(() => evaluate(`window.__playRendererSmoke.calls.filter(
    (call) => call.method === ${JSON.stringify(method)},
  ).length >= ${count}`));
}

async function waitFor(check, attempts = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await delay(20);
  }
  const state = smokeWindow && !smokeWindow.isDestroyed()
    ? await evaluate(`({
        body: document.body.innerText.slice(0, 3000),
        smoke: window.__playRendererSmoke,
      })`).catch(() => undefined)
    : undefined;
  throw new Error(`Renderer smoke timed out. ${JSON.stringify(state)}`);
}

function evaluate(source) {
  return smokeWindow.webContents.executeJavaScript(source);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cleanup() {
  if (smokeWindow && !smokeWindow.isDestroyed()) smokeWindow.destroy();
  smokeWindow = undefined;
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
  outputDirectory = undefined;
}

async function fail(error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
}
