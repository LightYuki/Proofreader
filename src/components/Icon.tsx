import styles from '../App.module.css';

const paths = {
  open: 'M2.5 5.5V3.5h5l2 2h8v11h-15v-11Zm0 2h15',
  play: 'm7 4 9 6-9 6V4Z',
  stop: 'M5 5h10v10H5z',
  left: 'm12 5-5 5 5 5',
  right: 'm8 5 5 5-5 5',
  list: 'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01',
  save: 'M4 3h10l3 3v11H3V3h1Zm2 0v5h7V3M6 17v-6h8v6',
  close: 'm5 5 10 10M15 5 5 15',
  check: 'm4 10 4 4 8-8',
  undo: 'M7 4 3 8l4 4M3 8h9a5 5 0 0 1 0 10',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className={styles.icon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
