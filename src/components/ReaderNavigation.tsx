import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentSession, ReviewItem } from '../types';
import { findText, type ReaderTarget, type TextMatch } from '../features/review/search';
import { announceMenuOpen } from './menuEvents';
import { Icon } from './Icon';
import styles from '../App.module.css';

export function useReaderNavigation(session: DocumentSession | null, reviews: Record<number, ReviewItem>, onSelect: (index: number) => void) {
  const [mode, setMode] = useState<'find' | 'jump' | null>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [target, setTarget] = useState<ReaderTarget>();
  const [wrapped, setWrapped] = useState('');
  const [openSequence, setOpenSequence] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const matches = useMemo(() => session && mode === 'find' ? findText(session.entries, reviews, query) : [], [session, reviews, query, mode]);
  useEffect(() => { setMode(null); setQuery(''); setActiveId(undefined); setTarget(undefined); }, [session?.id]);
  function open(next: 'find' | 'jump') {
    if (!session) return;
    if (!mode) opener.current = document.activeElement as HTMLElement | null;
    announceMenuOpen(null); setMode(next); setWrapped(''); setOpenSequence(value => value + 1);
  }
  function close(restore = true) {
    setMode(null); setTarget(undefined);
    if (restore) requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('header button')?.focus();
    });
  }
  function locate(match: TextMatch) {
    onSelect(match.index); setActiveId(match.id);
    setTarget({ index: match.index, matchId: match.id, sequence: ++sequence.current });
  }
  function changeQuery(text: string) {
    setQuery(text); setWrapped(''); setActiveId(undefined);
    const first = session ? findText(session.entries, reviews, text)[0] : undefined;
    if (first) locate(first);
  }
  function next(direction: 1 | -1) {
    if (!matches.length) return;
    const index = matches.findIndex(match => match.id === activeId);
    const desired = index < 0 ? direction === 1 ? 0 : matches.length - 1 : index + direction;
    setWrapped(desired < 0 ? '已回到最后一处' : desired >= matches.length ? '已回到第一处' : '');
    locate(matches[(desired + matches.length) % matches.length]);
  }
  function jump(index: number) {
    onSelect(index); setMode(null);
    setTarget({ index, sequence: ++sequence.current });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-context-row="${index}"] button`)?.focus({ preventScroll: true }));
  }
  return { mode, query, matches, activeId, target, wrapped, openSequence, open, close, changeQuery, next, jump };
}

interface ReaderNavigationProps {
  navigation: ReturnType<typeof useReaderNavigation>;
  count: number;
  selectedIndex: number;
}

export function ReaderNavigation({ navigation: nav, count, selectedIndex }: ReaderNavigationProps) {
  const input = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState(String(selectedIndex + 1));
  const [error, setError] = useState('');
  useEffect(() => { input.current?.focus(); input.current?.select(); setError(''); }, [nav.mode, nav.openSequence]);
  function submit() {
    if (nav.mode === 'find') { nav.next(1); return; }
    const value = Number(line);
    if (!/^\d+$/.test(line.trim()) || !Number.isSafeInteger(value) || value < 1 || value > count) { setError(`请输入 1–${count} 的行号`); return; }
    nav.jump(value - 1);
  }
  return <section className={styles.readerNavigation} aria-label={nav.mode === 'find' ? '查找正文' : '跳转到行'} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); nav.close(); }
    if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); event.stopPropagation(); if (nav.mode === 'find' && event.shiftKey) nav.next(-1); else submit(); }
  }}>
    <div className={styles.readerNavigationControls}>
      <label htmlFor="reader-navigation-input">{nav.mode === 'find' ? '查找' : '行号'}</label>
      <input id="reader-navigation-input" ref={input} autoComplete="off" spellCheck={false} inputMode={nav.mode === 'jump' ? 'numeric' : 'text'}
        value={nav.mode === 'find' ? nav.query : line} onChange={event => nav.mode === 'find' ? nav.changeQuery(event.target.value) : (setLine(event.target.value), setError(''))} />
      {nav.mode === 'find' ? <>
        <span className={styles.searchCount} aria-live="polite">{nav.matches.findIndex(match => match.id === nav.activeId) + 1}/{nav.matches.length}</span>
        <button className={styles.iconButton} type="button" disabled={!nav.matches.length} aria-label="上一匹配 (Shift+Enter)" onClick={() => nav.next(-1)}><Icon name="left" /></button>
        <button className={styles.iconButton} type="button" disabled={!nav.matches.length} aria-label="下一匹配 (Enter)" onClick={() => nav.next(1)}><Icon name="right" /></button>
      </> : <button type="button" onClick={submit}>跳转</button>}
      <button className={styles.iconButton} type="button" aria-label="关闭定位栏 (Esc)" onClick={() => nav.close()}><Icon name="close" /></button>
    </div>
    <p className={styles.searchHint} role={error ? 'alert' : 'status'}>{error || (nav.mode === 'find' ? nav.wrapped || (nav.query && !nav.matches.length ? '没有匹配文本' : '原文、当前显示的译文与说话人') : `共 ${count} 条`)}</p>
  </section>;
}
