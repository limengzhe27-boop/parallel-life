import { isPreviewOnly } from '../../contracts/preview.ts';
import { CloudPreview } from '../../features/preview/cloud-preview.tsx';
import { DiscoveryApp } from '../../features/discovery/discovery-app.tsx';
export default function Page() {
  return isPreviewOnly() ? <CloudPreview page="possibilities" /> : <DiscoveryApp />;
}
