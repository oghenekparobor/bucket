import Link from 'next/link';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import ui from '@/components/ui/ui.module.css';

export default function NotFound() {
  return (
    <>
      <PageHeader kicker="NOT FOUND" title="Nothing here" />
      <PageContent>
        <div className={`${ui.card} ${ui.cardPad}`} style={{ maxWidth: 560 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            That page or bucket does not exist. Bucket share links are permanent, so check the spelling.
          </p>
          <Link href="/" className={ui.btnAccent} style={{ marginTop: 14 }}>
            Browse the leaderboard
          </Link>
        </div>
      </PageContent>
    </>
  );
}
