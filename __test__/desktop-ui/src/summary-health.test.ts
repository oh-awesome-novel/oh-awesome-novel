// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => ({ rebuildProjections: vi.fn() }) }));
import ProjectHealthTab from '../../../apps/desktop-ui/src/components/workspace/ProjectHealthTab.vue';

describe('optional aggregate summary health', () => {
  it('separates summaries not yet created from broken evidence without hiding either', () => {
    const wrapper = mount(ProjectHealthTab, { props: { health: {
      generatedAt: '2026-10-14T00:00:00.000Z', missingCharacterCards: [], chaptersWithoutSummaries: [], activeHookCount: 0,
      latestStateStale: false, timelineGapCount: 0, pendingActionCount: 0,
      issues: [
        { id: 'aggregate-summary-missing:summaries/global.md', title: 'Missing book summary', detail: 'No summary.', path: 'summaries/global.md', severity: 'info' },
        { id: 'aggregate-summary-stale:summaries/volume/0001.md', title: 'Stale volume summary', detail: 'Sources changed.', path: 'summaries/volume/0001.md', severity: 'warning' },
        { id: 'chapter-summary:0001/0002', title: 'Chapter has no summary', detail: 'Missing chapter evidence.', path: 'chapters/0001/0002.md', severity: 'warning' },
      ],
    } } });
    try {
      expect(wrapper.get('details summary').text()).toContain('可选完善：1 份');
      expect(wrapper.get('details').text()).toContain('summaries/global.md');
      expect(wrapper.get('details').text()).not.toContain('Stale volume summary');
      expect(wrapper.findAll('.health-issue-list').find((item) => item.element.tagName === 'DIV')!.text()).toContain('Stale volume summary');
      expect(wrapper.text()).toContain('Chapter has no summary');
    } finally { wrapper.unmount(); }
  });
});
