// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlayOutcomeItem,
  PlayOutcomeReport,
  PlaySession,
  PlayWritingReferenceAttachment,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  getPlayOutcomeReport: vi.fn(),
  generatePlayOutcomeReport: vi.fn(),
  listPlayWritingReferenceAttachments: vi.fn(),
  createPlayWritingReferenceAttachment: vi.fn(),
  detachPlayWritingReferenceAttachment: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayOutcomePanel from '../../../apps/desktop-ui/src/components/play/outcome/PlayOutcomePanel.vue';
import { projectPlayOutcomeReportForUi } from '../../../apps/desktop-ui/src/composables/usePlayOutcome';

describe('PlayOutcomePanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listPlayWritingReferenceAttachments.mockResolvedValue({ attachments: [] });
  });

  it('generates the committed report and moves focus to its heading', async () => {
    api.getPlayOutcomeReport.mockRejectedValue(Object.assign(new Error('missing'), {
      status: 404,
    }));
    const report = createReport([createItem('summary-1', 'sceneSummary', 'Committed ending')]);
    api.generatePlayOutcomeReport.mockResolvedValue(reportResult(report, 'director'));

    const wrapper = mountPanel({ showSpoilers: true });
    await flushPromises();

    await button(wrapper, 'Generate report').trigger('click');
    await flushPromises();

    expect(api.generatePlayOutcomeReport).toHaveBeenCalledWith('play-outcome-1', {
      baseRevision: 3,
      projection: 'director',
    });
    expect(wrapper.text()).toContain('Committed ending');
    expect(document.activeElement).toBe(wrapper.get('h2').element);
    expect(wrapper.get('section[aria-label="Play Outcome and Writing handoff"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('groups visible outcomes and enforces the 24-item attachment selection limit', async () => {
    const report = createReport(Array.from({ length: 25 }, (_, index) =>
      createItem(
        `material-${index + 1}`,
        index === 0 ? 'sceneSummary' : 'writingMaterial',
        `Material ${index + 1}`,
      )));
    api.getPlayOutcomeReport.mockResolvedValue(reportResult(report, 'director'));

    const wrapper = mountPanel({ showSpoilers: true });
    await flushPromises();

    expect(wrapper.text()).toContain('Scene summary');
    expect(wrapper.text()).toContain('Writing material');
    const selections = wrapper.findAll<HTMLInputElement>(
      '.play-outcome-item input[type="checkbox"]',
    );
    expect(selections).toHaveLength(25);

    for (const selection of selections.slice(0, 24)) {
      await selection.setValue(true);
    }

    expect(wrapper.text()).toContain('24 / 24 item(s) selected');
    expect(selections[24]!.element.disabled).toBe(true);
    expect(selections[0]!.element.disabled).toBe(false);

    await selections[0]!.setValue(false);
    expect(selections[24]!.element.disabled).toBe(false);
    wrapper.unmount();
  });

  it('scrubs cached Director evidence synchronously when Player lens refresh fails', async () => {
    const publicItem = {
      ...createItem('public-1', 'sceneSummary', 'A public ending'),
      artifactTurnRefs: ['turn-secret'],
      messageRefs: ['message-secret'],
      eventRefs: ['event-secret'],
      observationRefs: ['observation-secret'],
      evidenceRefs: ['evidence-secret'],
      sourceRefs: ['source-secret'],
      participantRefs: ['participant-secret'],
    } satisfies PlayOutcomeItem;
    const hiddenItem = createItem(
      'hidden-1',
      'worldChange',
      'The hidden faction already moved',
      'playerUnknown',
    );
    const report = {
      ...createReport([publicItem, hiddenItem]),
      selectedArtifactTurnRefs: ['turn-secret'],
      sourceSnapshots: [{ sourceId: 'source-secret', path: 'secret.md' }],
    } satisfies PlayOutcomeReport;
    const hiddenAttachment = createAttachment('attachment-secret', ['hidden-1']);
    const playerProjection = projectPlayOutcomeReportForUi(report, 'player')!;
    expect(playerProjection.selectedArtifactTurnRefs).toEqual([]);
    expect(playerProjection.sourceSnapshots).toEqual([]);
    expect(playerProjection.items.map((item) => item.id)).toEqual(['public-1']);
    expect(playerProjection.items[0]?.artifactTurnRefs).toEqual([]);
    expect(playerProjection.items[0]?.messageRefs).toEqual([]);
    expect(playerProjection.items[0]?.eventRefs).toEqual([]);
    expect(playerProjection.items[0]?.observationRefs).toEqual([]);
    expect(playerProjection.items[0]?.evidenceRefs).toEqual([]);
    expect(playerProjection.items[0]?.sourceRefs).toEqual([]);
    expect(playerProjection.items[0]?.participantRefs).toEqual([]);
    api.getPlayOutcomeReport.mockResolvedValue(reportResult(report, 'director'));
    api.listPlayWritingReferenceAttachments.mockResolvedValue({
      attachments: [hiddenAttachment],
    });

    const wrapper = mountPanel({ showSpoilers: true });
    await flushPromises();

    await outcomeItem(wrapper, 'hidden-1').get('input[type="checkbox"]').setValue(true);
    await outcomeItem(wrapper, 'hidden-1').get('button').trigger('click');
    expect(wrapper.text()).toContain('The hidden faction already moved');
    expect(wrapper.emitted('prepareAdoption')?.at(-1)).toEqual([{
      kind: 'outcome',
      outcomeItemId: 'hidden-1',
      outcomeReportFingerprint: 'b'.repeat(64),
    }]);
    expect(wrapper.text()).toContain('attachment-secret');

    api.getPlayOutcomeReport.mockResolvedValueOnce({
      ...reportResult(report, 'director'),
      status: 'stale',
      staleReasons: ['sourceContentChanged:source-secret'],
    });
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('sourceContentChanged:source-secret');

    let rejectPlayerRequest!: (reason?: unknown) => void;
    api.getPlayOutcomeReport.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectPlayerRequest = reject;
    }));

    await button(wrapper, 'Player').trigger('click');
    expect(wrapper.emitted('updateShowSpoilers')?.at(-1)).toEqual([false]);
    await wrapper.setProps({ showSpoilers: false });
    await nextTick();

    assertNoDirectorEvidence(wrapper, true);
    expect(wrapper.get<HTMLButtonElement>(
      '.play-outcome-item button[aria-label^="Bring outcome to writing"]',
    ).element.disabled).toBe(true);
    expect(wrapper.text()).toContain('0 / 24 item(s) selected');
    expect(wrapper.text()).toContain('sourceSnapshotChanged');
    expect(wrapper.text()).not.toContain('attachment-secret');

    rejectPlayerRequest(new Error('source-secret is unavailable'));
    await flushPromises();

    assertNoDirectorEvidence(wrapper, false);
    expect(wrapper.text()).toContain('Outcome Report could not be loaded for the Player lens.');
    wrapper.unmount();
  });

  it('creates and detaches a Writing Reference, then emits the unified outcome seed', async () => {
    const item = createItem('material-1', 'writingMaterial', 'Keep the broken compass');
    const report = createReport([item]);
    const attachment = createAttachment('attachment-1', [item.id]);
    const detachedAttachment = {
      ...attachment,
      status: 'detached',
      detachedAt: '2026-07-16T02:00:00.000Z',
    } satisfies PlayWritingReferenceAttachment;
    api.getPlayOutcomeReport.mockResolvedValue(reportResult(report, 'director'));
    api.createPlayWritingReferenceAttachment.mockResolvedValue({ attachment });
    api.detachPlayWritingReferenceAttachment.mockResolvedValue({
      attachment: detachedAttachment,
    });

    const wrapper = mountPanel({ showSpoilers: true });
    await flushPromises();

    await wrapper.get('.play-outcome-item input[type="checkbox"]').setValue(true);
    await button(wrapper, 'Create attachment').trigger('click');
    await flushPromises();

    expect(api.createPlayWritingReferenceAttachment).toHaveBeenCalledWith({
      sessionId: 'play-outcome-1',
      baseRevision: 3,
      selectedOutcomeItemIds: ['material-1'],
    });
    expect(wrapper.text()).toContain('attachment-1');
    expect(wrapper.emitted('writingReferencesUpdated')).toHaveLength(1);

    await wrapper.get('button[aria-label="Detach Writing Reference attachment-1"]').trigger('click');
    await flushPromises();

    expect(api.detachPlayWritingReferenceAttachment).toHaveBeenCalledWith('attachment-1');
    expect(wrapper.text()).toContain('detached');
    expect(wrapper.emitted('writingReferencesUpdated')).toHaveLength(2);

    await outcomeItem(wrapper, 'material-1').get('button').trigger('click');
    expect(wrapper.emitted('prepareAdoption')?.at(-1)).toEqual([{
      kind: 'outcome',
      outcomeItemId: 'material-1',
      outcomeReportFingerprint: 'b'.repeat(64),
    }]);
    wrapper.unmount();
  });
});

