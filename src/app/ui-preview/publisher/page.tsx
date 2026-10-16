import { notFound } from 'next/navigation';
import { PublisherPreviewApp } from './preview-app.tsx';

export const dynamic = 'force-dynamic';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <PublisherPreviewApp />;
}
