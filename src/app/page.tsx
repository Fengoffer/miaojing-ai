import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnnouncementPopup } from '@/components/announcement-popup';
import { BillingPlanGuard } from '@/components/billing-plan-guard';
import { SiteLogo } from '@/components/site-brand';
import { SiteFooter } from '@/components/site-footer';
import {
  Brush,
  ImagePlus,
  Video,
  Film,
  ArrowRight,
  Zap,
  Shield,
  Coins,
  Layers,
  Check,
  Sparkles,
} from 'lucide-react';

const features = [
  {
    icon: Brush,
    title: '文生图',
    desc: '用文字描述你的想象，AI即刻生成精美画作。支持多种风格、尺寸与参数调优。',
    href: '/create?type=text2img',
    gradient: 'from-amber-500/20 to-orange-500/10',
  },
  {
    icon: ImagePlus,
    title: '图生图',
    desc: '上传参考图片，AI基于你的素材进行风格迁移、场景变换和创意延展。',
    href: '/create?type=img2img',
    gradient: 'from-emerald-500/20 to-teal-500/10',
  },
  {
    icon: Video,
    title: '文生视频',
    desc: '输入场景描述，AI生成流畅的动态视频。支持多种镜头语言和风格设定。',
    href: '/create?type=text2video',
    gradient: 'from-rose-500/20 to-pink-500/10',
  },
  {
    icon: Film,
    title: '图生视频',
    desc: '将静态图片转化为动态视频，照片动画化、产品展示、场景延续一站搞定。',
    href: '/create?type=img2video',
    gradient: 'from-sky-500/20 to-cyan-500/10',
  },
];

const highlights = [
  { icon: Zap, title: '极速创作', desc: '数秒出图，分钟出视频，AI辅助将传统流程缩短90%' },
  { icon: Shield, title: '数据安全', desc: '多租户数据隔离，企业级安全标准，创作内容私密保护' },
  { icon: Coins, title: '灵活计费', desc: '积分制+订阅制双模式，按需付费，用多少花多少' },
  { icon: Layers, title: '多模型支持', desc: '兼容主流AI模型，支持自备API，灵活切换无锁定' },
];

const pricing = [
  {
    tier: '免费版',
    price: '0',
    desc: '体验核心创作能力',
    features: ['每日5次创作额度', '标准画质输出', '社区作品展示', '基础参数调整'],
    cta: '免费开始',
    popular: false,
  },
  {
    tier: '基础版',
    price: '29',
    desc: '适合轻度创作者',
    features: ['每日50次创作额度', '高清画质输出', '私有作品存储', '全部参数解锁', '作品批量下载'],
    cta: '立即订阅',
    popular: false,
  },
  {
    tier: '专业版',
    price: '99',
    desc: '适合专业创作者与团队',
    features: ['无限创作额度', '4K超清输出', '自定义API接入', '批量处理能力', '优先处理队列', '高级风格预设'],
    cta: '升级专业版',
    popular: true,
  },
  {
    tier: '企业版',
    price: '499',
    desc: '适合企业与大型团队',
    features: ['无限创作+团队协作', '专属API额度', '品牌风格定制', '私有化部署选项', '7x24技术支持', '商业版权保障'],
    cta: '联系销售',
    popular: false,
  },
];

export default function HomePage() {
  return (
    <div className="mobile-home-page min-h-screen">
      {/* Announcement Popup */}
      <AnnouncementPopup />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[100px]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-20 pb-24 text-center">
          <div className="mobile-hero-card">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium gap-2">
              <SiteLogo className="h-5 w-5 rounded" />
              一站式AI多模态创作平台
            </Badge>

            <h1 className="mobile-hero-title font-serif text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
              妙手丹青
              <span className="block mt-2 text-primary">境随心造</span>
            </h1>

            <p className="mt-6 mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground leading-relaxed">
              用AI释放你的创造力。文生图、图生图、文生视频、图生视频 —
              四大核心能力，从想象到作品只需一步。
            </p>

            <div className="mobile-hero-actions mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/create">
                <Button size="lg" className="gap-2 px-8 text-base h-12">
                  <Brush className="h-5 w-5" />
                  开始创作
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/gallery">
                <Button size="lg" variant="outline" className="gap-2 px-8 text-base h-12">
                  浏览作品
                </Button>
              </Link>
            </div>

            <div className="mobile-quick-action-grid mt-8 grid grid-cols-2 gap-3 md:hidden">
              {features.map((feat) => {
                const Icon = feat.icon;
                return (
                  <Link key={feat.title} href={feat.href} className="mobile-quick-action-tile">
                    <Icon className="h-5 w-5" />
                    <span>{feat.title}</span>
                  </Link>
                );
              })}
            </div>

            {/* Stats */}
            <div className="mobile-stat-grid mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
              {[
                { value: '4', label: '核心创作能力' },
                { value: '10s', label: '平均出图时间' },
                { value: '100+', label: '预设风格' },
                { value: '队列', label: '任务状态可追踪' },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-3xl font-bold font-serif text-primary">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-24 bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl sm:text-4xl font-bold">四大核心能力</h2>
            <p className="mt-4 text-muted-foreground text-lg">从文字到画面，从静态到动态，全方位AI创作体验</p>
          </div>

          <div className="mobile-feature-rail grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feat) => {
              const Icon = feat.icon;
              return (
                <Link key={feat.title} href={feat.href} className="mobile-feature-card">
                  <Card className="group h-full hover:border-primary/30 hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden">
                    <CardContent className="p-6">
                      <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${feat.gradient} mb-4`}>
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="font-serif text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                        {feat.title}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {feat.desc}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        立即体验 <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl sm:text-4xl font-bold">为什么选择妙境</h2>
            <p className="mt-4 text-muted-foreground text-lg">创作无界，效率无限</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="text-center">
                  <div className="inline-flex p-4 rounded-2xl bg-primary/10 mb-4">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-serif text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <BillingPlanGuard>
        <section className="py-24 bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="text-center mb-16">
              <h2 className="font-serif text-3xl sm:text-4xl font-bold">灵活的计费方案</h2>
              <p className="mt-4 text-muted-foreground text-lg">按需选择，从免费体验到企业定制</p>
            </div>

            <div className="mobile-pricing-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {pricing.map((plan) => (
                <Card
                  key={plan.tier}
                  className={`relative h-full ${
                    plan.popular ? 'border-primary shadow-lg shadow-primary/10' : ''
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="px-3 py-1">最受欢迎</Badge>
                    </div>
                  )}
                  <CardContent className="p-6 flex flex-col h-full">
                    <h3 className="font-serif text-lg font-semibold">{plan.tier}</h3>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-3xl font-bold">¥{plan.price}</span>
                      <span className="text-muted-foreground text-sm">/月</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{plan.desc}</p>
                    <ul className="mt-6 flex-1 space-y-3">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href="/auth/register" className="mt-6 block">
                      <Button
                        className="w-full"
                        variant={plan.popular ? 'default' : 'outline'}
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </BillingPlanGuard>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl sm:text-4xl font-bold">准备好了吗？</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            加入数千名创作者，用AI开启你的创作之旅
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/create">
              <Button size="lg" className="gap-2 px-8 h-12 text-base">
                <Sparkles className="h-5 w-5" />
                免费开始创作
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
