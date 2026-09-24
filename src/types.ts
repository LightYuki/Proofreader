export interface LinePair {
  index: number;
  source: string;
  translation: string;
  sourceName?: string;
  targetName?: string;
}

export interface DocumentSession {
  id: string;
  revision: string;
  sourcePath: string;
  targetPath: string;
  entries: LinePair[];
}

export interface Requirements {
  style: string;
  background: string;
}

export interface ModelSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  credentialError?: string;
}

export interface ModelSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface BatchWindow {
  id: number;
  coreStart: number;
  coreEnd: number;
  contextStart: number;
  contextEnd: number;
}

export interface BatchRequest extends Omit<BatchWindow, 'id'> {
  requestId: string;
  documentId: string;
  requirements: Requirements;
}

export interface Suggestion {
  index: number;
  proposed: string;
  reason: string;
  evidence?: string;
}

export interface ReviewItem extends Suggestion {
  draft: string;
  acceptedText?: string;
  status: 'pending' | 'accepted' | 'ignored';
  manualEdited?: boolean;
  roundId?: string;
}

export interface CheckRound {
  id: string;
  requirements: Requirements;
  baseUrl: string;
  model: string;
  connectionFingerprint?: string;
}

export interface AcceptedChange {
  index: number;
  message: string;
}

export interface BatchState extends BatchWindow {
  status: 'pending' | 'running' | 'complete' | 'failed';
  error?: string;
}

export interface StoredSession {
  id: string;
  sourcePath: string;
  targetPath: string;
  revision: string;
  reviews: Record<number, ReviewItem>;
  batches: BatchState[];
  requirements: Requirements;
  selectedIndex: number;
  outputPath: string | null;
  savedFingerprint: string;
  lastOpened: number;
  hiddenFromRecents?: boolean;
  round?: CheckRound;
}

export interface WorkspaceState {
  version: 1;
  activeId: string | null;
  openIds: string[];
  sessions: StoredSession[];
}
