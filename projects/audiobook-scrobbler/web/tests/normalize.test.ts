import { describe, it, expect } from 'vitest';
import { normalizeTitle, normalizeAuthor, sourceKey, extractIdentity, similarity } from '@/lib/normalize';
import { DEFAULT_SETTINGS, fieldMapFor, APP_AUDIBLE } from '@/lib/settings';

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
  it('extracts identity via the field map, dropping chapter == title', () => {
    const map = fieldMapFor(DEFAULT_SETTINGS, APP_AUDIBLE);
    const raw = {
      'android.media.metadata.ALBUM': 'Dune',
      'android.media.metadata.ARTIST': 'Frank Herbert',
      'android.media.metadata.DISPLAY_TITLE': 'Chapter 3',
    };
    expect(extractIdentity(raw, map)).toEqual({ title: 'Dune', author: 'Frank Herbert', chapter: 'Chapter 3' });
    expect(extractIdentity({ 'android.media.metadata.TITLE': 'Dune' }, map)).toEqual({ title: 'Dune', author: null, chapter: null });
  });
  it('similarity is symmetric and bounded', () => {
    expect(similarity('the name of the wind', 'name of the wind')).toBeGreaterThan(0.8);
    expect(similarity('dune', 'emma')).toBe(0);
    expect(similarity('a b', 'a b')).toBe(1);
  });
});
