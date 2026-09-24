import type { BatchState, CheckRound, DocumentSession, Requirements, ReviewItem, StoredSession, WorkspaceState } from '../../types';
import { readRequirements } from '../../config/review';

export const emptyWorkspace = (): WorkspaceState => ({ version: 1, activeId: null, openIds: [], sessions: [] });

/** Reject a damaged cache rather than overwrite it with an empty workspace. */
export function readWorkspace(value: unknown): WorkspaceState {
  const object = (item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item));
  const integer = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  const validReview = (item: unknown) => object(item) && integer(item.index)
    && typeof item.proposed === 'string' && typeof item.draft === 'string' && typeof item.reason === 'string'
    && (item.evidence === undefined || typeof item.evidence === 'string')
    && (item.acceptedText === undefined || typeof item.acceptedText === 'string')
    && (item.manualEdited === undefined || typeof item.manualEdited === 'boolean')
    && (item.roundId === undefined || typeof item.roundId === 'string')
    && ['pending', 'accepted', 'ignored'].includes(String(item.status))
    && (item.status !== 'accepted' || typeof item.acceptedText === 'string');
  const validBatch = (item: unknown) => object(item)
    && ['id', 'coreStart', 'coreEnd', 'contextStart', 'contextEnd'].every(key => integer(item[key]))
    && ['pending', 'running', 'complete', 'failed'].includes(String(item.status))
    && (item.error === undefined || typeof item.error === 'string');
  const validSession = (item: unknown) => object(item) && typeof item.id === 'string' && item.id.length > 0
    && typeof item.sourcePath === 'string' && typeof item.targetPath === 'string' && typeof item.revision === 'string'
    && readRequirements(item.requirements) !== null && integer(item.selectedIndex)
    && (item.outputPath === null || typeof item.outputPath === 'string')
    && typeof item.savedFingerprint === 'string' && typeof item.lastOpened === 'number' && Number.isFinite(item.lastOpened)
    && (item.hiddenFromRecents === undefined || typeof item.hiddenFromRecents === 'boolean')
    && (item.round === undefined || (object(item.round) && typeof item.round.id === 'string'
      && readRequirements(item.round.requirements) !== null && typeof item.round.baseUrl === 'string' && typeof item.round.model === 'string'
      && (item.round.connectionFingerprint === undefined || typeof item.round.connectionFingerprint === 'string')))
    && object(item.reviews) && Object.entries(item.reviews).every(([key, review]) => validReview(review) && object(review) && String(review.index) === key)
    && Array.isArray(item.batches) && item.batches.every(validBatch);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.sessions) || !value.sessions.every(validSession)
    || !Array.isArray(value.openIds) || !value.openIds.every(id => typeof id === 'string')
    || !(value.activeId === null || typeof value.activeId === 'string')) {
    throw new Error('工作记录格式无效，原记录已保留。');
  }
  const workspace = value as unknown as WorkspaceState;
  const ids = new Set(workspace.sessions.map(session => session.id));
  if (ids.size !== workspace.sessions.length || workspace.openIds.some(id => !ids.has(id))
    || new Set(workspace.openIds).size !== workspace.openIds.length
    || (workspace.activeId !== null && !workspace.openIds.includes(workspace.activeId))) {
    throw new Error('工作记录中的文件引用无效，原记录已保留。');
  }
  return {
    ...workspace,
    sessions: workspace.sessions.map(session => ({ ...session, requirements: readRequirements(session.requirements)! })),
  };
}

export interface SessionProgress {
  reviews: Record<number, ReviewItem>;
  batches: BatchState[];
  requirements: Requirements;
  selectedIndex: number;
  outputPath: string | null;
  savedFingerprint: string;
  hiddenFromRecents?: boolean;
  round?: CheckRound;
}

const resumableBatches = (batches: BatchState[]): BatchState[] => batches.map(batch => (
  batch.status === 'running' ? { ...batch, status: 'pending', error: undefined } : batch
));

