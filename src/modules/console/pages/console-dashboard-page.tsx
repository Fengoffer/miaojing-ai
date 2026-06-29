'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  Coins,
  CreditCard,
  Database,
  Eye,
  Home,
  Images,
  Key,
  LayoutDashboard,
  ListChecks,
  Logs,
  Loader2,
  Menu,
  Package,
  PlugZap,
  Receipt,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Ticket,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-store';
import { useSiteConfig } from '@/lib/site-config';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ApiManagementTab = dynamic(() => import('@/components/admin/api-management-tab'), { ssr: false });
const UserManagementTab = dynamic(() => import('@/components/admin/user-management-tab'), { ssr: false });
const PricingTab = dynamic(() => import('@/components/admin/pricing-tab'), { ssr: false });
const OrderManagementTab = dynamic(() => import('@/components/admin/order-management-tab'), { ssr: false });
const PaymentTab = dynamic(() => import('@/components/admin/payment-tab'), { ssr: false });
const RedeemCodeManagementTab = dynamic(() => import('@/components/admin/redeem-code-management-tab'), { ssr: false });
const AnnouncementTab = dynamic(() => import('@/components/admin/announcement-tab'), { ssr: false });
const DataManagementTab = dynamic(() => import('@/components/admin/data-management-tab'), { ssr: false });
const SystemUpgradeTab = dynamic(() => import('@/components/admin/system-upgrade-tab'), { ssr: false });
const TaskManagementTab = dynamic(() => import('@/components/admin/task-management-tab'), { ssr: false });
const ModelCallRecordsTab = dynamic(() => import('@/components/admin/model-call-records-tab'), { ssr: false });
const GalleryManagementTab = dynamic(() => import('@/components/admin/gallery-management-tab'), { ssr: false });
const LogManagementTab = dynamic(() => import('@/components/admin/log-management-tab'), { ssr: false });
const SettingsTab = dynamic(() => import('@/components/admin/settings-tab'), { ssr: false });

type ConsoleView =
  | 'dashboard'
  | 'api'
  | 'users'
  | 'pricing'
  | 'orders'
  | 'payment'
  | 'redeemCodes'
  | 'announcements'
  | 'data'
  | 'upgrade'
  | 'tasks'
  | 'modelCalls'
  | 'gallery'
  | 'logs'
  | 'settings';

type NavItem = {
  value: ConsoleView;
  label: string;
  icon: LucideIcon;
  hidden?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const CONSOLE_ACTIVE_VIEW_SESSION_KEY = 'miaojing_console_active_view';
const CONSOLE_VIEWS: ConsoleView[] = [
  'dashboard',
  'api',
  'users',
  'pricing',
  'orders',
  'payment',
  'redeemCodes',
  'announcements',
  'data',
  'upgrade',
  'tasks',
  'modelCalls',
  'gallery',
  'logs',
  'settings',
];

function isConsoleView(value: unknown): value is ConsoleView {
  return typeof value === 'string' && CONSOLE_VIEWS.includes(value as ConsoleView);
}

type DashboardSummary = {
  generatedAt: string | null;
  platform: {
    totalVisits: number;
    databaseTime: string | null;
  };
  users: {
    total: number;
    active: number;
    disabled: number;
    admins: number;
    members: number;
    created7d: number;
  };
  works: {
    total: number;
    public: number;
    private: number;
    completed: number;
    failed: number;
    withResultUrl: number;
    created7d: number;
    resultUrlCoverage: number;
    byType: {
      text2img: number;
      img2img: number;
      text2video: number;
      img2video: number;
    };
  };
  tasks: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    latest: Array<{
      id: string;
      type: string;
      status: string;
      error: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    }>;
  };
  orders: {
    total: number;
    pending: number;
    paid: number;
    cancelled: number;
    refunded: number;
    paidRevenue: number;
    paidRevenue7d: number;
    latest: Array<{
      id: string;
      orderNo: string;
      productName: string;
      amount: number;
      status: string;
      createdAt: string | null;
    }>;
  };
  providers: {
    total: number;
    active: number;
    inactive: number;
    image: number;
    video: number;
    text: number;
    incomplete: number;
    recommendationsTotal: number;
    recommendationsActive: number;
    userApiKeysTotal: number;
    userApiKeysActive: number;
  };
  announcements: {
    total: number;
    active: number;
    scheduled: number;
    expired: number;
  };
  system: {
    apiHealth: boolean;
    databaseHealth: boolean;
    storageHealth?: boolean;
    storageDirConfigured?: boolean;
    storageBackend?: string;
    worksPersisted?: number;
    worksTotal?: number;
    logsTotal?: number;
    logsErrors?: number;
    logsCreated24h?: number;
  };
};

