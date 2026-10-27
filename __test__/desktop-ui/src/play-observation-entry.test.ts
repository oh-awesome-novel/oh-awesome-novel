// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { PlaySessionSelectedDetail, PlaySessionSummary } from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessionSummaries: vi.fn(), getPlaySessionDetail: vi.fn(),
  previewPlaySessionMigration: vi.fn(), listPlayContextTraces: vi.fn(),
  getPlaySourceDrift: vi.fn(), listPlayCheckpoints: vi.fn(),
  getPlayOutcomeReport: vi.fn(), listPlayWritingReferenceAttachments: vi.fn(),
  addPlayObservation: vi.fn(), createPlayAdoptionPreview: vi.fn(),
}));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

let detail: PlaySessionSelectedDetail;
let wrapper: VueWrapper | undefined;

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  detail = makeDetail();
  api.listPlaySessionSummaries.mockImplementation(async () => ({ summaries: [detail.summary] }));
  api.getPlaySessionDetail.mockImplementation(async () => ({ detail: structuredClone(detail) }));
  api.previewPlaySessionMigration.mockResolvedValue({ preview: null });
  api.listPlayContextTraces.mockResolvedValue({ traces: [] });
  api.getPlaySourceDrift.mockResolvedValue({ status: { sessionId: 'play-note', revision: 1, overall: 'current', sources: [], availableDecisions: [] } });
  api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
  api.getPlayOutcomeReport.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
  api.listPlayWritingReferenceAttachments.mockResolvedValue({ attachments: [] });
  api.createPlayAdoptionPreview.mockRejectedValue(new Error('Preview unavailable in this fixture'));
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

describe('PlayWorkspace manual observation entry', () => {
  it('saves from a selected visible committed source, blocks concurrent interactions and exposes adoption', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    api.addPlayObservation.mockImplementation(async (_id: string, input: { summary: string; evidence: string; sourceTurnIds: string[] }) => {
      await pending;
      detail.snapshot.observations.push({ id: 'note-1', ...input, sourceEventIds: [], canonical: false, visibility: 'playerVisible' });
      advanceRevision();
      return {};
    });
    const view = await mountWorkspace();
    await button(view, 'Add observation').trigger('click');
    expect((view.get('[name="observation-source"]').element as HTMLSelectElement).value).toBe('message-2');
    expect(view.get('[name="observation-source"]').text()).not.toContain('hidden clue');
    expect((view.get('[name="observation-summary"]').element as HTMLInputElement).value).toBe('');
    expect((view.get('[name="observation-evidence"]').element as HTMLTextAreaElement).value).toBe('');
    await fillNote(view);
    await view.get('[name="observation-source"]').setValue('message-1');
    await view.get('form[aria-label="Add observation"]').trigger('submit');
    expect(api.addPlayObservation).toHaveBeenCalledWith('play-note', {
      summary: 'The gate is guarded', evidence: 'I approached the guarded gate.',
      sourceTurnIds: ['message-1'], baseRevision: 1,
    });
    expect(view.get('.play-session-card').attributes('disabled')).toBeDefined();
    expect(view.get('[name="observation-summary"]').attributes('disabled')).toBeDefined();
    expect(view.get('.play-composer textarea').attributes('disabled')).toBeDefined();
    release();
    await flushPromises();
    expect(view.get('.play-observation-list').text()).toContain('The gate is guarded');
    expect(view.text()).toContain('Observation saved as your Play-local note');
    expect(view.get('.play-session-card').attributes('disabled')).toBeUndefined();
    await view.get('[aria-label="Bring observation to writing: The gate is guarded"]').trigger('click');
    expect(api.createPlayAdoptionPreview).toHaveBeenCalledWith('play-note', expect.objectContaining({
      baseRevision: 2, seed: { kind: 'observation', observationId: 'note-1' },
    }));
  });

  it('retains input after a revision conflict and retries with the refreshed revision', async () => {
    api.addPlayObservation.mockRejectedValueOnce(Object.assign(new Error('Play session revision changed.'), { status: 409 }));
    api.addPlayObservation.mockResolvedValueOnce({});
    const view = await mountWorkspace();
    await button(view, 'Add observation').trigger('click');
    await fillNote(view);
    await view.get('form[aria-label="Add observation"]').trigger('submit');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain('Your input is retained');
    expect((view.get('[name="observation-summary"]').element as HTMLInputElement).value).toBe('The gate is guarded');
    advanceRevision();
    await button(view, 'Refresh observation sources').trigger('click');
    await flushPromises();
    expect((view.get('[name="observation-evidence"]').element as HTMLTextAreaElement).value).toBe('I approached the guarded gate.');
    await view.get('form[aria-label="Add observation"]').trigger('submit');
    await flushPromises();
    expect(api.addPlayObservation).toHaveBeenLastCalledWith('play-note', expect.objectContaining({ baseRevision: 2 }));
  });

  it('reports persistence separately when refreshing the saved observation fails', async () => {
    api.addPlayObservation.mockImplementation(async () => {
      api.listPlaySessionSummaries.mockRejectedValueOnce(new Error('Network unavailable'));
      return {};
    });
    const view = await mountWorkspace();
    await button(view, 'Add observation').trigger('click');
    await fillNote(view);
    await view.get('form[aria-label="Add observation"]').trigger('submit');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain('The observation was saved');
    expect(view.get('[role="alert"]').text()).toContain('Do not submit it again');
    expect(view.text()).not.toContain('Your input is retained');
    expect(view.find('form[aria-label="Add observation"]').exists()).toBe(false);
    await button(view, 'Refresh observation sources').trigger('click');
    await flushPromises();
    expect(api.addPlayObservation).toHaveBeenCalledOnce();
  });

  it('requires a committed source ID and resets drafts when switching sessions', async () => {
    detail.transcript.items = [{ speaker: 'narrator', content: 'Legacy message without ID', createdAt: detail.snapshot.createdAt }];
    const view = await mountWorkspace();
    expect(button(view, 'Add observation').attributes('disabled')).toBeDefined();
    expect(view.text()).toContain('A committed message with a saved source ID is needed');
    detail = makeDetail();
    await view.get('[aria-label="刷新 Play workspace"]').trigger('click');
    await flushPromises();
    await button(view, 'Add observation').trigger('click');
    await fillNote(view);
    const second = makeDetail('play-other');
    api.listPlaySessionSummaries.mockResolvedValue({ summaries: [detail.summary, second.summary] });
    api.getPlaySessionDetail.mockImplementation(async (id: string) => ({ detail: structuredClone(id === 'play-other' ? second : detail) }));
    await view.get('[aria-label="刷新 Play workspace"]').trigger('click');
    await flushPromises();
    await view.findAll('.play-session-card')[1]!.trigger('click');
    await flushPromises();
    expect(view.find('form[aria-label="Add observation"]').exists()).toBe(false);
    await button(view, 'Add observation').trigger('click');
    expect((view.get('[name="observation-summary"]').element as HTMLInputElement).value).toBe('');
    expect(api.addPlayObservation).not.toHaveBeenCalled();
  });
});

