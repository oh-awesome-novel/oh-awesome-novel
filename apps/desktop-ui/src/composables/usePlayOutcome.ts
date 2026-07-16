import { computed, readonly, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  PlayOutcomeItem,
  PlayOutcomeItemKind,
  PlayOutcomeProjection,
  PlayOutcomeReport,
  PlaySession,
  PlayWritingReferenceAttachment,
} from './useWorkspaceApi';

export interface PlayOutcomeGroup {
  kind: PlayOutcomeItemKind;
  label: string;
  items: PlayOutcomeItem[];
}

export const MAX_PLAY_OUTCOME_ATTACHMENT_ITEMS = 24;

export interface UsePlayOutcomeOptions {
  session: Readonly<Ref<PlaySession>>;
  showSpoilers: Readonly<Ref<boolean>>;
  onWritingReferencesUpdated?: () => void;
}

const OUTCOME_KIND_ORDER: PlayOutcomeItemKind[] = [
  'sceneSummary',
  'goalAssessment',
  'participantFootprint',
  'worldChange',
  'writingMaterial',
];

export function usePlayOutcome(options: UsePlayOutcomeOptions) {
  const client = useWorkspaceApi();
  const storedReport = shallowRef<PlayOutcomeReport>();
  const reportFingerprint = shallowRef('');
  const reportStatus = shallowRef<'idle' | 'missing' | 'current' | 'stale'>('idle');
  const storedStaleReasons = shallowRef<string[]>([]);
  const loading = shallowRef(false);
  const generating = shallowRef(false);
  const storedError = shallowRef('');
  const notice = shallowRef('');
  const selectedItemIds = shallowRef<string[]>([]);
  const attachments = shallowRef<PlayWritingReferenceAttachment[]>([]);
  const attachmentsLoading = shallowRef(false);
  const attachmentCreating = shallowRef(false);
  const detachingAttachmentId = shallowRef('');
  let loadEpoch = 0;

  const projection = computed<PlayOutcomeProjection>(() =>
    options.showSpoilers.value ? 'director' : 'player',
  );
  const error = computed(() => {
    if (!storedError.value) return '';
    return projection.value === 'player'
      ? 'Outcome Report could not be loaded for the Player lens.'
      : storedError.value;
  });
  const report = computed(() => projectPlayOutcomeReportForUi(
    storedReport.value,
    projection.value,
  ));
  const staleReasons = computed(() => projection.value === 'director'
    ? [...storedStaleReasons.value]
    : sanitizePlayerStaleReasons(storedStaleReasons.value));
  const visibleItems = computed(() => report.value?.items ?? []);
  const visibleItemIds = computed(() => new Set(visibleItems.value.map((item) => item.id)));
  const visibleSelectedItemIds = computed(() =>
    selectedItemIds.value.filter((id) => visibleItemIds.value.has(id)),
  );
  const groups = computed<PlayOutcomeGroup[]>(() =>
    OUTCOME_KIND_ORDER.flatMap((kind) => {
      const items = visibleItems.value.filter((item) => item.kind === kind);
      return items.length ? [{ kind, label: formatOutcomeKind(kind), items }] : [];
    }),
  );
  const sessionAttachments = computed(() =>
    attachments.value.filter((attachment) =>
      attachment.sessionId === options.session.value.id && (
        projection.value === 'director' ||
        attachment.selectedOutcomeItemRefs.every((id) => visibleItemIds.value.has(id))
      )),
  );
  const actionsDisabled = computed(() =>
    reportStatus.value !== 'current' ||
    loading.value ||
    generating.value ||
    attachmentCreating.value,
  );
  const selectionLimitReached = computed(() =>
    visibleSelectedItemIds.value.length >= MAX_PLAY_OUTCOME_ATTACHMENT_ITEMS,
  );

  watch(
    [
      () => options.session.value.id,
      () => options.session.value.revision,
      projection,
    ],
    () => {
      selectedItemIds.value = [];
      notice.value = '';
      reportFingerprint.value = '';
      void refreshReport({ silentMissing: true });
      void refreshAttachments();
    },
    { immediate: true, flush: 'sync' },
  );

  watch(visibleItemIds, (ids) => {
    selectedItemIds.value = selectedItemIds.value.filter((id) => ids.has(id));
  });

  async function refreshReport({ silentMissing = false } = {}) {
    const epoch = ++loadEpoch;
    const session = options.session.value;
    loading.value = true;
    reportFingerprint.value = '';
    storedError.value = '';

    try {
      const result = await client.getPlayOutcomeReport(session.id, {
        baseRevision: session.revision,
        projection: projection.value,
      });
      if (epoch !== loadEpoch) return;
      storedReport.value = result.report;
      reportFingerprint.value = result.reportFingerprint;
      reportStatus.value = result.status;
      storedStaleReasons.value = result.staleReasons;
    } catch (caught) {
      if (epoch !== loadEpoch) return;
      storedReport.value = undefined;
      reportFingerprint.value = '';
      storedStaleReasons.value = [];
      if (isRequestStatus(caught, 404)) {
        reportStatus.value = 'missing';
        if (!silentMissing) storedError.value = toErrorMessage(caught);
      } else {
        reportStatus.value = 'idle';
        storedError.value = toErrorMessage(caught);
      }
    } finally {
      if (epoch === loadEpoch) loading.value = false;
    }
  }

  async function generateReport(): Promise<boolean> {
    if (generating.value) return false;
    const epoch = ++loadEpoch;
    const session = options.session.value;
    generating.value = true;
    reportFingerprint.value = '';
    storedError.value = '';
    notice.value = '';

    try {
      const result = await client.generatePlayOutcomeReport(session.id, {
        baseRevision: session.revision,
        projection: projection.value,
      });
      if (epoch !== loadEpoch) return false;
      storedReport.value = result.report;
      reportFingerprint.value = result.reportFingerprint;
      reportStatus.value = result.status;
      storedStaleReasons.value = result.staleReasons;
      selectedItemIds.value = [];
      notice.value = 'Outcome Report 已从当前 committed selected branch 生成。';
      return true;
    } catch (caught) {
      if (epoch !== loadEpoch) return false;
      storedError.value = toErrorMessage(caught);
      return false;
    } finally {
      generating.value = false;
    }
  }

  function toggleItemSelection(itemId: string): void {
    if (actionsDisabled.value || !visibleItemIds.value.has(itemId)) return;
    if (
      !selectedItemIds.value.includes(itemId) &&
      selectedItemIds.value.length >= MAX_PLAY_OUTCOME_ATTACHMENT_ITEMS
    ) return;
    selectedItemIds.value = selectedItemIds.value.includes(itemId)
      ? selectedItemIds.value.filter((id) => id !== itemId)
      : [...selectedItemIds.value, itemId];
  }

  async function createWritingReference(): Promise<boolean> {
    const selectedOutcomeItemIds = [...visibleSelectedItemIds.value];
    if (actionsDisabled.value || selectedOutcomeItemIds.length === 0) return false;
    const session = options.session.value;
    attachmentCreating.value = true;
    storedError.value = '';
    notice.value = '';

    try {
      const result = await client.createPlayWritingReferenceAttachment({
        sessionId: session.id,
        baseRevision: session.revision,
        selectedOutcomeItemIds,
      });
      replaceAttachment(result.attachment);
      selectedItemIds.value = [];
      notice.value = 'Writing Reference 已创建；只有写作请求显式选择它时才会进入上下文。';
      options.onWritingReferencesUpdated?.();
      return true;
    } catch (caught) {
      storedError.value = toErrorMessage(caught);
      return false;
    } finally {
      attachmentCreating.value = false;
    }
  }

  async function refreshAttachments(): Promise<void> {
    attachmentsLoading.value = true;
    try {
      const result = await client.listPlayWritingReferenceAttachments();
      attachments.value = result.attachments;
    } catch (caught) {
      storedError.value = toErrorMessage(caught);
    } finally {
      attachmentsLoading.value = false;
    }
  }

  async function detachWritingReference(attachmentId: string): Promise<boolean> {
    if (detachingAttachmentId.value) return false;
    detachingAttachmentId.value = attachmentId;
    storedError.value = '';
    notice.value = '';

    try {
      const result = await client.detachPlayWritingReferenceAttachment(attachmentId);
      replaceAttachment(result.attachment);
      notice.value = 'Writing Reference 已 detach；审计文件保留，但不会再进入写作上下文。';
      options.onWritingReferencesUpdated?.();
      return true;
    } catch (caught) {
      storedError.value = toErrorMessage(caught);
      return false;
    } finally {
      detachingAttachmentId.value = '';
    }
  }

  function replaceAttachment(attachment: PlayWritingReferenceAttachment): void {
    attachments.value = [
      attachment,
      ...attachments.value.filter((candidate) => candidate.id !== attachment.id),
    ];
  }

  return {
    report,
    reportFingerprint: readonly(reportFingerprint),
    reportStatus: readonly(reportStatus),
    staleReasons,
    loading: readonly(loading),
    generating: readonly(generating),
    error,
    notice: readonly(notice),
    selectedItemIds: visibleSelectedItemIds,
    groups,
    projection,
    sessionAttachments,
    attachmentsLoading: readonly(attachmentsLoading),
    attachmentCreating: readonly(attachmentCreating),
    detachingAttachmentId: readonly(detachingAttachmentId),
    actionsDisabled,
    selectionLimitReached,
    createWritingReference,
    detachWritingReference,
    generateReport,
    refreshAttachments,
    refreshReport,
    toggleItemSelection,
  };
}