const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  generatedAt: null,
  platform: { totalVisits: 0, databaseTime: null },
  users: { total: 0, active: 0, disabled: 0, admins: 0, members: 0, created7d: 0 },
  works: {
    total: 0,
    public: 0,
    private: 0,
    completed: 0,
    failed: 0,
    withResultUrl: 0,
    created7d: 0,
    resultUrlCoverage: 1,
    byType: { text2img: 0, img2img: 0, text2video: 0, img2video: 0 },
  },
  tasks: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, latest: [] },
  orders: { total: 0, pending: 0, paid: 0, cancelled: 0, refunded: 0, paidRevenue: 0, paidRevenue7d: 0, latest: [] },
  providers: {
    total: 0,
    active: 0,
    inactive: 0,
    image: 0,
    video: 0,
    text: 0,
    incomplete: 0,
    recommendationsTotal: 0,
    recommendationsActive: 0,
    userApiKeysTotal: 0,
    userApiKeysActive: 0,
  },
  announcements: { total: 0, active: 0, scheduled: 0, expired: 0 },
  system: {
    apiHealth: false,
    databaseHealth: false,
    storageHealth: false,
    storageDirConfigured: false,
    worksPersisted: 0,
    worksTotal: 0,
    logsTotal: 0,
    logsErrors: 0,
    logsCreated24h: 0,
  },
};

const VIEW_TITLES: Record<ConsoleView, { title: string; description: string }> = {
  dashboard: { title: '仪表盘', description: '查看运营、任务、支付、模型和系统健康概览' },
  api: { title: 'API 管理', description: '配置供应商、模型推荐与系统 API' },
  users: { title: '用户管理', description: '管理用户、额度、会员与账号状态' },
  pricing: { title: '价格设置', description: '维护套餐价格与积分规则' },
  orders: { title: '订单管理', description: '查看订单并处理支付状态' },
  payment: { title: '支付配置', description: '配置可用支付方式' },
  redeemCodes: { title: '兑换码', description: '生成积分兑换码并查看使用状态' },
  announcements: { title: '公告管理', description: '创建和维护站点弹窗公告' },
  data: { title: '数据管理', description: '导出、导入与恢复业务数据' },
  upgrade: { title: '系统升级', description: '上传升级包，执行热更新、冷更新与失败自动回滚' },
  tasks: { title: '任务管理', description: '查看生成任务状态并清理任务' },
  modelCalls: { title: '模型调用', description: '查看每个模型的调用状态、耗时、结果和积分消耗' },
  gallery: { title: '画廊管理', description: '修改公开作品提示词并邮件通知作者' },
  logs: { title: '系统日志', description: '查看平台运行、登录、安全和管理操作日志' },
  settings: { title: '系统设置', description: '维护站点信息、邮箱与通知设置' },
};

