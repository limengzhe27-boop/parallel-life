import { PublisherTrial } from '../../../../features/publisher/publisher-trial.tsx';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PublisherTrial trialId={(await params).id} />;
}
