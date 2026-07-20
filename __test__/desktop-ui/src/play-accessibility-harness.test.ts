// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateFocusedControl,
  getNativeButtonContracts,
  getPlayStatusRegions,
  PLAY_DIRECTOR_CONTROL_NAMES,
  PLAY_MODIFY_MODE_NAMES,
  PLAY_SOURCE_DRIFT_CONTROL_NAMES,
  PLAY_WINDOW_CONTROL_NAMES,
} from './support/playAccessibilityHarness';
import { createPlayLongJourneyFixture } from './support/playLongJourneyFixture';

describe('Play renderer journey QA harness', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('freezes the native-button and live-region accessibility contract', () => {
    document.body.innerHTML = createContractFixture();

    const names = [
      ...PLAY_WINDOW_CONTROL_NAMES,
      ...PLAY_SOURCE_DRIFT_CONTROL_NAMES,
      ...PLAY_DIRECTOR_CONTROL_NAMES,
      ...PLAY_MODIFY_MODE_NAMES,
    ];
    const contracts = getNativeButtonContracts(document, names);

    expect(contracts.map(({ name }) => name)).toEqual(names);
    expect(contracts.every(({ button }) => button.type === 'button')).toBe(true);
    expect(getPlayStatusRegions(document)).toHaveLength(2);
  });

  it('activates a focused native control through the shared journey helper', () => {
    document.body.innerHTML = createContractFixture();
    const onAccept = vi.fn();
    const [accept] = getNativeButtonContracts(document, ['Accept']);
    accept!.button.addEventListener('click', onAccept);

    activateFocusedControl(accept!);

    expect(document.activeElement).toBe(accept!.button);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('rejects role-only button substitutes', () => {
    document.body.innerHTML = '<div role="button" aria-label="Accept" tabindex="0"></div>';

    expect(() => getNativeButtonContracts(document, ['Accept'])).toThrow(
      'Missing native Play button with accessible name: Accept',
    );
  });

  it('builds bounded tail windows without losing total-count truth', () => {
    const fixture = createPlayLongJourneyFixture({
      transcriptCount: 120,
      eventCount: 72,
      windowSize: 12,
    });

    expect(fixture.summary).toMatchObject({
      transcriptCount: 120,
      eventCount: 72,
    });
    expect(fixture.transcript.items).toHaveLength(12);
    expect(fixture.transcript.items[0]?.id).toBe('message-109');
    expect(fixture.transcript).toMatchObject({
      totalCount: 120,
      hasMoreBefore: true,
      nextCursor: 'message:109',
    });
    expect(fixture.events.items).toHaveLength(12);
    expect(fixture.events.items[0]?.id).toBe('event-61');
  });
});

function createContractFixture(): string {
  const buttons = [
    ...PLAY_WINDOW_CONTROL_NAMES,
    ...PLAY_SOURCE_DRIFT_CONTROL_NAMES,
    ...PLAY_DIRECTOR_CONTROL_NAMES,
    ...PLAY_MODIFY_MODE_NAMES,
  ].map((name) => `<button type="button">${name}</button>`).join('');

  return `
    <main>
      ${buttons}
      <p role="status" aria-live="polite">Window ready.</p>
      <p role="status" aria-live="assertive">Director intervention failed.</p>
    </main>
  `;
}
