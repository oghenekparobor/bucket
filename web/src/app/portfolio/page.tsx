import type { Metadata } from 'next';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import { PortfolioView } from '@/components/views/PortfolioView';

export const metadata: Metadata = { title: 'Portfolio' };

export default function PortfolioPage() {
  return (
    <>
      <PageHeader kicker="YOU" title="Portfolio" />
      <PageContent>
        <PortfolioView />
      </PageContent>
    </>
  );
}
