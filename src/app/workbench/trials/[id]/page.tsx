import { PublisherTrial } from '../../../../features/publisher/publisher-trial.tsx';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const actorKey =
    query.view === 'wechat' &&
    typeof query.actor === 'string' &&
    /^[a-z][a-z0-9_]{0,31}$/.test(query.actor)
      ? query.actor
      : undefined;
  return <PublisherTrial trialId={(await params).id} wechatActorKey={actorKey} />;
}
