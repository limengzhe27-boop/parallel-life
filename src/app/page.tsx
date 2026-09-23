import { isPreviewOnly } from '../contracts/preview.ts';
import { CloudPreview } from '../features/preview/cloud-preview.tsx';
import { InterviewApp } from '../features/interview/interview-app.tsx';
export default function Home() {
  return isPreviewOnly() ? <CloudPreview /> : <InterviewApp />;
}
