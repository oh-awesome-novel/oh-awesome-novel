import { createApp, defineComponent, h } from 'vue';

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import ReferenceImportTab from '../../../apps/desktop-ui/src/components/workspace/ReferenceImportTab.vue';
import '../../../apps/desktop-ui/src/components/play/play-design.css';
import { rendererSmokeState } from './mock-oan-client';

declare global {
  interface Window {
    __playRendererSmoke: typeof rendererSmokeState;
  }
}

window.__playRendererSmoke = rendererSmokeState;
window.addEventListener('error', (event) => {
  rendererSmokeState.errors.push(event.error instanceof Error
    ? event.error.stack ?? event.error.message
    : event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  rendererSmokeState.errors.push(event.reason instanceof Error
    ? event.reason.stack ?? event.reason.message
    : String(event.reason));
});

localStorage.clear();

createApp(PlayWorkspace, {
  workspace: {
    name: 'renderer-smoke',
    novelName: 'Renderer Smoke Novel',
    path: '/novels/renderer-smoke',
    valid: true,
  },
  providerConfigured: true,
  files: [],
  filesLoading: false,
}).mount('#play-app');

const ReferenceSmokeHost = defineComponent({
  name: 'ReferenceSmokeHost',
  setup() {
    return () => h(ReferenceImportTab, {
      onReviewPendingAction(pendingActionId: string) {
        rendererSmokeState.calls.push({
          method: 'referenceReviewPendingAction',
          args: [pendingActionId],
        });
      },
    });
  },
});

createApp(ReferenceSmokeHost).mount('#reference-app');

rendererSmokeState.ready = true;
