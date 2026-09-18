import type { Progress } from './types';

export interface FinishInput {
  progress: Progress;
  chapter_idx: number | null;
  chapter_count: number | null;
  finish_threshold: number;
}

/**
 * Auto-finish when the book is essentially over. The cumulative basis is
 * inflated by re-listens, so on its own it only counts while on the final
 * chapter.
 */
export function shouldAutoFinish(i: FinishInput): boolean {
  const { progress } = i;
  if (progress.basis === 'app') return true;
  if (progress.pct == null) return false;
  if (progress.pct < i.finish_threshold) return false;
  if (progress.basis === 'chapters') return true;
  const onLastChapter = i.chapter_idx != null && i.chapter_count != null && i.chapter_idx >= i.chapter_count - 1;
  return progress.basis === 'cumulative' && onLastChapter;
}

export interface StallInput {
  pct: number | null;
  last_activity_at: string;
  now: string;
  stall_threshold: number;
  stall_hours: number;
}

/** A book parked near the end with no recent listening: ask instead of guess. */
export function isStalled(i: StallInput): boolean {
  if (i.pct == null || i.pct < i.stall_threshold) return false;
  const idle = new Date(i.now).getTime() - new Date(i.last_activity_at).getTime();
  return idle >= i.stall_hours * 3600 * 1000;
}