export function projectPlayOutcomeReportForUi(
  report: PlayOutcomeReport | undefined,
  projection: PlayOutcomeProjection,
): PlayOutcomeReport | undefined {
  if (!report || projection === 'director') return report;

  return {
    ...report,
    selectedArtifactTurnRefs: [],
    sourceSnapshots: [],
    items: report.items
      .filter((item) => item.visibility !== 'playerUnknown')
      .map((item) => ({
        ...item,
        artifactTurnRefs: [],
        messageRefs: [],
        eventRefs: [],
        observationRefs: [],
        evidenceRefs: [],
        sourceRefs: [],
        participantRefs: [],
      })),
  };
}

export function sanitizePlayerStaleReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons.map((reason) =>
    reason.startsWith('sourceContentChanged:') || reason.startsWith('sourceUnavailable:')
      ? 'sourceSnapshotChanged'
      : reason,
  ))];
}

function formatOutcomeKind(kind: PlayOutcomeItemKind): string {
  if (kind === 'sceneSummary') return 'Scene summary';
  if (kind === 'goalAssessment') return 'Goal assessment';
  if (kind === 'participantFootprint') return 'Character footprint';
  if (kind === 'worldChange') return 'World changes';
  return 'Writing material';
}

function isRequestStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null &&
    'status' in error && error.status === status;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
