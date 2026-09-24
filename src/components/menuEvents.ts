// File menus, context menus and model lists share one transient open surface.
export const MENU_OPEN_EVENT = 'proofread:menu-open';

export function announceMenuOpen(owner: object | null) {
  document.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: owner }));
}

export function restoreRemovedFocus(anchor: HTMLElement, host: Element | null) {
  requestAnimationFrame(() => {
    if (anchor.isConnected || !host?.isConnected || (host instanceof HTMLDialogElement && !host.open)) return;
    if (document.activeElement !== document.body && document.activeElement !== host) return;
    const next = host.querySelector<HTMLElement>('[data-context-recent] button:not(:disabled)') ?? host.querySelector<HTMLElement>('button:not(:disabled)');
    next?.focus({ preventScroll: true });
  });
}
