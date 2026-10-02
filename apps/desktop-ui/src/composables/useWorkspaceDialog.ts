import { nextTick, onBeforeUnmount, onMounted, type ShallowRef } from 'vue';

/** Keep keyboard focus within an open modal and restore its invoking control. */
export function useWorkspaceDialog(panel: ShallowRef<HTMLElement | null>, close: () => void) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  onMounted(async () => {
    await nextTick();
    panel.value?.querySelector<HTMLElement>('input, button')?.focus();
  });
  onBeforeUnmount(() => { if (previous?.isConnected) previous.focus(); });
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const elements = [...(panel.value?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]') ?? [])];
    const first = elements[0]; const last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return { keydown };
}