function useAdminDashboard(accessToken: string | null) {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_DASHBOARD_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async ({ silent = false, showSuccess = false }: { silent?: boolean; showSuccess?: boolean } = {}) => {
    if (!accessToken) {
      setLoading(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '仪表盘数据加载失败');
      setSummary({ ...EMPTY_DASHBOARD_SUMMARY, ...data });
      if (showSuccess) toast.success('仪表盘已刷新');
    } catch (err) {
      const message = err instanceof Error ? err.message : '仪表盘数据加载失败';
      setError(message);
      if (!silent || showSuccess) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/dashboard', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '仪表盘数据加载失败');
        if (!cancelled) setSummary({ ...EMPTY_DASHBOARD_SUMMARY, ...data });
      } catch (err) {
        const message = err instanceof Error ? err.message : '仪表盘数据加载失败';
        if (!cancelled) {
          setError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialLoad();
    const timer = window.setInterval(() => {
      if (!cancelled) load({ silent: true });
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accessToken, load]);

  return { summary, loading, refreshing, error, refresh: () => load({ silent: true, showSuccess: true }) };
}

export default function ConsoleDashboardPage() {
  const { isLoggedIn, isAdmin, user, accessToken, logout } = useAuth();
  const { config: siteConfig } = useSiteConfig();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState<ConsoleView>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const membershipEnabled = siteConfig.membershipEnabled !== false;

  const navGroups = useMemo<NavGroup[]>(() => {
    const groups: NavGroup[] = [
      {
        label: '总览',
        items: [{ value: 'dashboard', label: '仪表盘', icon: LayoutDashboard }],
      },
      {
        label: '运营',
        items: [
          { value: 'users', label: '用户管理', icon: Users },
          { value: 'pricing', label: '价格设置', icon: Coins, hidden: !membershipEnabled },
          { value: 'orders', label: '订单管理', icon: Receipt, hidden: !membershipEnabled },
          { value: 'payment', label: '支付配置', icon: CreditCard, hidden: !membershipEnabled },
          { value: 'redeemCodes', label: '兑换码', icon: Ticket, hidden: !membershipEnabled },
        ],
      },
      {
        label: '创作',
        items: [
          { value: 'api', label: 'API 管理', icon: Key },
          { value: 'tasks', label: '任务管理', icon: ListChecks },
          { value: 'modelCalls', label: '模型调用', icon: BarChart3 },
          { value: 'gallery', label: '画廊管理', icon: Images },
          { value: 'announcements', label: '公告管理', icon: Bell },
        ],
      },
      {
        label: '系统',
        items: [
          { value: 'data', label: '数据管理', icon: Database },
          { value: 'upgrade', label: '系统升级', icon: Package },
          { value: 'logs', label: '系统日志', icon: Logs },
          { value: 'settings', label: '系统设置', icon: Settings },
        ],
      },
    ];

    return groups
      .map(group => ({ ...group, items: group.items.filter(item => !item.hidden) }))
      .filter(group => group.items.length > 0);
  }, [membershipEnabled]);

  useEffect(() => {
    setMounted(true);
    try {
      const storedView = window.sessionStorage.getItem(CONSOLE_ACTIVE_VIEW_SESSION_KEY);
      if (isConsoleView(storedView)) setActiveView(storedView);
    } catch {
      // Ignore unavailable sessionStorage.
    }
  }, []);

  useEffect(() => {
    if (!membershipEnabled && ['pricing', 'orders', 'payment', 'redeemCodes'].includes(activeView)) {
      setActiveView('dashboard');
    }
  }, [membershipEnabled, activeView]);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.sessionStorage.setItem(CONSOLE_ACTIVE_VIEW_SESSION_KEY, activeView);
    } catch {
      // Ignore unavailable sessionStorage.
    }
  }, [mounted, activeView]);

  useEffect(() => {
    if (!mounted) return;
    if (!isLoggedIn || !isAdmin || !accessToken) {
      router.replace('/console');
    }
  }, [mounted, isLoggedIn, isAdmin, accessToken, router]);

  if (!mounted) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!isLoggedIn || !isAdmin || !accessToken) {
    return <div className="min-h-screen bg-background" />;
  }

  const title = VIEW_TITLES[activeView];

  const handleLogout = () => {
    try {
      window.sessionStorage.removeItem(CONSOLE_ACTIVE_VIEW_SESSION_KEY);
    } catch {
      // Ignore unavailable sessionStorage.
    }
    logout();
    router.replace('/console');
  };

  const navigateToView = (view: ConsoleView) => {
    setActiveView(view);
    setMobileNavOpen(false);
  };

  return (
    <div className="console-mobile-page fixed inset-0 flex overflow-hidden bg-background text-foreground">
      <aside className="hidden w-[17rem] shrink-0 border-r border-border/70 bg-sidebar/95 lg:flex lg:flex-col">
        <ConsoleSidebar
          activeView={activeView}
          navGroups={navGroups}
          onNavigate={navigateToView}
          onBackHome={() => router.push('/')}
          onLogout={handleLogout}
          userName={user?.nickname || '管理员'}
          userEmail={user?.email || ''}
        />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,21rem)] flex-col border-r border-border bg-sidebar shadow-2xl">
            <ConsoleSidebar
              activeView={activeView}
              navGroups={navGroups}
              onNavigate={navigateToView}
              onBackHome={() => router.push('/')}
              onLogout={handleLogout}
              userName={user?.nickname || '管理员'}
              userEmail={user?.email || ''}
              closeButton={
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setMobileNavOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              }
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 lg:hidden" onClick={() => setMobileNavOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{title.title}</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{title.description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              管理员
            </Badge>
          </div>
        </header>

        <main className="console-mobile-main min-h-0 flex-1 overflow-y-auto">
          <div className="console-mobile-content min-h-full w-full px-4 py-5 sm:px-6 lg:px-8">
            <ConsoleContent activeView={activeView} setActiveView={setActiveView} />
          </div>
        </main>
      </div>
    </div>
  );
}