function mountPanel({ showSpoilers }: { showSpoilers: boolean }) {
  return mount(PlayOutcomePanel, {
    attachTo: document.body,
    props: {
      session: createSession(),
      showSpoilers,
      disabled: false,
    },
  });
}

function button(wrapper: VueWrapper, text: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

function outcomeItem(wrapper: VueWrapper, id: string) {
  const match = wrapper.findAll('.play-outcome-item').find((candidate) =>
    candidate.get('input').attributes('aria-label')?.includes(id) ||
    candidate.text().includes(id === 'hidden-1'
      ? 'The hidden faction already moved'
      : 'Keep the broken compass'));
  if (!match) throw new Error(`Missing outcome item: ${id}`);
  return match;
}

function assertNoDirectorEvidence(wrapper: VueWrapper, expectPublicSummary: boolean): void {
  const content = wrapper.html();
  if (expectPublicSummary) {
    expect(content).toContain('A public ending');
  }
  expect(content).not.toContain('The hidden faction already moved');
  expect(content).not.toContain('turn-secret');
  expect(content).not.toContain('message-secret');
  expect(content).not.toContain('event-secret');
  expect(content).not.toContain('observation-secret');
  expect(content).not.toContain('evidence-secret');
  expect(content).not.toContain('source-secret');
  expect(content).not.toContain('participant-secret');
  expect(content).not.toContain('secret.md');
}

function reportResult(report: PlayOutcomeReport, projection: 'player' | 'director') {
  return {
    report,
    reportFingerprint: 'b'.repeat(64),
    projection,
    status: 'current' as const,
    staleReasons: [],
  };
}

function createReport(
  items: PlayOutcomeItem[],
): PlayOutcomeReport {
  return {
    schemaVersion: 1,
    sessionId: 'play-outcome-1',
    createdAt: '2026-07-16T01:00:00.000Z',
    sessionRevision: 3,
    selectedArtifactTurnRefs: ['turn-public'],
    sourceSnapshots: [],
    items,
  };
}

function createItem(
  id: string,
  kind: PlayOutcomeItem['kind'],
  summary: string,
  visibility: PlayOutcomeItem['visibility'] = 'playerVisible',
): PlayOutcomeItem {
  return {
    id,
    kind,
    summary,
    visibility,
    confidence: 'confirmed',
    tags: [outcomeTag(kind)],
    artifactTurnRefs: ['turn-public'],
    messageRefs: [],
    eventRefs: [],
    observationRefs: [],
    evidenceRefs: [],
    sourceRefs: [],
    participantRefs: [],
  };
}

function outcomeTag(kind: PlayOutcomeItem['kind']): PlayOutcomeItem['tags'][number] {
  if (kind === 'goalAssessment') return 'goal';
  if (kind === 'participantFootprint') return 'participantFootprint';
  if (kind === 'worldChange') return 'worldChange';
  if (kind === 'writingMaterial') return 'writingMaterial';
  return 'consistency';
}

function createAttachment(
  id: string,
  selectedOutcomeItemRefs: string[],
): PlayWritingReferenceAttachment {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'play-outcome-1',
    reportRef: '.workspace/play-sessions/play-outcome-1/reports/outcome.yaml',
    reportFingerprint: 'a'.repeat(64),
    selectedOutcomeItemRefs,
    selectedArtifactTurnRefs: ['turn-public'],
    evidenceClosureRefs: ['artifact:turn-public'],
    sourceSnapshots: [],
    status: 'active',
    createdAt: '2026-07-16T01:30:00.000Z',
  };
}

function createSession(): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-outcome-1',
    title: 'Outcome scene',
    createdAt: '2026-07-16T00:00:00.000Z',
    revision: 3,
    sceneStart: 'The scene has ended.',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: 3, revision: 3 },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}
