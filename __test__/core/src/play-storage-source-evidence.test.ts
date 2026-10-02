import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Intercept real Node filesystem calls in an isolated process, retaining the
// public package boundary and avoiding a source-module mock of the optimizer.
const script = `
  import assert from 'node:assert/strict';
  import fs from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { basename, join } from 'node:path';
  import { createPlaySessionDraft, readPlaySessionFiles, readPlaySessionSelectedDetail,
    settlePlayWorldRefereeResponse, writePlaySessionFiles } from '@oh-awesome-novel/core';
  const [root, mode] = process.argv.slice(1);
  const append = (session, step) => settlePlayWorldRefereeResponse({ session,
    actionKind: 'do', userText: '第' + step + '步。🌙',
    refereeResponse: ['Scene ' + step, '\x60\x60\x60oan-play-settlement', JSON.stringify({
      events: [], stateDelta: { step }, observations: [], suggestedActions: [],
    }), '\x60\x60\x60'].join('\\n'),
  });
  let session = createPlaySessionDraft({ id: 'source-evidence', title: 'Evidence',
    sceneStart: '门边的灯笼。', characters: [] });
  for (let step = 1; step <= 20; step++) session = append(session, step);
  await writePlaySessionFiles(root, session, { expectedAbsent: true });
  const sessionRoot = join(root, '.workspace/play-sessions', session.id);
  const source = join(sessionRoot, 'turns', session.selectedTurnIds[0] + '.yaml');
  const readFile = fs.readFile.bind(fs);
  const writeFile = fs.writeFile.bind(fs);
  const appendFile = fs.appendFile.bind(fs);
  let reads = 0;
  let transcriptWrites = 0;
  let transcriptAppends = 0;
  let metadataWrites = 0;
  fs.readFile = async (...args) => {
    const result = await readFile(...args);
    if (String(args[0]) === source) {
      reads++;
      if (mode === 'drift') await writeFile(source, String(result).replace('Scene 1', 'Scene changed'));
    }
    return result;
  };
  fs.writeFile = async (...args) => {
    if (basename(String(args[0])) === 'transcript.md') transcriptWrites++;
    if (basename(String(args[0])) === 'session.yaml') metadataWrites++;
    return writeFile(...args);
  };
  fs.appendFile = async (...args) => {
    if (basename(String(args[0])) === 'transcript.md') {
      transcriptAppends++;
      assert(String(args[0]).includes('.stage.'));
      assert(String(args[1]).includes('第21步'));
      assert(!String(args[1]).includes('第1步'));
    }
    return appendFile(...args);
  };
  syncBuiltinESMExports();
  if (mode === 'append') {
    const before = await readPlaySessionFiles(root, session.id);
    await writePlaySessionFiles(root, append(before, 21), { expectedCurrentSession: before });
    assert.equal(transcriptWrites, 0);
    assert.equal(transcriptAppends, 1);
    assert.equal(metadataWrites, 1);
  } else {
    await fs.rm(join(sessionRoot, '.read-model'), { recursive: true });
    const operation = readPlaySessionSelectedDetail(root, session.id, { limit: 2 });
    if (mode === 'drift') await assert.rejects(operation, { code: 'PLAY_READ_MODEL_INVALID' });
    else {
      await operation;
      assert.equal(reads, 1, 'old source must be read once for validation and hash evidence');
    }
  }
`;

describe('Play storage source evidence and staged suffix I/O', () => {
  it.each(['append', 'rebuild', 'drift'] as const)('preserves the %s storage boundary through the real package', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'oan-play-source-evidence-'));
    roots.push(root);
    await expect(execFileAsync(process.execPath, [
      '--input-type=module', '-e', script, root, mode,
    ], { timeout: 10_000 })).resolves.toMatchObject({ stderr: '' });
  });
});