function advanceRevision() {
  detail.summary.revision++;
  detail.snapshot.revision++;
  detail.summary.worldClock.revision++;
  detail.snapshot.worldClock.revision++;
}
async function mountWorkspace() {
  wrapper = mount(PlayWorkspace, { attachTo: document.body, props: {
    workspace: { name: 'notes', path: '/novels/notes', valid: true }, providerConfigured: true,
  } });
  await flushPromises();
  return wrapper;
}
async function fillNote(view: VueWrapper) {
  await view.get('[name="observation-summary"]').setValue('The gate is guarded');
  await view.get('[name="observation-evidence"]').setValue('I approached the guarded gate.');
}
function button(view: VueWrapper, label: string) {
  const found = view.findAll('button').find((item) => item.text() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function makeDetail(id = 'play-note'): PlaySessionSelectedDetail {
  const summary: PlaySessionSummary = {
    schemaVersion: 4, id, title: id, createdAt: '2026-10-07T00:00:00.000Z', latestActivityAt: '2026-10-07T00:01:00.000Z',
    revision: 1, purpose: 'immersiveJourney', startMode: 'quick', selectedArtifactId: 'turn-1',
    selectedTurnCount: 1, transcriptCount: 2, eventCount: 0, worldClock: { turn: 1, revision: 1 }, canonical: false,
  };
  return {
    summary,
    snapshot: {
      schemaVersion: 4, id, title: id, createdAt: summary.createdAt, revision: 1,
      sceneStart: 'A guarded gate.', characters: [], selectedTurnIds: ['turn-1'], branchSnapshotRequiredFromRevision: 0,
      metadataExtensions: {}, playLocalState: { secret: 'hidden clue' }, playLocalStateVisibility: { secret: 'playerUnknown' },
      worldClock: { turn: 1, revision: 1 },
      eventPolicy: { simulationMode: 'reactiveWorld', density: 'balanced', allowOffscreen: true, allowHidden: true, maxExternalEventsPerTurn: 2 },
      scheduledEvents: [], suggestedActions: [], activatedSources: [], observations: [], adoptionCandidates: [],
    },
    transcript: { totalCount: 2, hasMoreBefore: false, items: [
      { id: 'message-1', speaker: 'user', content: 'I approach the gate.', createdAt: summary.createdAt },
      { id: 'message-2', speaker: 'world-referee', content: 'A guard blocks the gate.', createdAt: summary.createdAt },
    ] },
    events: { items: [], totalCount: 0, hasMoreBefore: false }, eventPresentation: [],
  };
}
