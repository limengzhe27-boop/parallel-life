import { notFound } from 'next/navigation';
import { SceneStagePreview } from '../../../features/phone/scenes/stage-preview.tsx';
export const dynamic = 'force-dynamic';
export default function Preview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <SceneStagePreview />;
}
