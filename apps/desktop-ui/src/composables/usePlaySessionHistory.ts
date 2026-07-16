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
    checkpointId: string,
    input: { baseRevision: number },
  ): Promise<PlayCheckpointRestoreResult>;
  renamePlayCheckpoint?(
    id: string,
    checkpointId: string,
    input: { baseRevision: number; name: string },
  ): Promise<{
    session: PlaySession;
    checkpoints: PlayCheckpointSummary[];
    renamedCheckpointId: string;
  }>;
}

export interface UsePlaySessionHistoryOptions {
  client: PlaySessionHistoryClient;
  selectedSession: ComputedRef<PlaySession | undefined>;
  blocked: ComputedRef<boolean>;
  onRestored(session: PlaySession): void;
  onRenamed?(session: PlaySession): void;
  onError(error: unknown): void;
}

export function usePlaySessionHistory(options: UsePlaySessionHistoryOptions) {
  const checkpoints = shallowRef<PlayCheckpointSummary[]>([]);
  const busyArtifactId = shallowRef('');
  const namingCheckpointId = shallowRef('');
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

  async function restore(checkpointId: string): Promise<boolean> {
    const session = options.selectedSession.value;
    const checkpoint = checkpoints.value.find((item) =>
      checkpointIdOf(item) === checkpointId);
    if (
      !session ||
      !checkpointId ||
      options.blocked.value ||
      loading.value ||
      busyArtifactId.value ||
      namingCheckpointId.value ||
      !checkpoint?.restorable
    ) {
      return false;
    }

    busyArtifactId.value = checkpointId;
    notice.value = '';

    try {
      const result = await options.client.restorePlayCheckpoint(
        session.id,
        checkpointId,
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

  async function rename(checkpointId: string, name: string): Promise<boolean> {
    const session = options.selectedSession.value;
    const checkpoint = checkpoints.value.find((item) =>
      checkpointIdOf(item) === checkpointId);
    const normalizedName = name.trim();
    if (
      !session ||
      !checkpoint ||
      !normalizedName ||
      normalizedName.length > 80 ||
      normalizedName === checkpointNameOf(checkpoint) ||
      options.blocked.value ||
      loading.value ||
      busyArtifactId.value ||
      namingCheckpointId.value
    ) {
      return false;
    }

    const renamePlayCheckpoint = options.client.renamePlayCheckpoint;
    if (!renamePlayCheckpoint) {
      options.onError(new Error('Play checkpoint naming is unavailable.'));
      return false;
    }

    namingCheckpointId.value = checkpointId;
    notice.value = '';

    try {
      const result = await renamePlayCheckpoint(
        session.id,
        checkpointId,
        { baseRevision: session.revision, name: normalizedName },
      );

      loadGeneration += 1;
      checkpoints.value = result.checkpoints;
      loadedSessionKey = sessionKey(result.session);
      notice.value = 'Worldline point named.';
      (options.onRenamed ?? options.onRestored)(result.session);
      return true;
    } catch (error) {
      options.onError(error);
      return false;
    } finally {
      namingCheckpointId.value = '';
    }
  }

  return {
    checkpoints: readonly(checkpoints),
    busyArtifactId: readonly(busyArtifactId),
    loading: readonly(loading),
    namingCheckpointId: readonly(namingCheckpointId),
    notice: readonly(notice),
    load,
    rename,
    restore,
  };
}

function checkpointIdOf(checkpoint: PlayCheckpointSummary): string {
  const checkpointId = 'checkpointId' in checkpoint
    ? checkpoint.checkpointId
    : undefined;
  return typeof checkpointId === 'string'
    ? checkpointId
    : checkpoint.artifactId ?? '';
}

function checkpointNameOf(checkpoint: PlayCheckpointSummary): string {
  const name = 'name' in checkpoint ? checkpoint.name : undefined;
  return typeof name === 'string' ? name.trim() : '';
}

function sessionKey(session: Pick<PlaySession, 'id' | 'revision'> | undefined): string {
  return session ? `${session.id}:${session.revision}` : '';
}
