import type { Metadata } from 'next';
import { CreateView } from '@/components/create/CreateView';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';

type Props = { searchParams: Promise<{ edit?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { edit } = await searchParams;
  return { title: edit ? 'Propose an edit' : 'New bucket' };
}

export default async function CreatePage({ searchParams }: Props) {
  const { edit } = await searchParams;
  const editSlug = typeof edit === 'string' && edit ? edit : null;
  return (
    <>
      <PageHeader kicker={editSlug ? 'EDIT' : 'CREATE'} title={editSlug ? 'Propose an edit' : 'New bucket'} />
      <PageContent>
        <CreateView key={editSlug ?? 'new'} editSlug={editSlug} />
      </PageContent>
    </>
  );
}