function ConsoleSidebar({
  activeView,
  navGroups,
  onNavigate,
  onBackHome,
  onLogout,
  userName,
  userEmail,
  closeButton,
}: {
  activeView: ConsoleView;
  navGroups: NavGroup[];
  onNavigate: (view: ConsoleView) => void;
  onBackHome: () => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
  closeButton?: ReactNode;
}) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">妙境 Console</div>
            <div className="truncate text-xs text-muted-foreground">{userEmail || userName}</div>
          </div>
        </div>
        {closeButton}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {navGroups.map(group => (
            <div key={group.label}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = activeView === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onNavigate(item.value)}
                      className={cn(
                        'flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-border/70 p-3">
        <div className="mb-3 rounded-md border border-border/70 bg-background/45 px-3 py-2">
          <div className="truncate text-sm font-medium">{userName}</div>
          <div className="text-xs text-muted-foreground">后台管理权限</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onBackHome}>
            <Home className="h-4 w-4" />
            站点
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            退出
          </Button>
        </div>
      </div>
    </>
  );
}

function ConsoleContent({
  activeView,
  setActiveView,
}: {
  activeView: ConsoleView;
  setActiveView: (view: ConsoleView) => void;
}) {
  switch (activeView) {
    case 'dashboard':
      return <DashboardView setActiveView={setActiveView} />;
    case 'api':
      return <ApiManagementTab />;
    case 'users':
      return <UserManagementTab />;
    case 'pricing':
      return <PricingTab />;
    case 'orders':
      return <OrderManagementTab />;
    case 'payment':
      return <PaymentTab />;
    case 'redeemCodes':
      return <RedeemCodeManagementTab />;
    case 'announcements':
      return <AnnouncementTab />;
    case 'data':
      return <DataManagementTab />;
    case 'upgrade':
      return <SystemUpgradeTab />;
    case 'tasks':
      return <TaskManagementTab />;
    case 'modelCalls':
      return <ModelCallRecordsTab />;
    case 'gallery':
      return <GalleryManagementTab />;
    case 'logs':
      return <LogManagementTab />;
    case 'settings':
      return <SettingsTab />;
    default:
      return <DashboardView setActiveView={setActiveView} />;
  }
}

function DashboardView({ setActiveView }: { setActiveView: (view: ConsoleView) => void }) {
  const { accessToken } = useAuth();
  const { summary, loading, refreshing, error, refresh } = useAdminDashboard(accessToken);
  const persistedWorks = summary.system.worksPersisted ?? summary.works.withResultUrl;
  const totalWorksForCoverage = summary.system.worksTotal ?? summary.works.total;
  const resultUrlCoverage = totalWorksForCoverage > 0 ? persistedWorks / totalWorksForCoverage : 1;

  const riskItems = [
    {
      label: '失败任务',
      value: summary.tasks.failed,
      detail: summary.tasks.failed > 0 ? '需要检查任务错误并清理' : '任务队列无失败积压',
      view: 'tasks' as ConsoleView,
      severity: summary.tasks.failed > 0 ? 'warning' : 'ok',
    },
    {
      label: '待处理订单',
      value: summary.orders.pending,
      detail: summary.orders.pending > 0 ? '存在待处理支付订单' : '订单状态正常',
      view: 'orders' as ConsoleView,
      severity: summary.orders.pending > 0 ? 'warning' : 'ok',
    },
    {
      label: '未完整供应商',
      value: summary.providers.incomplete,
      detail: summary.providers.incomplete > 0 ? '供应商缺少地址或默认模型' : '供应商配置完整',
      view: 'api' as ConsoleView,
      severity: summary.providers.incomplete > 0 ? 'warning' : 'ok',
    },
    {
      label: '作品结果覆盖',
      value: `${Math.round(resultUrlCoverage * 100)}%`,
      detail: resultUrlCoverage < 1 ? '存在缺少结果链接的作品' : '持久化结果链接完整',
      view: 'data' as ConsoleView,
      severity: resultUrlCoverage < 1 ? 'warning' : 'ok',
    },
  ];

  const statCards = [
    { label: '总访问量', value: summary.platform.totalVisits, sub: '站点累计访问', icon: Eye, tone: 'text-sky-500' },
    { label: '注册用户', value: summary.users.total, sub: `7日新增 ${formatNumber(summary.users.created7d)}`, icon: Users, tone: 'text-emerald-500' },
    { label: '公开作品', value: summary.works.public, sub: `总作品 ${formatNumber(summary.works.total)}`, icon: BarChart3, tone: 'text-amber-500' },
    { label: '任务总数', value: summary.tasks.total, sub: `运行 ${formatNumber(summary.tasks.running)} / 排队 ${formatNumber(summary.tasks.queued)}`, icon: ListChecks, tone: 'text-violet-500' },
    { label: '支付收入', value: formatCurrency(summary.orders.paidRevenue), sub: `7日 ${formatCurrency(summary.orders.paidRevenue7d)}`, icon: Receipt, tone: 'text-rose-500' },
    { label: '启用模型源', value: `${formatNumber(summary.providers.active)}/${formatNumber(summary.providers.total)}`, sub: `推荐模型 ${formatNumber(summary.providers.recommendationsActive)}`, icon: PlugZap, tone: 'text-cyan-500' },
  ];

  const quickActions: Array<{ label: string; description: string; view: ConsoleView; icon: LucideIcon }> = [
    { label: '配置模型 API', description: '维护供应商、推荐模型和默认能力', view: 'api', icon: Key },
    { label: '查看任务队列', description: '排查失败、排队和运行中的生成任务', view: 'tasks', icon: ListChecks },
    { label: '查看系统日志', description: '筛选登录、安全、生成和管理操作日志', view: 'logs', icon: Logs },
    { label: '管理用户额度', description: '调整会员、积分和账号状态', view: 'users', icon: Users },
    { label: '导出数据备份', description: '下载当前业务数据并确认恢复入口', view: 'data', icon: Database },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">仪表盘</h2>
          <p className="text-sm text-muted-foreground">
            {summary.generatedAt ? `最后更新 ${formatDateTime(summary.generatedAt)}` : '正在读取系统概览'}
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full gap-2 md:w-auto"
          onClick={refresh}
          disabled={refreshing || loading}
          aria-busy={refreshing}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          {refreshing ? '刷新中...' : '刷新'}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-6">
        {statCards.map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="overflow-hidden">
              <CardContent className="flex min-h-[7.5rem] items-center gap-4 p-5">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted', item.tone)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 truncate text-2xl font-bold">
                    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : item.value}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.sub}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">待处理事项</CardTitle>
            <CardDescription>按上线运营风险优先展示需要管理员处理的项目</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {riskItems.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => setActiveView(item.view)}
                className="rounded-lg border border-border/70 p-4 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  {item.severity === 'warning' ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  )}
                </div>
                <div className="mt-2 text-2xl font-bold">{typeof item.value === 'number' ? formatNumber(item.value) : item.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">系统健康</CardTitle>
            <CardDescription>服务、数据库和持久化状态</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <HealthLine label="管理 API" ok={summary.system.apiHealth} />
            <HealthLine label="数据库连接" ok={summary.system.databaseHealth} />
            <HealthLine label="持久化存储" ok={Boolean(summary.system.storageHealth)} />
            {summary.system.storageBackend && <SummaryLine label="存储模式" value={summary.system.storageBackend} />}
            <SummaryLine label="作品结果链接" value={`${formatNumber(summary.system.worksPersisted ?? summary.works.withResultUrl)}/${formatNumber(summary.system.worksTotal ?? summary.works.total)}`} />
            <SummaryLine label="系统日志" value={`${formatNumber(summary.system.logsCreated24h || 0)} 条/24小时`} />
            <SummaryLine label="错误日志" value={formatNumber(summary.system.logsErrors || 0)} />
            <SummaryLine label="用户 API Key" value={`${formatNumber(summary.providers.userApiKeysActive)}/${formatNumber(summary.providers.userApiKeysTotal)}`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">任务队列</CardTitle>
            <CardDescription>生成任务的实时状态分布</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SummaryBlock label="排队" value={summary.tasks.queued} />
              <SummaryBlock label="运行中" value={summary.tasks.running} />
              <SummaryBlock label="已完成" value={summary.tasks.succeeded} />
              <SummaryBlock label="失败" value={summary.tasks.failed} />
            </div>
            <RecentList
              emptyText="暂无生成任务"
              items={summary.tasks.latest.map(task => ({
                key: task.id,
                title: `${task.type || 'generation'} · ${statusText(task.status)}`,
                meta: task.error || formatDateTime(task.createdAt),
                tone: task.status === 'failed' ? 'warning' : undefined,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">支付与订单</CardTitle>
            <CardDescription>订单处理和营收概览</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SummaryBlock label="待支付" value={summary.orders.pending} />
              <SummaryBlock label="已支付" value={summary.orders.paid} />
              <SummaryBlock label="已取消" value={summary.orders.cancelled} />
              <SummaryBlock label="已退款" value={summary.orders.refunded} />
            </div>
            <RecentList
              emptyText="暂无订单"
              items={summary.orders.latest.map(order => ({
                key: order.id,
                title: order.productName || order.orderNo || order.id.slice(0, 8),
                meta: `${formatCurrency(order.amount)} · ${statusText(order.status)}`,
                tone: order.status === 'pending' ? 'warning' : undefined,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">模型与内容</CardTitle>
            <CardDescription>创作能力、公告和作品结构</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryLine label="图像供应商" value={summary.providers.image} />
            <SummaryLine label="视频供应商" value={summary.providers.video} />
            <SummaryLine label="文本供应商" value={summary.providers.text} />
            <SummaryLine label="生图作品" value={summary.works.byType.text2img + summary.works.byType.img2img} />
            <SummaryLine label="视频作品" value={summary.works.byType.text2video + summary.works.byType.img2video} />
            <SummaryLine label="生效公告" value={`${formatNumber(summary.announcements.active)}/${formatNumber(summary.announcements.total)}`} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">快捷操作</CardTitle>
          <CardDescription>进入常用管理功能</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.view}
                type="button"
                onClick={() => setActiveView(action.view)}
                className="rounded-lg border border-border/70 p-4 text-left transition-colors hover:bg-muted/60"
              >
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <div className="font-medium">{action.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{action.description}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <InsightCard
          icon={<Sparkles className="h-4 w-4" />}
          title="AI 平台后台"
          description="仪表盘聚焦模型源、用量、任务状态和失败项，便于第一时间定位生成链路问题。"
        />
        <InsightCard
          icon={<Receipt className="h-4 w-4" />}
          title="交易后台"
          description="订单状态、待处理支付和营收数据前置，保持支付和会员运营可追踪。"
        />
        <InsightCard
          icon={<Database className="h-4 w-4" />}
          title="云控制台"
          description="数据库健康、持久化链接和备份入口放在首屏，支撑上线后的运维检查。"
        />
      </div>
    </div>
  );
}

function SummaryBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{formatNumber(value)}</p>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{typeof value === 'number' ? formatNumber(value) : value}</span>
    </div>
  );
}

function HealthLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/45 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? 'secondary' : 'destructive'} className="gap-1">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {ok ? '正常' : '异常'}
      </Badge>
    </div>
  );
}

function RecentList({
  items,
  emptyText,
}: {
  items: Array<{ key: string; title: string; meta: string; tone?: 'warning' }>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed border-border/80 px-3 py-5 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div className="space-y-2">
      {items.slice(0, 4).map(item => (
        <div key={item.key} className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 px-3 py-2">
          <div className={cn('h-2 w-2 shrink-0 rounded-full bg-emerald-500', item.tone === 'warning' && 'bg-amber-500')} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.title}</div>
            <div className="truncate text-xs text-muted-foreground">{item.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatCurrency(value: number): string {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无时间';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    queued: '排队',
    running: '运行中',
    succeeded: '已完成',
    failed: '失败',
    pending: '待支付',
    paid: '已支付',
    cancelled: '已取消',
    refunded: '已退款',
    completed: '已完成',
  };
  return map[status] || status || '未知';
}
