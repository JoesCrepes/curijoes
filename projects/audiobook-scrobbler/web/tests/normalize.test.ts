import { describe, it, expect } from 'vitest';
import { normalizeTitle, normalizeAuthor, sourceKey, extractIdentity, similarity } from '@/lib/normalize';
import { DEFAULT_SETTINGS, fieldMapFor, APP_AUDIBLE, APP_LIBBY, APP_LIBRO } from '@/lib/settings';
import audible from './fixtures/audible-yesteryear.json';
import libby from './fixtures/libby-the-body.json';
import librofm from './fixtures/librofm-guards-guards.json';

describe('normalize', () => {
  it('strips audiobook noise from titles', () => {
    expect(normalizeTitle('The Name of the Wind (Unabridged)')).toBe('the name of the wind');
    expect(normalizeTitle('Project Hail Mary: A Novel')).toBe('project hail mary');
    expect(normalizeTitle('The Way of Kings - The Stormlight Archive, Book 1')).toBe('the way of kings');
    expect(normalizeTitle("Children of Time")).toBe('children of time');
  });
  it('keeps the first author and drops narration credits', () => {
    expect(normalizeAuthor('Patrick Rothfuss, narrated by Nick Podehl')).toBe('patrick rothfuss');
    expect(normalizeAuthor('Terry Pratchett & Neil Gaiman')).toBe('terry pratchett');
    expect(normalizeAuthor(null)).toBe('');
  });
  it('source key is app-independent', () => {
    expect(sourceKey('a', 'Dune', 'Frank Herbert')).toBe(sourceKey('b', 'Dune (Unabridged)', 'Frank Herbert'));
  });
  it('extracts identity via the generic field map, dropping chapter == title', () => {
    const map = fieldMapFor(DEFAULT_SETTINGS, 'com.example.player');
    const raw = {
      'android.media.metadata.ALBUM': 'Dune',
      'android.media.metadata.ARTIST': 'Frank Herbert',
      'android.media.metadata.DISPLAY_TITLE': 'Chapter 3',
    };
    expect(extractIdentity(raw, map)).toEqual({ title: 'Dune', author: 'Frank Herbert', chapter: 'Chapter 3' });
    expect(extractIdentity({ 'android.media.metadata.TITLE': 'Dune' }, map)).toEqual({ title: 'Dune', author: null, chapter: null });
  });
  it('reads a real Audible metadata bag correctly', () => {
    const map = fieldMapFor(DEFAULT_SETTINGS, APP_AUDIBLE);
    const { title, author, chapter } = extractIdentity(audible.metadata_event.raw, map);
    expect(title).toBe('Yesteryear: A GMA Book Club Pick');
    expect(author).toBe('Caro Claire Burke');
    expect(chapter).toBe('Part Two: The Present: Chapter 1');
    expect(normalizeTitle(title!)).toBe('yesteryear a gma book club pick');
    expect(audible.metadata_event.chapter_idx).toBe(2);
    expect(audible.metadata_event.chapter_count).toBe(62);
    expect(audible.queue_titles[2]).toBe(chapter);
    expect(audible.queue_media_id).toBe(audible.metadata_event.raw['android.media.metadata.MEDIA_ID']);
  });
  it('reads a real Libby metadata bag correctly', () => {
    const map = fieldMapFor(DEFAULT_SETTINGS, APP_LIBBY);
    expect(extractIdentity(libby.event.raw, map)).toEqual({ title: 'The Body', author: 'Bill Bryson', chapter: 'Chapter 3: Microbial You' });
    expect(libby.event.chapter_idx).toBeNull();
    expect(libby.event.duration_ms).toBeGreaterThan(10 * 3600 * 1000); // whole book
  });
  it('reads a real Libro.fm metadata bag correctly (no chapter names)', () => {
    const map = fieldMapFor(DEFAULT_SETTINGS, APP_LIBRO);
    expect(extractIdentity(librofm.event.raw, map)).toEqual({ title: 'Guards! Guards!', author: 'Terry Pratchett', chapter: null });
    expect(librofm.event.chapter_idx).toBe(66);
    expect(librofm.event.chapter_count).toBe(121);
    expect(librofm.queue_sample.every((q: { title: string | null }) => q.title === 'Guards! Guards!')).toBe(true);
  });
  it('similarity is symmetric and bounded', () => {
    expect(similarity('the name of the wind', 'name of the wind')).toBeGreaterThan(0.8);
    expect(similarity('dune', 'emma')).toBe(0);
    expect(similarity('a b', 'a b')).toBe(1);
  });
});
