import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import { samePlayCharacterCheckTarget } from '@oh-awesome-novel/client';
import type {
  OanClient,
  PlayCharacterCheckInput,
  PlayCharacterCheckLens,
  PlayCharacterCheckReportView,
} from '@oh-awesome-novel/client';

export type PlayCharacterCheckRequestTarget = PlayCharacterCheckInput['target'];

export interface PlayCharacterCheckScope {
  sessionId: string;
  lens: PlayCharacterCheckLens;
  /** Changes whenever the selected branch or the rehearsal attempt moves, so stale flags are re-read. */
  branchKey: string;
}

/**
 * "检查角色贴合度": one explicit read-only model call per click. Reports are
 * kept by the host beside the session; this composable only mirrors the ones
 * for the current lens. A Player view never loads Director-lens reports.
 */
export function usePlayCharacterCheck(options: {
  client: Pick<OanClient, 'requestPlayCharacterCheck' | 'listPlayCharacterChecks'>;
  scope: ComputedRef<PlayCharacterCheckScope | undefined>;
  blocked: Readonly<Ref<boolean>>;
}) {
  const reports = shallowRef<PlayCharacterCheckReportView[]>([]);
  const running = shallowRef<PlayCharacterCheckRequestTarget>();
  const error = shallowRef('');
  let controller: AbortController | undefined;
  let epoch = 0;

  const identity = computed(() => {
    const scope = options.scope.value;
    return scope ? `${scope.sessionId}\n${scope.lens}` : '';
  });

  async function refresh(): Promise<void> {
    const scope = options.scope.value;
    const current = epoch;
    if (!scope) { reports.value = []; return; }
    try {
      const next = await options.client.listPlayCharacterChecks(scope.sessionId, scope.lens);
      if (current === epoch) reports.value = Array.isArray(next) ? next : [];
    } catch {
      // Past advice is optional; a failed listing never blocks the workspace.
      if (current === epoch) reports.value = [];
    }
  }

  // Another session or lens: drop everything on screen first, then load that lens only.
  watch(identity, () => {
    epoch += 1;
    controller?.abort();
    controller = undefined;
    running.value = undefined;
    error.value = '';
    reports.value = [];
    void refresh();
  }, { immediate: true });
  watch(() => options.scope.value?.branchKey, (next, previous) => {
    if (previous !== undefined && next !== previous) void refresh();
  });
  onBeforeUnmount(() => { epoch += 1; controller?.abort(); });

  async function check(target: PlayCharacterCheckRequestTarget): Promise<boolean> {
    const scope = options.scope.value;
    if (!scope || running.value || options.blocked.value) return false;
    const current = epoch;
    controller = new AbortController();
    const signal = controller.signal;
    running.value = target;
    error.value = '';
    try {
      const report = await options.client.requestPlayCharacterCheck(scope.sessionId, { target, lens: scope.lens }, signal);
      if (current !== epoch || signal.aborted) return false;
      reports.value = [...reports.value.filter((item) => !samePlayCharacterCheckTarget(item.target, report.target)), report];
      return true;
    } catch (caught) {
      if (current === epoch && !signal.aborted) {
        error.value = `检查没有完成，没有保存任何报告：${caught instanceof Error ? caught.message : String(caught)}`;
      }
      return false;
    } finally {
      if (current === epoch) running.value = undefined;
    }
  }

  /** Stops waiting; the host stores nothing for a cancelled check. */
  function cancel(): void {
    if (!running.value) return;
    controller?.abort();
    running.value = undefined;
  }

  return { reports, running, error, check, cancel, refresh };
}
