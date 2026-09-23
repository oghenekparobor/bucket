import type { Metadata } from 'next';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import { DashboardView } from '@/components/views/DashboardView';

export const metadata: Metadata = { title: 'Creator dashboard' };

export default function DashboardPage() {
  return (
    <>
      <PageHeader kicker="YOU" title="Creator dashboard" />
      <PageContent>
        <DashboardView />
      </PageContent>
    </>
  );
}
