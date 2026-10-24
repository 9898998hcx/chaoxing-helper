import type { Metadata } from 'next';
import { SessionProvider } from '../components/session';
import { Header } from '../components/header';
import './globals.css';
export const metadata: Metadata = { title: { default: '履历工坊 · 把经历写清楚', template: '%s · 履历工坊' }, description: '为中文求职打造的在线简历编辑器，支持 AI 辅助、结构参考与 PDF 导出。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><SessionProvider><Header/><main id="main">{children}</main><footer className="site-footer"><span>履历工坊</span><span>每一份经历，都值得被认真表达。</span></footer></SessionProvider></body></html>;
}
