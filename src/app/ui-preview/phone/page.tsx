import { notFound } from 'next/navigation';
import { PhonePreview } from '../../../features/phone/phone-preview.tsx';
export const dynamic = 'force-dynamic';
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PhonePreview />;
}
