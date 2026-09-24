import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUIREMENTS } from '../../config/review';
import type { DocumentSession, ReviewItem, StoredSession } from '../../types';
import { activateSession, captureSession, closeSessionTab, emptyWorkspace, findSession, forgetSession, readWorkspace, restoreSession, serializedWriter, updateSession } from './state';

const document: DocumentSession = {
  id: 'backend-session', sourcePath: 'C:\\Novel\\source.json', targetPath: 'C:\\Novel\\target.json', revision: 'revision-a',
  entries: Array.from({ length: 60 }, (_, index) => ({ index, source: `源文 ${index}`, translation: `Text ${index}` })),
};
const accepted: ReviewItem = { index: 2, proposed: 'Suggested', draft: 'Unconfirmed next draft', acceptedText: 'Confirmed', reason: 'Reason', status: 'accepted' };
const stored = (id = 'a'): StoredSession => ({
  id, sourcePath: document.sourcePath, targetPath: document.targetPath, revision: document.revision,
  reviews: { 2: accepted },
  batches: [
    { id: 0, coreStart: 0, coreEnd: 30, contextStart: 0, contextEnd: 45, status: 'complete' },
    { id: 1, coreStart: 30, coreEnd: 60, contextStart: 15, contextEnd: 60, status: 'running' },
  ],
  requirements: { ...DEFAULT_REQUIREMENTS, background: 'Private project notes' },
  selectedIndex: 40, outputPath: 'C:\\Novel\\revised.json', savedFingerprint: '[]', lastOpened: 1,
});

describe('workspace progress recovery', () => {
  it('restores accepted text separately from a newer draft and resumes interrupted batches', () => {
    const previous = stored();
    const { session, changed } = restoreSession(document, previous, DEFAULT_REQUIREMENTS);
    expect(changed).toBe(false);
    expect(session.reviews[2]).toEqual(accepted);
    expect(session.batches.map(batch => batch.status)).toEqual(['complete', 'pending']);
    expect(session.selectedIndex).toBe(40);
    expect(session.outputPath).toBe(previous.outputPath);
    expect(session.requirements.background).toBe('Private project notes');
    expect(previous.batches[1].status).toBe('running');
  });

  it('discards stale edits when either original file has changed, retaining file requirements', () => {
    const { session, changed } = restoreSession({ ...document, revision: 'revision-b', entries: document.entries.slice(0, 3) }, stored(), DEFAULT_REQUIREMENTS);
    expect(changed).toBe(true);
    expect(session.reviews).toEqual({});
    expect(session.batches).toEqual([]);
    expect(session.outputPath).toBe(null);
    expect(session.savedFingerprint).toBe('[]');
    expect(session.selectedIndex).toBe(2);
    expect(session.requirements.background).toBe('Private project notes');
  });

  it('starts a new empty document with the current defaults', () => {
    const { session } = restoreSession({ ...document, entries: [] }, undefined, DEFAULT_REQUIREMENTS);
    expect(session.selectedIndex).toBe(0);
    expect(session.requirements).toEqual(DEFAULT_REQUIREMENTS);
    expect(session.reviews).toEqual({});
  });

  it('snapshots only review progress and paths, excluding full document text and backend IDs', () => {
    const session = captureSession(document, 'persistent-id', stored(), 123);
    expect(session.id).toBe('persistent-id');
    expect(session).not.toHaveProperty('entries');
    expect(session.batches[1].status).toBe('pending');
    expect(session.lastOpened).toBe(123);
  });
});

describe('tabs and recent file pairs', () => {
  it('preserves outgoing progress and tab order when activating another file pair', () => {
    const first = stored('a');
    const second = { ...stored('b'), targetPath: 'C:\\Novel\\jp.json' };
    let workspace = activateSession(activateSession(emptyWorkspace(), first), second);
    workspace = updateSession(workspace, { ...second, selectedIndex: 5 });
    workspace = activateSession(workspace, first);
    expect(workspace.openIds).toEqual(['a', 'b']);
    expect(workspace.activeId).toBe('a');
    expect(workspace.sessions.find(value => value.id === 'b')?.selectedIndex).toBe(5);
  });

  it('closing a tab chooses its neighbor and retains the closed review in recent files', () => {
    let workspace = activateSession(activateSession(emptyWorkspace(), stored('a')), stored('b'));
    workspace = closeSessionTab(workspace, 'b');
    expect(workspace.openIds).toEqual(['a']);
    expect(workspace.activeId).toBe('a');
    expect(workspace.sessions.find(value => value.id === 'b')?.reviews[2]).toEqual(accepted);
    workspace = closeSessionTab(workspace, 'a');
    expect(workspace.openIds).toEqual([]);
    expect(workspace.activeId).toBe(null);
    expect(workspace.sessions).toHaveLength(2);
  });

  it('recent removal cannot erase an open tab', () => {
    const workspace = activateSession(emptyWorkspace(), stored());
    expect(forgetSession(workspace, 'a')).toEqual(workspace);
    expect(forgetSession(closeSessionTab(workspace, 'a'), 'a').sessions).toEqual([]);
  });

  it('recognizes a reopened Windows file pair, but keeps different target languages separate', () => {
    const workspace = activateSession(emptyWorkspace(), stored());
    expect(findSession(workspace, { sourcePath: 'c:/novel/SOURCE.json', targetPath: 'C:/Novel/target.json' })?.id).toBe('a');
    expect(findSession(workspace, { sourcePath: document.sourcePath, targetPath: 'C:\\Novel\\jp.json' })).toBeUndefined();
  });
});

describe('safe local workspace persistence', () => {
  it.each(['EN', 'JP'])('loads old %s records without changing review progress', (targetLanguage) => {
    const previous = stored();
    const workspace = activateSession(emptyWorkspace(), {
      ...previous, requirements: { ...previous.requirements, targetLanguage } as StoredSession['requirements'],
    });
    const restored = readWorkspace(JSON.parse(JSON.stringify(workspace)));
    expect(restored.sessions[0]).toEqual(previous);
    expect(restored.sessions[0].requirements).not.toHaveProperty('targetLanguage');
    expect(restored.activeId).toBe(workspace.activeId);
    expect(restored.openIds).toEqual(workspace.openIds);
    expect(workspace.sessions[0].requirements).toHaveProperty('targetLanguage', targetLanguage);
  });

  it('accepts its persisted schema and rejects malformed records without dropping them silently', () => {
    const workspace = activateSession(emptyWorkspace(), stored());
    expect(readWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
    expect(() => readWorkspace({ ...workspace, sessions: [{}] })).toThrow('格式无效');
    expect(() => readWorkspace({ ...workspace, openIds: ['missing'] })).toThrow('文件引用无效');
    expect(() => readWorkspace({ ...workspace, version: 2 })).toThrow('格式无效');
  });

  it('writes in order even when a previous write is slow', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writes: number[] = [];
    const write = serializedWriter(async (value: number) => {
      if (value === 1) await gate;
      writes.push(value);
    });
    const first = write(1);
    const second = write(2);
    await Promise.resolve();
    expect(writes).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(writes).toEqual([1, 2]);
  });

  it('reports a failed save and allows a later retry to persist', async () => {
    const writes: number[] = [];
    const write = serializedWriter(async (value: number) => {
      if (value === 1) throw new Error('Disk full');
      writes.push(value);
    });
    await expect(write(1)).rejects.toThrow('Disk full');
    await write(2);
    expect(writes).toEqual([2]);
  });
});
