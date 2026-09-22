import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '如果 · Parallel Life', description: '从你的人生，走向另一种可能。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
