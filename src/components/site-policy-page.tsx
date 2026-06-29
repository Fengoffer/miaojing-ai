'use client';

import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { SiteLogo, SiteName } from '@/components/site-brand';
import { useSiteConfig } from '@/lib/site-config';

type PolicyPageKind = 'about' | 'terms' | 'privacy' | 'help';

const pageMeta: Record<PolicyPageKind, { title: string; getContent: (config: ReturnType<typeof useSiteConfig>['config']) => string }> = {
  about: { title: '关于我们', getContent: config => config.aboutUs },
  terms: { title: '使用条款', getContent: config => config.termsOfService },
  privacy: { title: '隐私政策', getContent: config => config.privacyPolicy },
  help: { title: '帮助中心', getContent: config => config.helpCenter },
};

export function SitePolicyPage({ kind }: { kind: PolicyPageKind }) {
  const { config } = useSiteConfig();
  const meta = pageMeta[kind];
  const content = meta.getContent(config);

  return (
    <main className="policy-mobile-page min-h-screen bg-background">
      <div className="policy-mobile-shell mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10 sm:px-6">
        <header className="policy-mobile-header mb-10 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2">
            <SiteLogo className="h-8 w-8 rounded" />
            <span className="font-serif text-xl font-bold"><SiteName /></span>
          </Link>
          <Link href="/">
            <Button variant="outline" size="sm">返回首页</Button>
          </Link>
        </header>

        <article className="policy-mobile-content flex-1">
          <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">{meta.title}</h1>
          <div className="announcement-markdown mt-8 break-words rounded-lg border border-border bg-card p-5 text-sm leading-8 text-muted-foreground sm:p-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </main>
  );
}
