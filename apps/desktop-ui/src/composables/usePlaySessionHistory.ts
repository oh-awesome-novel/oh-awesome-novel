import { readonly, shallowRef, watch } from 'vue';
import type { ComputedRef } from 'vue';

import type {
  PlayCheckpointRestoreResult,
  PlayCheckpointSummary,
  PlaySession,
} from './useWorkspaceApi';

export interface PlaySessionHistoryClient {
  listPlayCheckpoints(id: string): Promise<{
    checkpoints: PlayCheckpointSummary[];
  }>;
  restorePlayCheckpoint(
    id: string,
    artifactId: string,
    input: { baseRevision: number },
  ): Promise<PlayCheckpointRestoreResult>;
}

export interface UsePlaySessionHistoryOptions {
  client: PlaySessionHistoryClient;
  selectedSession: ComputedRef<PlaySession | undefined>;
  blocked: ComputedRef<boolean>;
  onRestored(session: PlaySession): void;
  onError(error: unknown): void;
}

export function usePlaySessionHistory(options: UsePlaySessionHistoryOptions) {
  const checkpoints = shallowRef<PlayCheckpointSummary[]>([]);
  const busyArtifactId = shallowRef('');
  const loading = shallowRef(false);
  const notice = shallowRef('');
  let loadGeneration = 0;
  let loadedSessionKey = '';

  watch(
    () => {
      const session = options.selectedSession.value;
      return [
        session ? sessionKey(session) : '',
        options.blocked.value,
      ] as const;
    },
    ([key, blocked]) => {
      if (!key) {
        loadGeneration += 1;
        loadedSessionKey = '';
        checkpoints.value = [];
        loading.value = false;
        notice.value = '';
        return;
      }

      if (key !== loadedSessionKey) {
        loadGeneration += 1;
        checkpoints.value = [];
        notice.value = '';
        loading.value = false;
        if (!blocked) {
          void load();
        }
      }
    },
    { immediate: true },
  );

  async function load(): Promise<boolean> {
    const session = options.selectedSession.value;
    if (!session || options.blocked.value) {
      return false;
    }

    const requestSessionKey = sessionKey(session);
    const requestGeneration = ++loadGeneration;
    loading.value = true;
    notice.value = '';

    try {
      const result = await options.client.listPlayCheckpoints(session.id);
      if (
        requestGeneration !== loadGeneration ||
        sessionKey(options.selectedSession.value) !== requestSessionKey
      ) {
        return false;
      }

      checkpoints.value = result.checkpoints;
      loadedSessionKey = requestSessionKey;
      return true;
    } catch (error) {
      if (requestGeneration === loadGeneration) {
        options.onError(error);
      }
      return false;
    } finally {
      if (requestGeneration === loadGeneration) {
        loading.value = false;
      }
    }
  }

  async function restore(artifactId: string): Promise<boolean> {
    const session = options.selectedSession.value;
    const checkpoint = checkpoints.value.find((item) => item.artifactId === artifactId);
    if (
      !session ||
      !artifactId ||
      options.blocked.value ||
      loading.value ||
      busyArtifactId.value ||
      !checkpoint?.restorable
    ) {
      return false;
    }

    busyArtifactId.value = artifactId;
    notice.value = '';

    try {
      const result = await options.client.restorePlayCheckpoint(
        session.id,
        artifactId,
        { baseRevision: session.revision },
      );

      loadGeneration += 1;
      checkpoints.value = result.checkpoints;
      loadedSessionKey = sessionKey(result.session);
      notice.value = 'Checkpoint restored. Later turns remain available as variants.';
      options.onRestored(result.session);
      return true;
    } catch (error) {
      options.onError(error);
      return false;
    } finally {
      busyArtifactId.value = '';
    }
  }

  return {
    checkpoints: readonly(checkpoints),
    busyArtifactId: readonly(busyArtifactId),
    loading: readonly(loading),
    notice: readonly(notice),
    load,
    restore,
  };
}

function sessionKey(session: Pick<PlaySession, 'id' | 'revision'> | undefined): string {
  return session ? `${session.id}:${session.revision}` : '';
}
