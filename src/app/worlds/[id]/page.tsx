import { WorldPhoneApp } from '../../../features/phone/world-phone-app.tsx';
import { Id } from '../../../contracts/api.ts';
import { notFound } from 'next/navigation';
export default async function WorldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Id.safeParse(id).success) notFound();
  return <WorldPhoneApp worldId={id} />;
}
