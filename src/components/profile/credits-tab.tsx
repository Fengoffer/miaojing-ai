'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Coins, Copy, CreditCard, Crown, ExternalLink, Gift, Loader2, Ticket, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-store';
import { formatRecordTime, useCreditRecords } from '@/lib/credit-records-store';
import { useSiteConfig } from '@/lib/site-config';

type CreditRecord = {
  id: string;
  amount: number;
  description: string;
  createdAt: string;
  balanceAfter: number;
};

type CreditsTabProps = {
  creditsBalance: number;
};

type InvitationReferral = {
  id: string;
  inviteeEmail?: string;
  inviteeNickname?: string;
  inviteeBonusCredits: number;
  createdAt: string;
};

const membershipTierLabels: Record<string, string> = {
  pro: 'Pro 会员',
  max: 'Max 会员',
  ultra: 'Ultra 会员',
  enterprise: '企业会员',
};

export default function CreditsTab({ creditsBalance }: CreditsTabProps) {
  const { accessToken, refreshProfile, updateProfile } = useAuth();
  const { config: siteConfig } = useSiteConfig();
  const { records: creditRecords } = useCreditRecords();
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [serverRecords, setServerRecords] = useState<CreditRecord[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [referrals, setReferrals] = useState<InvitationReferral[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [balance, setBalance] = useState(creditsBalance);

  useEffect(() => {
    setBalance(creditsBalance);
  }, [creditsBalance]);

  const loadServerRecords = useCallback(async () => {
    if (!accessToken) return;
    setLoadingRecords(true);
    try {
      const res = await fetch('/api/credit-transactions?limit=100', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '积分记录加载失败');
      if (Array.isArray(data.records)) setServerRecords(data.records);
    } catch {
      // Keep local records as a fallback.
    } finally {
      setLoadingRecords(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadServerRecords();
  }, [loadServerRecords]);

  const displayRecords = useMemo(() => (
    serverRecords.length > 0 ? serverRecords : creditRecords
  ), [creditRecords, serverRecords]);

  const inviteLink = useMemo(() => {
    if (!inviteCode || typeof window === 'undefined') return '';
    return `${window.location.origin}/auth/register?invite=${encodeURIComponent(inviteCode)}`;
  }, [inviteCode]);

  const loadInvitationInfo = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch('/api/invitations/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '邀请信息加载失败');
      setInviteCode(String(data.inviteCode || ''));
      setReferrals(Array.isArray(data.referrals) ? data.referrals : []);
    } catch {
      // Invitation panel can stay empty when the server is unavailable.
    }
  }, [accessToken]);

  useEffect(() => {
    loadInvitationInfo();
  }, [loadInvitationInfo]);

  const copyInviteLink = async () => {
    if (!inviteLink) {
      toast.error('邀请链接还未生成');
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('邀请链接已复制');
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const openRedeemCodeMall = () => {
    const mallUrl = siteConfig.redeemCodeMallUrl?.trim();
    if (!mallUrl) {
      toast.error('暂未配置兑换码获取链接');
      return;
    }
    window.open(mallUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRedeem = async () => {
    const code = redeemCode.trim();
    if (!code) {
      toast.error('请输入兑换码');
      return;
    }
    if (!accessToken) {
      toast.error('请先登录后再兑换');
      return;
    }

    setRedeeming(true);
    try {
      const res = await fetch('/api/redeem-codes/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '兑换失败');
      const nextBalance = Number(data.creditsBalance ?? balance);
      setBalance(nextBalance);
      if (data.codeType === 'membership' && typeof data.membershipTier === 'string') {
        updateProfile({
          creditsBalance: nextBalance,
          membershipTier: data.membershipTier,
          role: 'vip',
        });
      } else {
        updateProfile({ creditsBalance: nextBalance });
      }
      setRedeemCode('');
      if (data.codeType === 'membership') {
        const expiresText = data.membershipExpiresAt
          ? `，有效期至 ${new Date(data.membershipExpiresAt).toLocaleDateString('zh-CN')}`
          : '';
        toast.success(`兑换成功，已开通 ${membershipTierLabels[data.membershipTier] || '会员'}${expiresText}`);
      } else {
        toast.success(`兑换成功，已到账 ${Number(data.creditsAmount || 0)} 积分`);
      }
      await loadServerRecords();
      await refreshProfile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '兑换失败');
    } finally {
      setRedeeming(false);
    }
  };

  return (
<div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" />积分中心</CardTitle>
                  <CardDescription>管理你的积分余额与充值</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 rounded-lg bg-primary/5 mb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">当前余额</p>
                      <p className="text-3xl font-bold text-primary">{balance} <span className="text-sm font-normal">积分</span></p>
                    </div>
                    <Button className="gap-2" onClick={openRedeemCodeMall}><CreditCard className="h-4 w-4" />充值积分</Button>
                  </div>

                  <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-emerald-500" />
                        <div>
                          <p className="text-sm font-medium">邀请获取积分</p>
                          <p className="text-xs text-muted-foreground">新用户通过你的专属链接注册后，你和对方各获得50积分。</p>
                        </div>
                      </div>
                      <Badge variant="secondary">已邀请 {referrals.length} 人</Badge>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={inviteLink || '正在生成邀请链接...'} readOnly />
                      <Button className="gap-2" onClick={copyInviteLink} disabled={!inviteLink}>
                        <Copy className="h-4 w-4" />复制链接
                      </Button>
                    </div>
                    {referrals.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                        {referrals.slice(0, 5).map(referral => (
                          <div key={referral.id} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{referral.inviteeNickname || referral.inviteeEmail || '新用户'}</span>
                            <span>{formatRecordTime(referral.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <Ticket className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">兑换码兑换</p>
                          <p className="text-xs text-muted-foreground">输入管理员发放的兑换码，可兑换积分或会员权益。</p>
                        </div>
                      </div>
                      <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={openRedeemCodeMall}>
                        <ExternalLink className="h-4 w-4" />
                        获取兑换码
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1 space-y-1">
                        <Label className="sr-only">兑换码</Label>
                        <Input
                          value={redeemCode}
                          onChange={event => setRedeemCode(event.target.value.toUpperCase())}
                          onKeyDown={event => {
                            if (event.key === 'Enter') handleRedeem();
                          }}
                          placeholder="输入兑换码，例如 MJ-ABCD-EFGH-IJKL"
                          disabled={redeeming}
                        />
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:w-36">
                        <Button className="gap-2" onClick={handleRedeem} disabled={redeeming || !redeemCode.trim()}>
                          {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                          {redeeming ? '兑换中...' : '立即兑换'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {[
                      { amount: 50, price: 9.9, bonus: 5 },
                      { amount: 200, price: 29.9, bonus: 30 },
                      { amount: 500, price: 59.9, bonus: 100 },
                    ].map((pkg) => (
                      <Card key={pkg.amount} className="cursor-pointer hover:border-primary/50 transition-colors">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold">{pkg.amount}</p>
                          <p className="text-xs text-muted-foreground">积分</p>
                          <p className="text-sm font-semibold text-primary mt-2">¥{pkg.price}</p>
                          <Badge variant="secondary" className="mt-1">送{pkg.bonus}积分</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">积分记录</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {loadingRecords ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-60" />
                        <p className="text-sm">正在读取积分记录</p>
                      </div>
                    ) : displayRecords.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">暂无积分记录</p>
                      </div>
                    ) : displayRecords.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${tx.amount > 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                            {tx.amount > 0 ? <Gift className="h-4 w-4 text-emerald-500" /> : <TrendingUp className="h-4 w-4 text-rose-500" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{tx.description}</p>
                            <p className="text-xs text-muted-foreground">{formatRecordTime(tx.createdAt)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`font-semibold ${tx.amount > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {tx.amount > 0 ? '+' : ''}{tx.amount}
                          </span>
                          <p className="text-xs text-muted-foreground">余额 {tx.balanceAfter}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
  );
}
