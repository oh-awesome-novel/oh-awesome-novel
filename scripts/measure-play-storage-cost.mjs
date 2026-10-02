// Run after: npm run build --workspace @oh-awesome-novel/core
// Uses temporary fixtures only; reports application filesystem calls, not
// physical disk I/O (the OS cache and filesystem metadata are not measured).
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const original = Object.fromEntries(
  ['readFile', 'writeFile', 'appendFile', 'copyFile', 'cp', 'mkdir', 'rm', 'stat', 'readdir']
    .map((name) => [name, fs[name].bind(fs)]),
);
let active;
const locks = new Map();
const byteLength = (data) => typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;

fs.readFile = async (...args) => {
  if (active) active.readAttempts += 1;
  const result = await original.readFile(...args);
  if (active) {
    active.readCalls += 1;
    active.readBytes += byteLength(result);
    active.readPaths.add(String(args[0]));
  }
  return result;
};
fs.writeFile = async (...args) => {
  const result = await original.writeFile(...args);
  if (active) {
    active.writeCalls += 1;
    active.writeBytes += byteLength(args[1]);
    if (basename(String(args[0])) === 'session.yaml') active.metadataWriteCalls += 1;
    if (basename(String(args[0])) === 'transcript.md') active.transcriptWriteBytes += byteLength(args[1]);
  }
  return result;
};
fs.appendFile = async (...args) => {
  const result = await original.appendFile(...args);
  if (active) {
    active.appendCalls += 1;
    active.appendBytes += byteLength(args[1]);
    if (basename(String(args[0])) === 'transcript.md') active.transcriptAppendBytes += byteLength(args[1]);
  }
  return result;
};
async function copiedBytes(path) {
  const information = await original.stat(path);
  if (information.isFile()) return information.size;
  if (!information.isDirectory()) throw new Error('Unexpected copy fixture entry');
  const children = await original.readdir(path);
  return (await Promise.all(children.map((child) => copiedBytes(join(path, child)))))
    .reduce((sum, count) => sum + count, 0);
}
for (const method of ['copyFile', 'cp']) {
  fs[method] = async (...args) => {
    const bytes = active ? await copiedBytes(args[0]) : 0;
    const result = await original[method](...args);
    if (active) {
      active.copyCalls += 1;
      active.copiedBytes += bytes;
    }
    return result;
  };
}
fs.mkdir = async (...args) => {
  const result = await original.mkdir(...args);
  const path = String(args[0]);
  if (active && path.endsWith('.lock') && dirname(path).endsWith('.write-locks')) {
    locks.set(path, performance.now());
  }
  return result;
};
fs.rm = async (...args) => {
  const result = await original.rm(...args);
  const path = String(args[0]);
  if (active && locks.has(path)) {
    active.aggregateLockHoldMs += performance.now() - locks.get(path);
    locks.delete(path);
  }
  return result;
};
syncBuiltinESMExports();

const {
  createPlaySessionDraft,
  listPlaySessionSummaries,
  readPlaySessionFiles,
  readPlaySessionSelectedDetail,
  settlePlayWorldRefereeResponse,
  settlePlayWorldSettlementRetry,
  writePlaySessionFiles,
} = await import('@oh-awesome-novel/core');

function response(step) {
  return [
    `Scene ${step}: ${'A quiet footstep crosses the empty room. '.repeat(12)}`,
    '```oan-play-settlement',
    JSON.stringify({ events: [], stateDelta: { step }, observations: [], suggestedActions: ['Continue.'] }),
    '```',
  ].join('\n');
}
const createdAt = (index) => new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
function append(session, step) {
  return settlePlayWorldRefereeResponse({
    session, userText: `Continue ${step}.`, actionKind: 'do',
    refereeResponse: response(step), createdAt: createdAt(step),
  });
}

async function measure(operation) {
  active = {
    readAttempts: 0, readCalls: 0, readBytes: 0, readPaths: new Set(),
    writeCalls: 0, writeBytes: 0, appendCalls: 0, appendBytes: 0,
    metadataWriteCalls: 0, transcriptWriteBytes: 0, transcriptAppendBytes: 0,
    copyCalls: 0, copiedBytes: 0, aggregateLockHoldMs: 0,
  };
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  try {
    const value = await operation();
    const { readPaths, ...metrics } = active;
    const cpu = process.cpuUsage(cpuStarted);
    return {
      ...metrics,
      uniqueReadFiles: readPaths.size,
      freshWrittenBytes: metrics.writeBytes + metrics.appendBytes,
      totalWrittenBytes: metrics.writeBytes + metrics.appendBytes + metrics.copiedBytes,
      aggregateLockHoldMs: Number(metrics.aggregateLockHoldMs.toFixed(2)),
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)),
      responseBytes: Buffer.byteLength(JSON.stringify(value)),
    };
  } finally {
    active = undefined;
    locks.clear();
  }
}

const scenarios = [
  { sessions: 1, turns: 10, siblings: 0 },
  { sessions: 1, turns: 80, siblings: 0 },
  { sessions: 6, turns: 10, siblings: 0 },
  { sessions: 1, turns: 80, siblings: 40 },
];
const results = [];
for (const scenario of scenarios) {
  const root = await fs.mkdtemp(join(tmpdir(), 'oan-play-storage-cost-'));
  try {
    for (let index = 0; index < scenario.sessions; index += 1) {
      let session = createPlaySessionDraft({
        id: `session-${index}`, title: `Session ${index}`, sceneStart: 'An empty room.',
        characters: [], createdAt: createdAt(0),
      });
      for (let turn = 1; turn <= scenario.turns; turn += 1) session = append(session, turn);
      const sourceArtifactId = session.selectedTurnIds.at(-1);
      for (let sibling = 0; sibling < scenario.siblings; sibling += 1) {
        session = settlePlayWorldSettlementRetry({
          session, sourceArtifactId, expectedSessionRevision: session.revision,
          refereeResponse: response(scenario.turns), createdAt: createdAt(scenario.turns + sibling + 1),
        }).session;
      }
      await writePlaySessionFiles(root, session, { expectedAbsent: true });
    }
    const summary = await measure(() => listPlaySessionSummaries(root));
    const detail = await measure(() => readPlaySessionSelectedDetail(root, 'session-0', { limit: 10 }));
    const before = await readPlaySessionFiles(root, 'session-0');
    const next = append(before, scenario.turns + 1);
    const save = await measure(() => writePlaySessionFiles(root, next, { expectedCurrentSession: before }));
    const sessionRoot = join(root, '.workspace/play-sessions/session-0');
    await original.rm(join(sessionRoot, '.read-model'), { recursive: true });
    const rebuild = await measure(() => readPlaySessionSelectedDetail(root, 'session-0', { limit: 10 }));
    if (summary.readCalls === 0 || detail.readCalls === 0 || save.writeCalls === 0) {
      throw new Error('Filesystem instrumentation did not observe Core I/O.');
    }
    results.push({ ...scenario, artifactCountPerSession: scenario.turns + scenario.siblings, summary, detail, save, rebuild });
  } finally {
    await original.rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  detailWindow: { transcript: 10, events: 10 },
  scope: 'Successful application read/write bytes, copy bytes, and cooperative lock hold time; warm filesystem cache and process-local source witness seeded by fixture creation. Cold/rebound witnesses require one full validation; OS metadata and physical disk I/O are not measured.',
  results,
}, null, 2));