export function captureSession(document: DocumentSession, id: string, progress: SessionProgress, lastOpened: number): StoredSession {
  return {
    id,
    sourcePath: document.sourcePath,
    targetPath: document.targetPath,
    revision: document.revision,
    reviews: progress.reviews,
    batches: resumableBatches(progress.batches),
    requirements: progress.requirements,
    selectedIndex: progress.selectedIndex,
    outputPath: progress.outputPath,
    savedFingerprint: progress.savedFingerprint,
    lastOpened,
    ...(progress.hiddenFromRecents === undefined ? {} : { hiddenFromRecents: progress.hiddenFromRecents }),
    ...(progress.round ? { round: progress.round } : {}),
  };
}

export function restoreSession(document: DocumentSession, previous: StoredSession | undefined, requirements: Requirements): { session: StoredSession; changed: boolean } {
  const changed = Boolean(previous && previous.revision !== document.revision);
  const canRestore = previous && !changed;
  return {
    changed,
    session: captureSession(document, previous?.id ?? crypto.randomUUID(), {
      reviews: canRestore ? previous.reviews : {},
      batches: canRestore ? previous.batches : [],
      requirements: previous?.requirements ?? requirements,
      selectedIndex: Math.max(0, Math.min(previous?.selectedIndex ?? 0, document.entries.length - 1)),
      outputPath: canRestore ? previous.outputPath : null,
      savedFingerprint: canRestore ? previous.savedFingerprint : '[]',
      hiddenFromRecents: previous?.hiddenFromRecents,
      round: canRestore ? previous.round : undefined,
    }, Date.now()),
  };
}

export function updateSession(workspace: WorkspaceState, session: StoredSession): WorkspaceState {
  return {
    ...workspace,
    sessions: workspace.sessions.some(value => value.id === session.id)
      ? workspace.sessions.map(value => value.id === session.id ? session : value)
      : [...workspace.sessions, session],
  };
}

export function activateSession(workspace: WorkspaceState, session: StoredSession): WorkspaceState {
  return {
    ...updateSession(workspace, session.hiddenFromRecents ? { ...session, hiddenFromRecents: false } : session),
    activeId: session.id,
    openIds: workspace.openIds.includes(session.id) ? workspace.openIds : [...workspace.openIds, session.id],
  };
}

export function closeSessionTab(workspace: WorkspaceState, id: string): WorkspaceState {
  const index = workspace.openIds.indexOf(id);
  const openIds = workspace.openIds.filter(value => value !== id);
  return {
    ...workspace,
    openIds,
    activeId: workspace.activeId === id ? openIds[Math.min(index, openIds.length - 1)] ?? null : workspace.activeId,
  };
}

export function forgetSession(workspace: WorkspaceState, id: string): WorkspaceState {
  // Open tabs own live progress. Removing a recent item must not destroy it.
  if (workspace.openIds.includes(id)) return workspace;
  return { ...workspace, sessions: workspace.sessions.filter(value => value.id !== id) };
}

/** Hiding a recent entry never removes its recoverable review session. */
export function hideRecentSession(workspace: WorkspaceState, id: string): WorkspaceState {
  if (workspace.openIds.includes(id)) return workspace;
  return { ...workspace, sessions: workspace.sessions.map(session => session.id === id ? { ...session, hiddenFromRecents: true } : session) };
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

export function findSession(workspace: WorkspaceState, document: Pick<DocumentSession, 'sourcePath' | 'targetPath'>): StoredSession | undefined {
  return workspace.sessions.find(session => comparablePath(session.sourcePath) === comparablePath(document.sourcePath)
    && comparablePath(session.targetPath) === comparablePath(document.targetPath));
}

/** Keep writes in invocation order, including after a failed write. */
export function serializedWriter<T>(write: (value: T) => Promise<void>): (value: T) => Promise<void> {
  let pending = Promise.resolve();
  return value => {
    const next = pending.then(() => write(value));
    pending = next.catch(() => { /* A failed autosave must not block the next attempt. */ });
    return next;
  };
}
