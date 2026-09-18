export interface OpenLibraryHit {
  title: string;
  author: string | null;
  isbn13: string | null;
  cover_url: string | null;
}

export async function searchOpenLibrary(title: string, author: string | null): Promise<OpenLibraryHit[]> {
  const params = new URLSearchParams({ title, limit: '10', fields: 'title,author_name,isbn,cover_i' });
  if (author) params.set('author', author);
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'user-agent': 'audiobook-scrobbler/0.1' } });
  if (!res.ok) return [];
  const json = (await res.json()) as { docs?: { title: string; author_name?: string[]; isbn?: string[]; cover_i?: number }[] };
  return (json.docs ?? []).map((d) => ({
    title: d.title,
    author: d.author_name?.[0] ?? null,
    isbn13: d.isbn?.find((i) => i.length === 13) ?? null,
    cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
  }));
}
