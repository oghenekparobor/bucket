/** Lowercase ASCII slug from a bucket name ("Picks & Shovels" → "picks-and-shovels"). */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base || 'bucket';
}

/** First free slug among `base`, `base-2`, `base-3`, … given a predicate for taken slugs. */
export async function uniqueSlug(name: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(name);
  if (!(await isTaken(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
