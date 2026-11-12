// @vitest-environment happy-dom
vi.hoisted(async () => {
  const http = await import('undici');
  for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { createPlaySessionDraft, restorePlaySessionCheckpoint, settlePlayWorldRefereeResponse, writePlaySessionFiles } from '@oh-awesome-novel/core';

const api = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

it('Desktop selects two nodes, inspects differences, switches to one and names it through real HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oan-worldline-desktop-'));
  let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  let wrapper: ReturnType<typeof mount> | undefined;
  try {
    await mkdir(join(root, '.oan'));
    await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Compare\ngit:\n  autoCommitOnAccept: false\n');
    const git = promisify(execFile);
    await git('git', ['init', '-b', 'main', root]);
    await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
    const first = settlePlayWorldRefereeResponse({ session: createPlaySessionDraft({ id: 'compare', title: '两条路线', sceneStart: '路口', characters: [] }), actionKind: 'do', userText: '往左',
      refereeResponse: '在左边\n```oan-play-settlement\n{"events":[],"stateDelta":{"scene":"left"},"observations":[],"suggestedActions":[]}\n```' });
    const fork = settlePlayWorldRefereeResponse({ session: restorePlaySessionCheckpoint(first, 'initial-world'), actionKind: 'do', userText: '往右',
      refereeResponse: '在右边\n```oan-play-settlement\n{"events":[],"stateDelta":{"scene":"right"},"observations":[],"suggestedActions":[]}\n```' });
    await writePlaySessionFiles(root, fork, { expectedAbsent: true });
    backend = await startNovelHttpBackend({ workspaceRoot: root, globalConfigDir: join(root, 'global-config') });
    const client = createOanClient({ backendBaseUrl: backend.url }); Object.assign(api, client);
    wrapper = mount(PlayWorkspace, { attachTo: document.body, props: { workspace: { name: 'Compare', novelName: 'Compare', path: root, valid: true }, providerConfigured: false } });
    const page = wrapper;
    await vi.waitFor(() => expect(page.find('.play-session-card').exists()).toBe(true));
    await page.get('.play-session-card').trigger('click');
    await vi.waitFor(() => expect(page.find('.play-worldline-compare').exists()).toBe(true));
    await vi.waitFor(() => expect(page.get('.play-worldline-compare select').attributes('disabled')).toBeUndefined());
    const panel = () => page.get('.play-worldline-compare');
    await panel().findAll('select')[0]!.setValue('turn-artifact-1');
    await panel().findAll('select')[1]!.setValue('turn-artifact-3');
    await panel().get('.compare-selectors').trigger('submit');
    await vi.waitFor(() => expect(panel().text()).toContain('共同起点：初始世界'), { timeout: 5000 });
    expect(panel().findAll('td').map(cell => cell.text())).toContain('left');
    expect(panel().findAll('td').map(cell => cell.text())).toContain('right');
    expect((await client.getPlaySession('compare')).session.revision).toBe(3);
    await panel().findAll('.compare-sides article')[0]!.findAll('button')[0]!.trigger('click');
    await panel().get('.compare-confirm button:last-child').trigger('click');
    await vi.waitFor(async () => expect((await client.getPlaySession('compare')).session.selectedTurnIds).toEqual(['turn-artifact-1']));
    await vi.waitFor(() => expect(page.get('[data-worldline-checkpoint="turn-artifact-1"]').attributes('aria-current')).toBe('step'));
    expect(panel().find('.compare-sides').exists()).toBe(false);
    await vi.waitFor(() => expect(panel().get('select').attributes('disabled')).toBeUndefined());
    await panel().get('.compare-selectors').trigger('submit');
    await vi.waitFor(() => expect(panel().find('.compare-sides').exists()).toBe(true), { timeout: 5000 });
    const firstSide = panel().findAll('.compare-sides article')[0]!;
    await firstSide.get('input').setValue('保留左边'); await firstSide.get('form').trigger('submit');
    await vi.waitFor(async () => expect((await client.listPlayCheckpoints('compare')).checkpoints.find(c => c.checkpointId === 'turn-artifact-1')?.name).toBe('保留左边'));
    await flushPromises();
  } finally {
    wrapper?.unmount(); await backend?.close(); await rm(root, { recursive: true, force: true });
    for (const key of Object.keys(api)) delete api[key]; localStorage.clear();
  }
}, 30_000);
