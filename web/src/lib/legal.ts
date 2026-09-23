import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

/** Legal drafts live in docs/legal/ (written for counsel). Rendered at build time into static pages. */
export const LEGAL_DOCS = {
  terms: { file: 'terms-of-service.md', title: 'Terms of Service', route: '/legal/terms' },
  risks: { file: 'risk-disclosures.md', title: 'Risk disclosures', route: '/legal/risks' },
  'past-performance': { file: 'past-performance-notice.md', title: 'Past-performance notice', route: '/legal/past-performance' },
  'creator-terms': { file: 'creator-terms.md', title: 'Creator terms', route: '/legal/creator-terms' },
} as const;

export type LegalKey = keyof typeof LEGAL_DOCS;

const ROUTE_BY_FILE: Record<string, string> = Object.fromEntries(
  Object.values(LEGAL_DOCS).map((d) => [d.file, d.route]),
);

function findDocsDir(): string | null {
  const candidates = [
    process.env.BUCKET_LEGAL_DIR,
    path.join(process.cwd(), '..', 'docs', 'legal'),
    path.join(process.cwd(), 'docs', 'legal'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

/**
 * Drop notes to counsel that are not meant to ship: blockquotes starting "Note", and whole
 * "## Notes for counsel" sections.
 */
function stripCounselNotes(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^>\s*Note\b/.test(lines[i])) {
      while (i + 1 < lines.length && lines[i + 1].startsWith('>')) i++;
      continue;
    }
    if (/^##\s+Notes? (for|to) counsel/i.test(lines[i])) {
      while (i + 1 < lines.length && !/^##\s/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

export interface LegalDoc {
  title: string;
  html: string;
  source: string;
}

export function loadLegalDoc(key: LegalKey): LegalDoc | null {
  const meta = LEGAL_DOCS[key];
  const dir = findDocsDir();
  if (!dir) return null;
  const file = path.join(dir, meta.file);
  if (!fs.existsSync(file)) return null;
  let md = fs.readFileSync(file, 'utf8');
  md = stripCounselNotes(md);
  md = md.replace(/^# .*\n/m, ''); // the page header already shows the title
  let html = marked.parse(md, { gfm: true, async: false }) as string;
  // Links between drafts: map to routes we publish; unwrap the ones we do not.
  html = html.replace(/<a href="([\w-]+\.md)(#[^"]*)?">([\s\S]*?)<\/a>/g, (_m, f: string, hash: string | undefined, text: string) =>
    ROUTE_BY_FILE[f] ? `<a href="${ROUTE_BY_FILE[f]}${hash ?? ''}">${text}</a>` : text,
  );
  html = html.replace(/<code>([\w-]+\.md)<\/code>/g, (_m, f: string) =>
    ROUTE_BY_FILE[f] ? `<a href="${ROUTE_BY_FILE[f]}">${LEGAL_DOCS[keyFor(f)].title}</a>` : `<code>${f}</code>`,
  );
  // Open placeholders stay visible, highlighted.
  html = html.replace(/\[\[COUNSEL:[^\]]*\]\]/g, (m) => `<mark>${m}</mark>`);
  return { title: meta.title, html, source: `docs/legal/${meta.file}` };
}

function keyFor(file: string): LegalKey {
  return (Object.keys(LEGAL_DOCS) as LegalKey[]).find((k) => LEGAL_DOCS[k].file === file)!;
}
