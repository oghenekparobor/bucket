import Link from 'next/link';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import ui from '@/components/ui/ui.module.css';
import v from '@/components/views/views.module.css';
import { LEGAL_DOCS, loadLegalDoc, type LegalKey } from '@/lib/legal';

/** Renders a draft from docs/legal/ with a DRAFT banner that is always visible. */
export function LegalPage({ doc }: { doc: LegalKey }) {
  const loaded = loadLegalDoc(doc);
  const title = LEGAL_DOCS[doc].title;
  return (
    <>
      <PageHeader kicker="LEGAL · DRAFT" title={title} />
      <PageContent>
        <article className={`${ui.card} ${ui.cardPad}`} style={{ maxWidth: 860 }}>
          <div className={v.draftBanner} role="note">
            <span className={v.draft}>DRAFT · NOT REVIEWED BY COUNSEL</span>
            <span>
              Working draft for counsel. It is not final, not legal advice, and may change before launch. Highlighted
              placeholders are still open.
            </span>
          </div>
          {loaded ? (
            <div className={v.prose} dangerouslySetInnerHTML={{ __html: loaded.html }} />
          ) : (
            <p className={ui.small} style={{ marginTop: 16 }}>
              This draft is not bundled with this build.
            </p>
          )}
          <nav aria-label="Legal documents" className={v.legalNav}>
            {(Object.keys(LEGAL_DOCS) as LegalKey[]).map((k) => (
              <Link key={k} href={LEGAL_DOCS[k].route} aria-current={k === doc ? 'page' : undefined}>
                {LEGAL_DOCS[k].title}
              </Link>
            ))}
          </nav>
        </article>
      </PageContent>
    </>
  );
}
