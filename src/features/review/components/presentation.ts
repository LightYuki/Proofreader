import type { BatchState, ReviewItem } from '../../../types';
import { hasUnconfirmedDraft } from '../../../core/review';

export const reviewStatusLabels: Record<ReviewItem['status'], string> = {
  pending: '待审',
  accepted: '已采用',
  ignored: '已保留',
};

export const batchStatusLabels: Record<BatchState['status'], string> = {
  pending: '',
  running: '检查中',
  complete: '无建议',
  failed: '检查失败',
};

export function reviewIndicator(review?: ReviewItem, batchStatus?: BatchState['status']) {
  if (review?.status === 'accepted') {
    return hasUnconfirmedDraft(review)
      ? { tone: 'pending', label: '草稿待确认', description: '保存沿用上次采用的译文。点击“更新修改”确认新草稿。' }
      : { tone: 'accepted', label: '已采用', description: '保存时写入这条修改。' };
  }
  if (review?.status === 'ignored') return { tone: 'neutral', label: '保留原译', description: '保存时使用原译文。' };
  if (review) return { tone: 'pending', label: '待审', description: '尚未采用，保存时仍使用原译文。' };
  if (batchStatus === 'running') return { tone: 'running', label: '检查中', description: '正在检查当前片段。' };
  if (batchStatus === 'failed') return { tone: 'failed', label: '检查失败', description: '可在工具栏重试失败批次。' };
  if (batchStatus === 'complete') return { tone: 'neutral', label: '无建议', description: '本轮检查未提出修改。' };
  return { tone: 'unchecked', label: '尚未检查', description: '可手动修改或开始检查。' };
}

export function filename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function lineNumber(index: number) {
  return String(index + 1).padStart(3, '0');
}
