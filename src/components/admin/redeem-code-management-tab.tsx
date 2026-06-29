'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-store';
import { useSiteConfig } from '@/lib/site-config';
import { cn } from '@/lib/utils';
import { Calendar, Check, Coins, Copy, Crown, ExternalLink, Loader2, Search, Settings, Ticket, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

type RedeemCode = {
  id: string;
  code: string;
  codeType: 'credits' | 'membership';
  creditsAmount: number;
  membershipTier: string | null;
  membershipDurationValue: number | null;
  membershipDurationUnit: 'day' | 'month' | 'year' | null;
  note: string;
  isActive: boolean;
  createdByName: string | null;
  usedByEmail: string | null;
  usedByName: string | null;
  usedAt: string | null;
  createdAt: string;
};

type StatusFilter = 'all' | 'unused' | 'used' | 'inactive';
type CodeType = 'credits' | 'membership';

const tierLabels: Record<string, string> = {
  pro: 'Pro 会员',
  max: 'Max 会员',
  ultra: 'Ultra 会员',
  enterprise: '企业会员',
};

const durationUnitLabels: Record<string, string> = {
  day: '天',
  month: '个月',
  year: '年',
};

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getCodeStatus(code: RedeemCode) {
  if (code.usedAt) return { label: '已使用', className: 'border-slate-400/30 text-muted-foreground' };
  if (!code.isActive) return { label: '已停用', className: 'border-destructive/30 text-destructive' };
  return { label: '未使用', className: 'border-emerald-500/30 text-emerald-500' };
}

function getRedeemValueLabel(code: RedeemCode) {
  if (code.codeType === 'membership') {
    return `${tierLabels[code.membershipTier || ''] || code.membershipTier || '会员'} ${code.membershipDurationValue || 0}${durationUnitLabels[code.membershipDurationUnit || ''] || ''}`;
  }
  return `${code.creditsAmount} 积分`;
}

export default function RedeemCodeManagementTab() {
  const { accessToken } = useAuth();
  const { config: siteConfig, loaded: siteConfigLoaded, saveSiteConfig } = useSiteConfig();
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [generatedCodes, setGeneratedCodes] = useState<RedeemCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [codeType, setCodeType] = useState<CodeType>('credits');
  const [count, setCount] = useState('1');
  const [creditsAmount, setCreditsAmount] = useState('100');
  const [membershipTier, setMembershipTier] = useState('pro');
  const [membershipDurationValue, setMembershipDurationValue] = useState('1');
  const [membershipDurationUnit, setMembershipDurationUnit] = useState<'day' | 'month' | 'year'>('month');
  const [note, setNote] = useState('');
  const [mallDialogOpen, setMallDialogOpen] = useState(false);
  const [mallUrl, setMallUrl] = useState('');
  const [savingMallUrl, setSavingMallUrl] = useState(false);

  const loadCodes = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: '200' });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/admin/redeem-codes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '兑换码加载失败');
      setCodes(Array.isArray(data.codes) ? data.codes : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '兑换码加载失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(loadCodes, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadCodes, search]);

  useEffect(() => {
    if (siteConfigLoaded) setMallUrl(siteConfig.redeemCodeMallUrl || '');
  }, [siteConfig.redeemCodeMallUrl, siteConfigLoaded]);

  const stats = useMemo(() => {
    const total = codes.length;
    const used = codes.filter(code => Boolean(code.usedAt)).length;
    const inactive = codes.filter(code => !code.isActive && !code.usedAt).length;
    const unused = codes.filter(code => code.isActive && !code.usedAt).length;
    return { total, used, inactive, unused };
  }, [codes]);

  const copyText = async (text: string, message = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error('复制失败');
    }
  };

  const handleGenerate = async () => {
    const nextCount = Number(count);
    const nextCredits = Number(creditsAmount);
    const nextDuration = Number(membershipDurationValue);
    if (!Number.isFinite(nextCount) || nextCount < 1 || nextCount > 500) {
      toast.error('生成数量必须在 1 到 500 之间');
      return;
    }
    if (codeType === 'credits' && (!Number.isFinite(nextCredits) || nextCredits <= 0)) {
      toast.error('兑换积分必须大于 0');
      return;
    }
    if (codeType === 'membership' && (!Number.isFinite(nextDuration) || nextDuration <= 0)) {
      toast.error('会员时长必须大于 0');
      return;
    }
    if (!accessToken) return;

    setGenerating(true);
    try {
      const res = await fetch('/api/admin/redeem-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          count: Math.floor(nextCount),
          codeType,
          creditsAmount: codeType === 'credits' ? Math.floor(nextCredits) : 0,
          membershipTier,
          membershipDurationValue: Math.floor(nextDuration),
          membershipDurationUnit,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '生成兑换码失败');
      const created = Array.isArray(data.codes) ? data.codes : [];
      setGeneratedCodes(created);
      toast.success(`已生成 ${created.length} 个${codeType === 'membership' ? '会员' : '积分'}兑换码`);
      await loadCodes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成兑换码失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleActive = async (code: RedeemCode) => {
    if (!accessToken) return;
    try {
      const res = await fetch('/api/admin/redeem-codes', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: code.id, isActive: !code.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '更新失败');
      toast.success(code.isActive ? '已停用兑换码' : '已启用兑换码');
      await loadCodes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败');
    }
  };

  const handleDelete = async (code: RedeemCode) => {
    if (code.usedAt) {
      toast.error('已使用的兑换码不能删除');
      return;
    }
    if (!window.confirm(`确认删除兑换码 ${code.code}？`)) return;
    if (!accessToken) return;
    try {
      const res = await fetch('/api/admin/redeem-codes', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: code.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '删除失败');
      toast.success('兑换码已删除');
      await loadCodes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleSaveMallUrl = async () => {
    const trimmedUrl = mallUrl.trim();
    if (trimmedUrl) {
      try {
        const url = new URL(trimmedUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          toast.error('商城链接必须以 http 或 https 开头');
          return;
        }
      } catch {
        toast.error('请输入有效的商城链接');
        return;
      }
    }
    setSavingMallUrl(true);
    try {
      await saveSiteConfig({ redeemCodeMallUrl: trimmedUrl });
      toast.success(trimmedUrl ? '商城链接已保存' : '商城链接已清空');
      setMallDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '商城链接保存失败');
    } finally {
      setSavingMallUrl(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" className="gap-2" onClick={() => setMallDialogOpen(true)}>
          <Settings className="h-4 w-4" />
          商城链接配置
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Ticket className="h-5 w-5 text-primary" />
              生成兑换码
            </CardTitle>
            <CardDescription>支持积分码和会员码，每个兑换码只能被一个用户兑换一次。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>兑换码类型</Label>
              <Select value={codeType} onValueChange={value => setCodeType(value as CodeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credits">积分兑换码</SelectItem>
                  <SelectItem value="membership">会员兑换码</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>生成数量</Label>
                <Input type="number" min={1} max={500} value={count} onChange={event => setCount(event.target.value)} />
              </div>
              {codeType === 'credits' ? (
                <div className="space-y-2">
                  <Label>每个兑换积分</Label>
                  <Input type="number" min={1} value={creditsAmount} onChange={event => setCreditsAmount(event.target.value)} />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>会员等级</Label>
                  <Select value={membershipTier} onValueChange={setMembershipTier}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pro">Pro 会员</SelectItem>
                      <SelectItem value="max">Max 会员</SelectItem>
                      <SelectItem value="ultra">Ultra 会员</SelectItem>
                      <SelectItem value="enterprise">企业会员</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {codeType === 'membership' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>会员时长</Label>
                  <Input type="number" min={1} value={membershipDurationValue} onChange={event => setMembershipDurationValue(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>时长单位</Label>
                  <Select value={membershipDurationUnit} onValueChange={value => setMembershipDurationUnit(value as 'day' | 'month' | 'year')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">天</SelectItem>
                      <SelectItem value="month">月</SelectItem>
                      <SelectItem value="year">年</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>备注</Label>
              <Input value={note} onChange={event => setNote(event.target.value)} placeholder={codeType === 'membership' ? '例如：5月 Pro 会员活动' : '例如：5月活动、内测用户补贴'} />
            </div>
            <Button className="w-full gap-2" onClick={handleGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
              {generating ? '生成中...' : '生成兑换码'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">本次生成</CardTitle>
                <CardDescription>生成后只在这里集中展示，关闭页面前可批量复制。</CardDescription>
              </div>
              {generatedCodes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => copyText(generatedCodes.map(code => code.code).join('\n'), '已复制本次生成的兑换码')}
                >
                  <Copy className="h-4 w-4" />
                  复制全部
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {generatedCodes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                暂无新生成兑换码
              </div>
            ) : (
              <Textarea
                readOnly
                value={generatedCodes.map(code => `${code.code}  ${getRedeemValueLabel(code)}`).join('\n')}
                className="min-h-40 font-mono text-sm"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg">兑换码列表</CardTitle>
              <CardDescription>查看兑换码状态、复制码值、停用未使用兑换码。</CardDescription>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
              <StatPill label="全部" value={stats.total} />
              <StatPill label="未使用" value={stats.unused} />
              <StatPill label="已使用" value={stats.used} />
              <StatPill label="已停用" value={stats.inactive} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="搜索兑换码、备注或兑换用户"
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={value => setStatus(value as StatusFilter)}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="unused">未使用</SelectItem>
                <SelectItem value="used">已使用</SelectItem>
                <SelectItem value="inactive">已停用</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
              <p>正在加载兑换码...</p>
            </div>
          ) : codes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              暂无兑换码
            </div>
          ) : (
            <div className="space-y-3">
              {codes.map(code => {
                const statusInfo = getCodeStatus(code);
                return (
                  <div key={code.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="rounded-md bg-muted px-2.5 py-1 font-mono text-sm font-semibold">{code.code}</code>
                          <Badge variant="outline" className={cn('gap-1', statusInfo.className)}>{statusInfo.label}</Badge>
                          <Badge variant="secondary" className="gap-1">
                            {code.codeType === 'membership' ? <Crown className="h-3 w-3" /> : <Coins className="h-3 w-3" />}
                            {getRedeemValueLabel(code)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>创建：{formatDateTime(code.createdAt)}</span>
                          {code.codeType === 'membership' && <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />会员码</span>}
                          {code.note && <span>备注：{code.note}</span>}
                          {code.usedAt && <span>兑换：{formatDateTime(code.usedAt)}</span>}
                          {code.usedByName || code.usedByEmail ? <span>用户：{code.usedByName || code.usedByEmail}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copyText(code.code)}>
                          <Copy className="h-4 w-4" />
                          复制
                        </Button>
                        {!code.usedAt && (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleToggleActive(code)}>
                            {code.isActive ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                            {code.isActive ? '停用' : '启用'}
                          </Button>
                        )}
                        {!code.usedAt && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => handleDelete(code)}>
                            <Trash2 className="h-4 w-4" />
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={mallDialogOpen} onOpenChange={setMallDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>商城链接配置</DialogTitle>
            <DialogDescription>
              配置后，用户在积分中心点击获取兑换码、在会员界面点击升级时，会跳转到这个链接。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="redeem-code-mall-url">商城链接</Label>
            <Input
              id="redeem-code-mall-url"
              value={mallUrl}
              onChange={event => setMallUrl(event.target.value)}
              placeholder="https://..."
            />
            <p className="text-xs text-muted-foreground">留空保存可关闭前端跳转入口。</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {siteConfig.redeemCodeMallUrl && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto gap-2"
                onClick={() => window.open(siteConfig.redeemCodeMallUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-4 w-4" />
                打开链接
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setMallDialogOpen(false)} disabled={savingMallUrl}>
              取消
            </Button>
            <Button type="button" onClick={handleSaveMallUrl} disabled={savingMallUrl}>
              {savingMallUrl && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
