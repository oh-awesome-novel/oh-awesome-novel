// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  type Router,
} from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';

import WorkspaceView from '../../../apps/desktop-ui/src/views/WorkspaceView.vue';
import {
  readWorkspaceModePreference,
  writeWorkspaceModePreference,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceLayoutState';
import type { WorkspaceSummary } from '@oh-awesome-novel/client';

const WorkspaceShellStub = defineComponent({
  name: 'WorkspaceShell',
  props: {
    mode: {
      type: String,
      required: true,
    },
  },
  emits: {
    selectMode: (_mode: 'writing' | 'play') => true,
  },
  template: `
    <section>
      <output data-test="active-mode">{{ mode }}</output>
      <button data-test="select-writing" @click="$emit('selectMode', 'writing')">Writing</button>
      <button data-test="select-play" @click="$emit('selectMode', 'play')">Play</button>
    </section>
  `,
});

describe('WorkspaceView mode continuity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores the workspace-scoped mode when the route omits mode', async () => {
    const workspace = createWorkspace();
    writeWorkspaceModePreference(workspace.path, 'play');
    const router = await createTestRouter('/workspace');
    const wrapper = mountWorkspaceView(router, workspace);

    await flushPromises();

    expect(wrapper.get('[data-test="active-mode"]').text()).toBe('play');
    expect(router.currentRoute.value.path).toBe('/workspace/play');

    wrapper.unmount();
  });

  it('writes an explicit mode selection to both route and workspace storage', async () => {
    const workspace = createWorkspace();
    const router = await createTestRouter('/workspace');
    const wrapper = mountWorkspaceView(router, workspace);

    await wrapper.get('[data-test="select-play"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/workspace/play');
    expect(readWorkspaceModePreference(workspace.path)).toBe('play');

    await wrapper.get('[data-test="select-writing"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/workspace');
    expect(readWorkspaceModePreference(workspace.path)).toBe('writing');

    wrapper.unmount();
  });

  it.each([
    { savedMode: 'play' as const, canonicalPath: '/workspace/play' },
    { savedMode: 'writing' as const, canonicalPath: '/workspace' },
  ])(
    'keeps a saved $savedMode preference when canonicalizing an invalid route mode',
    async ({ savedMode, canonicalPath }) => {
      const workspace = createWorkspace();
      writeWorkspaceModePreference(workspace.path, savedMode);
      const router = await createTestRouter('/workspace/not-a-mode');
      const wrapper = mountWorkspaceView(router, workspace);

      await flushPromises();

      expect(wrapper.get('[data-test="active-mode"]').text()).toBe(savedMode);
      expect(router.currentRoute.value.path).toBe(canonicalPath);
      expect(readWorkspaceModePreference(workspace.path)).toBe(savedMode);

      wrapper.unmount();
    },
  );
});

async function createTestRouter(path: string): Promise<Router> {
  const EmptyView = defineComponent({ template: '<div />' });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'launcher', component: EmptyView },
      { path: '/workspace/:mode?', name: 'workspace', component: EmptyView },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

function mountWorkspaceView(router: Router, workspace: WorkspaceSummary) {
  return mount(WorkspaceView, {
    props: {
      workspace,
      providerConfigured: true,
      theme: 'dark',
      startGuide: false,
    },
    global: {
      plugins: [router],
      stubs: {
        WorkspaceShell: WorkspaceShellStub,
      },
    },
  });
}

function createWorkspace(): WorkspaceSummary {
  return {
    name: 'alpha',
    novelName: 'Alpha',
    path: '/novels/alpha',
    valid: true,
  };
}
