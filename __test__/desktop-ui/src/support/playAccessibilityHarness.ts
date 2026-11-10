export const PLAY_WINDOW_CONTROL_NAMES = [
  '载入更早的记录',
  '载入更早的事件',
] as const;

export const PLAY_SOURCE_DRIFT_CONTROL_NAMES = [
  '沿用开局时的内容',
  '按当前文件重组',
  '另开会话',
] as const;

export const PLAY_DIRECTOR_CONTROL_NAMES = [
  '采用',
  '修改',
  '重演',
  '插入角色',
  '授予认知',
  '完成试演',
  '取消',
] as const;

export const PLAY_MODIFY_MODE_NAMES = [
  '修改呈现',
  '改变走向',
] as const;

export type PlayDirectorControlName = typeof PLAY_DIRECTOR_CONTROL_NAMES[number];

export interface PlayNativeButtonContract {
  name: string;
  button: HTMLButtonElement;
  describedBy?: HTMLElement;
}

/**
 * Finds a control by the small accessible-name subset used by Play fixtures.
 * Product tests deliberately require a native button so Chromium provides the
 * expected Enter/Space behavior without a custom role=button implementation.
 */
export function getNativeButtonContract(
  root: ParentNode,
  name: string,
): PlayNativeButtonContract {
  const button = Array.from(root.querySelectorAll('button')).find(
    (candidate) => accessibleName(candidate) === name,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing native Play button with accessible name: ${name}`);
  }

  const descriptionOwner = button.hasAttribute('aria-describedby')
    ? button
    : button.closest<HTMLElement>('[aria-describedby]');
  const describedById = descriptionOwner?.getAttribute('aria-describedby')?.trim();
  const describedByCandidate = describedById
    ? button.ownerDocument.getElementById(describedById) ?? undefined
    : undefined;
  const describedBy = describedByCandidate && root.contains(describedByCandidate)
    ? describedByCandidate
    : undefined;

  return {
    name,
    button,
    ...(describedBy ? { describedBy } : {}),
  };
}

export function getNativeButtonContracts(
  root: ParentNode,
  names: readonly string[],
): PlayNativeButtonContract[] {
  return names.map((name) => getNativeButtonContract(root, name));
}

export function getPlayStatusRegions(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="status"][aria-live]'));
}

export function focusControl(contract: PlayNativeButtonContract): void {
  contract.button.focus();
  if (document.activeElement !== contract.button) {
    throw new Error(`Play control did not receive focus: ${contract.name}`);
  }
}

export function activateFocusedControl(contract: PlayNativeButtonContract): void {
  focusControl(contract);
  contract.button.click();
}

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby')?.trim();
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/u)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (label) return normalizeWhitespace(label);
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  return normalizeWhitespace(ariaLabel || element.textContent || '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
