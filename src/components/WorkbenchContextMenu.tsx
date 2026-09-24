import { useEffect, useRef, useState } from 'react';
import type { useWorkbench } from '../features/review/useWorkbench';
import { PopupMenu, type MenuItem } from './PopupMenu';
import { announceMenuOpen } from './menuEvents';

type Workbench = ReturnType<typeof useWorkbench>;
type ContextTarget =
  | { kind: 'row'; documentId: string; index: number }
  | { kind: 'review'; documentId: string; index: number; part: string }
  | { kind: 'tab' | 'recent'; id: string };

interface ContextState {
  key: number;
  target: ContextTarget;
  scope: HTMLElement;
  anchor: HTMLElement;
  point: { x: number; y: number };
  selection: string;
  modal: string | null;
}

interface ContextMenuProps {
  workbench: Workbench;
  modal: string | null;
  onCloseRecent: () => void;
  onNavigate: (mode: 'find' | 'jump') => void;
}

const textInput = (element: Element) => element.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');

function selectedText(scope: HTMLElement, point?: { x: number; y: number }): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount
    || !scope.contains(selection.anchorNode) || !scope.contains(selection.focusNode)) return '';
  // A stale selection in another part of the same row is not the right-click target.
  if (point && ![...selection.getRangeAt(0).getClientRects()].some(rect => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) return '';
  return selection.toString();
}

export function WorkbenchContextMenu(props: ContextMenuProps) {
  const latest = useRef(props);
  latest.current = props;
  const [menu, setMenu] = useState<ContextState | null>(null);
  const sequence = useRef(0);

  function resolve(state: ContextState): MenuItem[] {
    const { workbench, modal, onCloseRecent, onNavigate } = latest.current;
    const { target } = state;
    if (workbench.loading || !workbench.workspaceReady || modal !== state.modal || !state.scope.isConnected || state.scope.closest('[inert]')) return [];
    const copy = (id: string, label: string, value: string): MenuItem => ({ id, label, onSelect: () => workbench.copyText(value) });
    const selection = state.selection ? [copy('selection', '复制选中文本', state.selection)] : [];
    if (target.kind === 'row' || target.kind === 'review') {
      const doc = workbench.document;
      if (!doc || doc.id !== target.documentId) return [];
      const line = doc.entries[target.index];
      if (!line) return [];
      const review = workbench.reviews[target.index];
      if (target.kind === 'row') {
        const translation = review?.status === 'accepted' ? review.acceptedText ?? review.draft : line.translation;
        return [...selection, copy('source', '复制本条原文', line.source), copy('translation', '复制本条当前译文', translation),
          { id: 'edit', label: '编辑本条译文', separatorBefore: true, onSelect: () => {
            workbench.selectIndex(target.index);
            requestAnimationFrame(() => {
              const current = latest.current;
              if (!current.modal && !current.workbench.loading && current.workbench.document?.id === target.documentId && current.workbench.selectedIndex === target.index) {
                document.getElementById('translation-draft')?.focus();
              }
            });
          } },
          { id: 'find', label: '查找正文…', shortcut: 'Ctrl+F', separatorBefore: true, onSelect: () => onNavigate('find') },
          { id: 'jump', label: '跳转到行…', shortcut: 'Ctrl+G', onSelect: () => onNavigate('jump') }];
      }
      if (workbench.selectedIndex !== target.index) return [];
      if (target.part === 'original') return [...selection, copy('original', '复制原译文', line.translation)];
      if (target.part === 'reason' && review) return [...selection, copy('reason', '复制修改理由', review.reason)];
      if (target.part === 'evidence' && review?.evidence) return [...selection, copy('evidence', '复制上下文依据', review.evidence)];
      return target.part === 'diff' ? selection : [];
    }
    const session = (target.kind === 'tab' ? workbench.openSessions : workbench.recentSessions).find(value => value.id === target.id);
    if (!session) return [];
    const paths = [copy('target-path', '复制译文路径', session.targetPath), copy('source-path', '复制原文路径', session.sourcePath)];
    if (target.kind === 'tab') return [
      { id: 'close', label: '关闭此文件', onSelect: () => workbench.closeSession(session.id) },
      { ...paths[0], separatorBefore: true }, paths[1],
    ];
    const opened = workbench.openSessions.some(value => value.id === session.id);
    return [
      { id: 'open', label: opened ? '切换到此文件' : '打开此文件', onSelect: async () => {
        if (await workbench.switchSession(session.id) && latest.current.modal === 'recent') onCloseRecent();
      } },
      { ...paths[0], separatorBefore: true }, paths[1],
      ...(!opened ? [{ id: 'hide', label: '从最近列表隐藏', separatorBefore: true, onSelect: () => workbench.hideRecent(session.id) }] : []),
    ];
  }

  // Use current state for commands, even if model results arrived while the menu was open.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    function open(element: HTMLElement, point?: { x: number; y: number }) {
      const { workbench, modal } = latest.current;
      if (workbench.loading || !workbench.workspaceReady || element.closest('[inert]')) { setMenu(null); return; }
      const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
      if (dialog && !dialog.contains(element)) return;
      const scope = element.closest<HTMLElement>('[data-context-row], [data-context-copy], [data-context-tab], [data-context-recent]');
      if (!scope) { setMenu(null); return; }
      let target: ContextTarget;
      if (scope.dataset.contextTab) target = { kind: 'tab', id: scope.dataset.contextTab };
      else if (scope.dataset.contextRecent) target = { kind: 'recent', id: scope.dataset.contextRecent };
      else {
        if (!workbench.document || modal) return;
        target = scope.dataset.contextRow !== undefined
          ? { kind: 'row', documentId: workbench.document.id, index: Number(scope.dataset.contextRow) }
          : { kind: 'review', documentId: workbench.document.id, index: workbench.selectedIndex, part: scope.dataset.contextCopy! };
      }
      const anchor = element.closest<HTMLElement>('button, [tabindex]') ?? scope.querySelector<HTMLElement>('button, [tabindex]') ?? scope;
      const rect = anchor.getBoundingClientRect();
      const state: ContextState = { key: ++sequence.current, target, scope, anchor, point: point ?? { x: rect.left, y: rect.bottom },
        selection: selectedText(scope, point), modal };
      setMenu(resolveRef.current(state).length ? state : null);
    }
    const contextmenu = (event: MouseEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : event.target instanceof Element ? event.target.parentElement : null;
      if (!element?.closest('[data-menu-root]')) return;
      if (element.closest('[data-popup-menu]')) { event.preventDefault(); return; }
      announceMenuOpen(null);
      if (textInput(element)) { setMenu(null); return; }
      event.preventDefault();
      open(element, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (!element?.closest('[data-menu-root]') || textInput(element) || element.closest('[data-popup-menu]')) return;
      event.preventDefault(); announceMenuOpen(null); open(element);
    };
    document.addEventListener('contextmenu', contextmenu);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('contextmenu', contextmenu); document.removeEventListener('keydown', keyboard); };
  }, []);

  const items = menu ? resolve(menu) : [];
  const valid = items.length > 0;
  useEffect(() => { if (menu && !valid) setMenu(null); }, [menu, valid]);
  if (!menu || !valid) return null;
  return <PopupMenu key={menu.key} label="操作菜单" anchor={menu.anchor} point={menu.point} onClose={() => setMenu(null)}
    items={items.map(item => ({ ...item, onSelect: () => {
      const current = resolveRef.current(menu).find(value => value.id === item.id);
      if (current && !current.disabled) return current.onSelect();
    } }))} />;
}
