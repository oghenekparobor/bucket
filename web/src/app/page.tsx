import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import { LeaderboardView } from '@/components/views/LeaderboardView';
import { getApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const api = await getApi();
  const [stats, board] = await Promise.all([
    api.stats().catch(() => null),
    api.leaderboard('30d').catch(() => null),
  ]);
  return (
    <>
      <PageHeader kicker="DISCOVER" title="Leaderboard" />
      <PageContent>
        <LeaderboardView initialStats={stats} initialBoard={board} />
      </PageContent>
    </>
  );
}
