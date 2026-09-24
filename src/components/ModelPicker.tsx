import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { announceMenuOpen, MENU_OPEN_EVENT } from './menuEvents';
import styles from '../App.module.css';

interface ModelPickerProps {
  value: string;
  models: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}

export function ModelPicker({ value, models, disabled, onChange }: ModelPickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState('');
  const owner = useRef({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const matching = useMemo(() => models.filter(model => model.toLowerCase().includes(query.toLowerCase())), [models, query]);
  const visible = matching.slice(0, 100);
  useEffect(() => { setOpen(models.length > 0); setQuery(''); setActive(-1); }, [models]);
  useEffect(() => {
    const otherMenu = (event: Event) => { if ((event as CustomEvent).detail !== owner.current) setOpen(false); };
    document.addEventListener(MENU_OPEN_EVENT, otherMenu);
    return () => document.removeEventListener(MENU_OPEN_EVENT, otherMenu);
  }, []);
  useEffect(() => { if (open) announceMenuOpen(owner.current); }, [open]);
  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, query, models]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function choose(model: string) { onChange(model); setOpen(false); setQuery(''); setActive(-1); }

  return <div className={styles.modelPicker} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <div className={styles.modelInput}>
      <input ref={inputRef} id="model-name" role="combobox" aria-autocomplete="list" aria-expanded={open && models.length > 0} aria-controls={listId} aria-activedescendant={open && active >= 0 && visible[active] ? `${listId}-${active}` : undefined} disabled={disabled} value={value} required autoComplete="off" spellCheck={false} placeholder="选择或输入模型名称" onChange={event => {
        onChange(event.target.value); setQuery(event.target.value); setActive(-1); setOpen(true);
      }} onFocus={() => { setQuery(''); setOpen(models.length > 0); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!visible.length) return;
          event.preventDefault(); setOpen(true);
          setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % visible.length : (previous <= 0 ? visible.length - 1 : previous - 1));
        }
        if (event.key === 'Enter' && open && active >= 0 && visible[active]) { event.preventDefault(); choose(visible[active]); }
      }} />
      <button type="button" className={styles.modelToggle} aria-label={open ? '收起模型列表' : '展开模型列表'} aria-expanded={open && models.length > 0} aria-controls={listId} disabled={disabled || !models.length} onMouseDown={event => event.preventDefault()} onClick={() => { const next = !open; inputRef.current?.focus(); setQuery(''); setActive(-1); setOpen(next); }}>⌄</button>
    </div>
    {open && models.length > 0 && <div className={styles.modelOptions}>
      <div ref={listRef} role="listbox" id={listId} aria-label="可用模型">
        {visible.map((model, index) => <button type="button" role="option" id={`${listId}-${index}`} data-option-index={index} key={model} tabIndex={-1} aria-selected={value === model} className={index === active ? styles.highlightedModel : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(model)} title={model}>{model}</button>)}
      </div>
      {(!visible.length || matching.length > visible.length) && <p className={styles.modelListHint}>{visible.length ? '输入名称以筛选更多模型' : '没有匹配项，可以直接使用输入的名称'}</p>}
    </div>}
  </div>;
}
