import { useEffect, useRef, useState } from 'react';
import type { BatchState, ReviewItem } from '../../../types';
import { reviewIndicator } from './presentation';
import styles from '../../../App.module.css';

export function ReviewStatus({ review, batchStatus }: { review?: ReviewItem; batchStatus?: BatchState['status'] }) {
  const indicator = reviewIndicator(review, batchStatus);
  const [dismissed, setDismissed] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && triggerRef.current?.matches(':hover, :focus-visible')) setDismissed(true);
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);

  return <span ref={triggerRef} className={styles.reviewIndicator} data-tone={indicator.tone} data-dismissed={dismissed || undefined}
    tabIndex={0} role="img" aria-label={`${indicator.label}：${indicator.description}`}
    onPointerEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)}>
    <span className={styles.indicatorTooltip} aria-hidden="true"><strong>{indicator.label}</strong><span>{indicator.description}</span></span>
  </span>;
}
