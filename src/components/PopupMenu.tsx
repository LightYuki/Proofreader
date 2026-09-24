import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { announceMenuOpen, MENU_OPEN_EVENT, restoreRemovedFocus } from './menuEvents';
import styles from '../App.module.css';

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<unknown>;
}

interface PopupMenuProps {
  id?: string;
  label: string;
  anchor: HTMLElement;
  items: MenuItem[];
  point?: { x: number; y: number };
  focusLast?: boolean;
  onClose: () => void;
}

export function PopupMenu({ id, label, anchor, items, point, focusLast, onClose }: PopupMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const owner = useRef({});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const focused = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const host = anchor.closest('dialog[open]') ?? anchor.closest('[data-menu-root]');

  function dismiss(restoreFocus: boolean) {
    closeRef.current();
    if (!restoreFocus) return;
    if (anchor.isConnected && !anchor.closest('[inert]')) anchor.focus({ preventScroll: true });
    else host?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    dismiss(true);
    void Promise.resolve(item.onSelect()).then(() => restoreRemovedFocus(anchor, host));
  }

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const trigger = anchor.getBoundingClientRect();
    const x = point?.x ?? trigger.left;
    const y = point?.y ?? trigger.bottom + 4;
    const left = Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8));
    setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top });
    const enabled = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    if (position && (!focused.current || (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled))) {
      focused.current = true;
      (focusLast ? enabled.at(-1) : enabled[0])?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    announceMenuOpen(owner.current);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !anchor.contains(event.target)) closeRef.current();
    };
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !anchor.contains(event.target)) closeRef.current();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) closeRef.current();
    };
    const close = () => closeRef.current();
    const otherMenu = (event: Event) => { if ((event as CustomEvent).detail !== owner.current) close(); };
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected || anchor.closest('[inert]') || (host instanceof HTMLDialogElement && !host.open)) close();
    });
    if (host) observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'inert'] });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener(MENU_OPEN_EVENT, otherMenu);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focusOutside);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener(MENU_OPEN_EVENT, otherMenu);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [anchor, host]);

  if (!host) return null;
  const withIcons = items.some(item => item.icon);
  return createPortal(<div ref={menuRef} id={id} role="menu" aria-label={label} data-popup-menu
    className={`${styles.menu} ${styles.popupMenu}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if ((event.ctrlKey || event.metaKey) && ['o', 's', 'w', 'f', 'g', 'Enter'].includes(event.key === 'Enter' ? event.key : event.key.toLowerCase())) {
        event.preventDefault();
        const command = items.find(item => item.shortcut === `Ctrl+${event.key.toUpperCase()}`);
        if (command) select(command);
        return;
      }
      if (event.key === 'F8') { event.preventDefault(); return; }
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); dismiss(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
        buttons[next]?.scrollIntoView({ block: 'nearest' });
      }
    }}>
    {items.map(item => <div key={item.id} role="none">
      {item.separatorBefore && <div className={styles.menuDivider} role="separator" />}
      <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
        onPointerMove={event => { if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true }); }}
        onClick={() => select(item)}>
        {withIcons && (item.icon ?? <span className={styles.iconSpace} />)}{item.label}{item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>
    </div>)}
  </div>, host);
}
