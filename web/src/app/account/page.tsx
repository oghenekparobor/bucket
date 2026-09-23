import type { Metadata } from 'next';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import { AccountView } from '@/components/views/AccountView';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <>
      <PageHeader kicker="YOU" title="Account" />
      <PageContent>
        <AccountView />
      </PageContent>
    </>
  );
}
