import { CloudPreview } from '../features/preview/cloud-preview.tsx';
import { InterviewApp } from '../features/interview/interview-app.tsx';
export default function Home() {
  return process.env.APP_PREVIEW_ONLY === '1' ? <CloudPreview /> : <InterviewApp />;
}
