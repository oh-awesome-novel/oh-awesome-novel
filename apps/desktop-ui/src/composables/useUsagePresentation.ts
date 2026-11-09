import { nextTick, onScopeDispose, shallowRef, watch } from 'vue';
import type { UsageInspectorScope, UsagePresentationInput } from '@oh-awesome-novel/client';
import { oanClient } from '../client';

/** Ephemeral renderer observation; never confused with provider timestamps. */
export interface UsagePresentationRun {
  localId: string;
  scope: UsageInspectorScope;
  operationId?: string;
  startedAtMs: number;
  finished: boolean;
  responseIds: readonly string[];
  attemptId?: string;
  stepId?: string;
}

export function measureRenderedUsagePresentation(
  run: Readonly<UsagePresentationRun>,
  root: HTMLElement | null | undefined,
  now = performance.now(),
): UsagePresentationInput | undefined {
  if (!run.operationId || !root?.isConnected || root.ownerDocument.visibilityState === 'hidden') return undefined;
  const response = Array.from(root.querySelectorAll<HTMLElement>(
    '[data-usage-operation], [data-usage-message], [data-usage-step], [data-usage-result-operation]',
  )).find(element => isRendered(element) && Boolean(element.textContent?.trim()) && (
    element.dataset.usageOperation === run.operationId
    || element.dataset.usageResultOperation === run.operationId
    || (element.dataset.usageMessage !== undefined && run.responseIds.includes(element.dataset.usageMessage))
    || (element.dataset.usageStep !== undefined && run.responseIds.includes(element.dataset.usageStep))
  ));
  if (!response) return undefined;
  const elapsedMs = Math.round(now - run.startedAtMs);
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 3_600_000) return undefined;
  return { operationId: run.operationId, elapsedMs,
    ...(run.attemptId ? { attemptId: run.attemptId } : {}),
    ...(run.stepId ? { stepId: run.stepId } : {}),
  };
}

function isRendered(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    if (current.tagName === 'DETAILS' && !current.hasAttribute('open')
      && !current.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}

/** Observe the actual rendered response; persist once the matching call is terminal. */
export function useUsagePresentation(input: {
  identity: () => string;
  run: () => Readonly<UsagePresentationRun> | undefined;
  element: () => HTMLElement | null | undefined;
}) {
  const revision = shallowRef(0);
  let observer: MutationObserver | undefined;
  let observedElement: HTMLElement | undefined;
  let currentId = '';
  let sample: UsagePresentationInput | undefined;
  let posted = false;
  let generation = 0;
  let disposed = false;

  async function observe(): Promise<void> {
    const version = generation;
    await nextTick();
    if (disposed || version !== generation) return;
    const run = input.run();
    if (!run) return;
    if (currentId !== run.localId) { currentId = run.localId; sample = undefined; posted = false; }
    sample ??= measureRenderedUsagePresentation(run, input.element());
    if (!sample || !run.finished || posted) return;
    posted = true;
    const scope = run.scope;
    try {
      if (scope.domain === 'play') await oanClient.recordPlayUsagePresentation(scope.sessionId, sample);
      else await oanClient.recordReferenceUsagePresentation(scope.referenceId, scope.runId, sample);
      if (!disposed && version === generation) revision.value++;
    } catch {
      // Missing telemetry must not fail or replay a story operation.
    }
  }

  function attach(): void {
    const element = input.element() ?? undefined;
    if (element === observedElement) return;
    observer?.disconnect(); observer = undefined; observedElement = element;
    if (element && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => { void observe(); });
      observer.observe(element, { childList: true, characterData: true, attributes: true, subtree: true });
    }
  }
  function reset(): void {
    generation++; currentId = ''; sample = undefined; posted = false;
    observer?.disconnect(); observer = undefined; observedElement = undefined;
  }
  watch(input.identity, reset, { flush: 'sync' });
  watch(() => [input.run(), input.element()], () => { attach(); void observe(); }, { flush: 'post' });
  onScopeDispose(() => { disposed = true; reset(); });
  return { revision, observe };
}
