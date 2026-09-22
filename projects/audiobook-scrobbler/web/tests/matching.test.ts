import { describe, it, expect } from 'vitest';
import { score, decide, runtimeAgreement, hasAuthorEvidence } from '@/lib/matching';
import { extractIdentifier } from '@/lib/normalize';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { MatchCandidate } from '@/lib/types';
import audible from './fixtures/audible-yesteryear.json';
import libby from './fixtures/libby-the-body.json';
import librofm from './fixtures/librofm-guards-guards.json';

const cand = (o: Partial<MatchCandidate>): MatchCandidate => ({
  source: 'hardcover', book_id: 1, edition_id: null, title: '', author: null,
  isbn13: null, runtime_seconds: null, cover_url: null, score: 0, ...o,
});

describe('identifier extraction', () => {
  it('reads Audible ASIN from MEDIA_ID', () => {
    expect(extractIdentifier('com.audible.application', audible.metadata_event.raw)).toEqual({ kind: 'asin', value: 'B0FKV9JSWV' });
  });
  it('reads the Libro.fm ISBN out of the cover URL', () => {
    expect(extractIdentifier('fm.libro.librofm', librofm.event.raw)).toEqual({ kind: 'isbn13', value: '9781473588165' });
  });
  it('reads the OverDrive titleId for Libby, which has no MEDIA_ID', () => {
    expect(extractIdentifier('com.overdrive.mobile.android.libby', libby.event.raw)).toEqual({ kind: 'overdrive', value: '4528180' });
  });
  it('returns null when nothing usable is present', () => {
    expect(extractIdentifier('com.example.player', { 'android.media.metadata.TITLE': 'x' })).toBeNull();
    expect(extractIdentifier('com.example.player', undefined)).toBeNull();
  });
  it('ignores a MEDIA_ID that is not an ASIN', () => {
    expect(extractIdentifier('com.spotify.music', { 'android.media.metadata.MEDIA_ID': 'spotify:track:4o0hXNlSlFPOr2RemeIgWI' })).toBeNull();
  });
});

describe('runtime agreement', () => {
  it('treats Libby 50679 s and Hardcover 53280 s as the same book', () => {
    expect(runtimeAgreement(50_679, 53_280)).toBeGreaterThan(0.6);
  });
  it('is exact within 10%', () => {
    expect(runtimeAgreement(50_000, 52_000)).toBe(1);
  });
  it('rejects a wildly different runtime', () => {
    expect(runtimeAgreement(50_000, 9_000)).toBe(0);
  });
  it('is unknown when either side is missing', () => {
    expect(runtimeAgreement(null, 100)).toBeNull();
    expect(runtimeAgreement(100, null)).toBeNull();
  });
});

describe('scoring', () => {
  // The regression that shipped wrong data: with no author on our side, an
  // exact title match used to score 0.9 and auto-accept.
  it('does not let a title-only match reach the auto threshold', () => {
    const s = score({ candTitle: 'The Body', candAuthor: 'Stephen King', title: 'The Body', author: null });
    expect(s).toBeLessThan(DEFAULT_SETTINGS.auto_match_min_score);
  });
  it('ranks the right book above the coincidence once the author is known', () => {
    const king = score({ candTitle: 'The Body', candAuthor: 'Stephen King', title: 'The Body', author: 'Bill Bryson', observedRuntime: 50_679, candRuntime: null });
    const bryson = score({ candTitle: 'The Body: A Guide for Occupants', candAuthor: 'Bill Bryson', title: 'The Body', author: 'Bill Bryson', observedRuntime: 50_679, candRuntime: 53_280 });
    expect(bryson).toBeGreaterThan(king);
  });
  it('rewards a full agreement', () => {
    const s = score({ candTitle: 'Guards! Guards!', candAuthor: 'Terry Pratchett', title: 'Guards! Guards!', author: 'Terry Pratchett', observedRuntime: 48_000, candRuntime: 48_293 });
    expect(s).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.auto_match_min_score);
  });
  it('treats a missing author as absence of evidence', () => {
    expect(hasAuthorEvidence(null, 'Bill Bryson')).toBe(false);
    expect(hasAuthorEvidence('Stephen King', 'Bill Bryson')).toBe(false);
    expect(hasAuthorEvidence('Bill Bryson', 'bill bryson')).toBe(true);
  });
});

describe('decide', () => {
  it('refuses to auto-accept without author corroboration', () => {
    const cands = [cand({ title: 'The Body', author: 'Stephen King', score: 0.95 }), cand({ title: 'Other', score: 0.2 })];
    expect(decide(cands, DEFAULT_SETTINGS, { author: null }).status).toBe('needs_review');
    expect(decide(cands, DEFAULT_SETTINGS, { author: 'Bill Bryson' }).status).toBe('needs_review');
  });
  it('auto-accepts an exact identifier hit even with no author', () => {
    const r = decide([cand({ title: 'Guards! Guards!', score: 1 })], DEFAULT_SETTINGS, { author: null });
    expect(r.status).toBe('auto');
    expect(r.best?.score).toBe(1);
  });
  it('auto-accepts a corroborated, well-separated match', () => {
    const cands = [cand({ title: 'Guards! Guards!', author: 'Terry Pratchett', score: 0.93 }), cand({ title: 'The Guards', author: 'Ken Bruen', score: 0.4 })];
    expect(decide(cands, DEFAULT_SETTINGS, { author: 'Terry Pratchett' }).status).toBe('auto');
  });
  it('sends a close call to review', () => {
    const cands = [cand({ author: 'A', score: 0.9 }), cand({ author: 'A', score: 0.88 })];
    expect(decide(cands, DEFAULT_SETTINGS, { author: 'A' }).status).toBe('needs_review');
  });
  it('reports no match on an empty list', () => {
    expect(decide([], DEFAULT_SETTINGS).status).toBe('no_match');
  });
});
