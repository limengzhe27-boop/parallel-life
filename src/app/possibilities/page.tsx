import { CloudPreview } from '../../features/preview/cloud-preview.tsx';
import { DiscoveryApp } from '../../features/discovery/discovery-app.tsx';
export default function Page() {
  return process.env.APP_PREVIEW_ONLY === '1' ? (
    <CloudPreview page="possibilities" />
  ) : (
    <DiscoveryApp />
  );
}
