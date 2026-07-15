import { describe, expect, it } from 'vitest';

import {
  isPlayProvenanceInSelectedBranch,
} from '../../../apps/desktop-ui/src/composables/usePlayWorkspace';

describe('Play selected-branch projection', () => {
  it('keeps session-level facts only when every provenance reference is selected', () => {
    const selectedMessages = new Set(['turn-a-referee']);
    const selectedEvents = new Set(['event-a']);

    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: ['turn-a-referee'],
      sourceEventIds: ['event-a'],
    }, selectedMessages, selectedEvents)).toBe(true);
    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: ['turn-b-referee'],
      sourceEventIds: ['event-b'],
    }, selectedMessages, selectedEvents)).toBe(false);
    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: [],
      sourceEventIds: [],
    }, selectedMessages, selectedEvents)).toBe(true);
  });
});
