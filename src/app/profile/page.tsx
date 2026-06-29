'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ManagedModelConfigResponse, ManagedModelRecommendation, ManagedModelType } from '@/lib/model-config-types';
import { useCustomApiKeys } from '@/lib/custom-api-store';
import { type CreationRecord, getCreationRecordCount, isPlaceholder } from '@/lib/creation-history-store';
import { readStoredAuth, useAuth } from '@/lib/auth-store';
import { useSiteConfig } from '@/lib/site-config';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { toast } from 'sonner';
import {
  User,
  CreditCard,
  Crown,
  Receipt,
  Image,
  Key,
  Coins,
  Calendar,
  Shield,
  TrendingUp,
  Gift,
  Zap,
  Settings,
  Globe,
  Cpu,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  Check,
  Loader2,
  Film,
  LogOut,
  LogIn,
  Sparkles,
  MessageSquare,
  ImageOff,
  Camera,
  MailCheck,
} from 'lucide-react';

const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function isEmail(value: string) {
  return EMAIL_REGEX.test(value.trim());
}

function sanitizeCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 10);
}

const ApiKeyManager = dynamic(() => import('@/components/profile/api-key-manager'), { ssr: false });
const CreationHistoryTab = dynamic(() => import('@/components/profile/creation-history-tab'), { ssr: false });
const CreditsTab = dynamic(() => import('@/components/profile/credits-tab'), { ssr: false });
const OrdersTab = dynamic(() => import('@/components/profile/orders-tab'), { ssr: false });
const membershipTiers = [
  { tier: 'free', name: '免费版', price: 0, dailyQuota: 5, features: ['每日5次创作', '标准画质', '社区展示'] },
  { tier: 'pro', name: 'Pro版', price: 29, dailyQuota: 50, features: ['每日50次创作', '高清画质', '私有存储', '批量下载'] },
  { tier: 'max', name: 'Max版', price: 99, dailyQuota: -1, features: ['无限创作', '4K超清', '自定义API', '批量处理', '优先队列'] },
  { tier: 'ultra', name: 'Ultra版', price: 499, dailyQuota: -1, features: ['团队协作', '专属额度', '品牌定制', '私有部署', '7x24支持'] },
];

const membershipRank: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 1,
  max: 2,
  enterprise: 3,
  ultra: 3,
};

function normalizeMembershipTier(tier?: string | null) {
  if (tier === 'basic') return 'pro';
  if (tier === 'enterprise') return 'ultra';
  return tier || 'free';
}

export default function ProfilePage() {
  const { isLoggedIn, user, accessToken, logout, isAdmin, isVip, refreshProfile, updateProfile } = useAuth();
  const { config: siteConfig } = useSiteConfig();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('account');
  const [mounted, setMounted] = useState(false);
  const [accountForm, setAccountForm] = useState({ username: '', nickname: '', email: '', phone: '', avatarUrl: '', watermarkDisabled: false });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingAccount, setSavingAccount] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [accountMessage, setAccountMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [emailVerifyCooldown, setEmailVerifyCooldown] = useState(0);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [creationRecordCount, setCreationRecordCount] = useState(0);
  const membershipEnabled = siteConfig.membershipEnabled !== false;

  const openRedeemCodeMall = () => {
    const mallUrl = siteConfig.redeemCodeMallUrl?.trim();
    if (!mallUrl) {
      toast.error('暂未配置会员升级链接');
      return;
    }
    window.open(mallUrl, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Refresh profile from server on mount to pick up admin changes
  useEffect(() => {
    if (isLoggedIn) {
      refreshProfile();
    }
  }, [isLoggedIn, refreshProfile]);

  useEffect(() => {
    if (!membershipEnabled && ['membership', 'credits', 'orders'].includes(activeTab)) {
      setActiveTab('account');
    }
  }, [membershipEnabled, activeTab]);

  useEffect(() => {
    if (!user) return;
    setAccountForm({
      username: user.username || user.email?.split('@')[0] || '',
      nickname: user.nickname || '',
      email: user.email || '',
      phone: user.phone || '',
      avatarUrl: user.avatarUrl || '',
      watermarkDisabled: user.watermarkDisabled === true,
    });
  }, [user?.id, user?.username, user?.nickname, user?.email, user?.phone, user?.avatarUrl, user?.watermarkDisabled]);

  useEffect(() => {
    if (emailVerifyCooldown <= 0) return;
    const timer = window.setInterval(() => setEmailVerifyCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [emailVerifyCooldown]);

  useEffect(() => {
    const updateCount = () => setCreationRecordCount(getCreationRecordCount());
    updateCount();
    window.addEventListener('creation-history-updated', updateCount);
    window.addEventListener('storage', updateCount);
    return () => {
      window.removeEventListener('creation-history-updated', updateCount);
      window.removeEventListener('storage', updateCount);
    };
  }, []);

  // Use auth store data directly
  const profile = {
    username: user?.username || user?.email?.split('@')[0] || '',
    nickname: user?.nickname || '游客',
    email: user?.email || '',
    phone: user?.phone || '',
    role: user?.role || 'user',
    membership_tier: user?.membershipTier || 'free',
    credits_balance: user?.creditsBalance ?? 0,
    daily_quota_used: user?.dailyQuotaUsed ?? 0,
    daily_quota_limit: user?.dailyQuotaLimit ?? 5,
    avatar_url: user?.avatarUrl || '',
    created_at: user?.createdAt || '',
    email_verified: user?.emailVerified === true,
    email_verified_at: user?.emailVerifiedAt || '',
    watermark_disabled: user?.watermarkDisabled === true,
  };

  const normalizedMembershipTier = normalizeMembershipTier(profile.membership_tier);
  const currentMembershipRank = membershipRank[normalizedMembershipTier] ?? 0;
  const tierInfo = membershipTiers.find(t => t.tier === normalizedMembershipTier) || membershipTiers[0];
  const canDisableWatermark = isAdmin || isVip || currentMembershipRank > 0;

  // Role display info
  const roleInfo: Record<string, { label: string; color: string }> = {
    admin: { label: '管理员', color: 'text-primary' },
    enterprise_admin: { label: '企业管理员', color: 'text-primary' },
    vip: { label: 'VIP', color: 'text-primary' },
    user: { label: '普通用户', color: 'text-muted-foreground' },
  };
  const currentRole = roleInfo[profile.role] || roleInfo.user;

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAccountMessage({ type: 'error', text: '请选择图片文件作为头像' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAccountMessage({ type: 'error', text: '头像图片不能超过 5MB' });
      return;
    }

    setProcessingAvatar(true);
    setAccountMessage(null);

    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image();
      image.onload = () => {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setProcessingAvatar(false);
          setAccountMessage({ type: 'error', text: '头像处理失败，请换一张图片' });
          return;
        }

        const side = Math.min(image.width, image.height);
        const sx = (image.width - side) / 2;
        const sy = (image.height - side) / 2;
        ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
        const avatarUrl = canvas.toDataURL('image/jpeg', 0.86);
        setAccountForm(prev => ({ ...prev, avatarUrl }));
        setProcessingAvatar(false);
      };
      image.onerror = () => {
        setProcessingAvatar(false);
        setAccountMessage({ type: 'error', text: '头像读取失败，请换一张图片' });
      };
      image.src = String(reader.result || '');
    };
    reader.onerror = () => {
      setProcessingAvatar(false);
      setAccountMessage({ type: 'error', text: '头像读取失败，请换一张图片' });
    };
    reader.readAsDataURL(file);
  };

  const handleAccountSave = async () => {
    const currentAuth = readStoredAuth();
    const authUser = user || currentAuth.user;
    const authToken = accessToken || currentAuth.accessToken;

    if (!authUser || !authToken) {
      setAccountMessage({ type: 'error', text: '请先登录后再修改资料' });
      return;
    }

    if (passwordForm.newPassword || passwordForm.confirmPassword || passwordForm.currentPassword) {
      if (passwordForm.newPassword.length < 6) {
        setAccountMessage({ type: 'error', text: '新密码至少需要 6 位' });
        return;
      }
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        setAccountMessage({ type: 'error', text: '两次输入的新密码不一致' });
        return;
      }
    }

    setSavingAccount(true);
    setAccountMessage(null);

    try {
      const payload: Record<string, string | boolean> = {
        username: accountForm.username,
        displayNickname: accountForm.nickname,
        email: accountForm.email,
        phone: accountForm.phone,
        avatarUrl: accountForm.avatarUrl,
      };
      if (canDisableWatermark) {
        payload.watermarkDisabled = accountForm.watermarkDisabled === true;
      }

      if (passwordForm.newPassword) {
        payload.currentPassword = passwordForm.currentPassword;
        payload.newPassword = passwordForm.newPassword;
      }

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '保存失败');
      }

      if (data.profile) {
        updateProfile({
          email: data.profile.email,
          username: data.profile.username || authUser.username,
          nickname: data.profile.nickname,
          phone: data.profile.phone || null,
          membershipTier: data.profile.membership_tier || authUser.membershipTier,
          creditsBalance: data.profile.credits_balance ?? authUser.creditsBalance,
          dailyQuotaUsed: data.profile.daily_quota_used ?? authUser.dailyQuotaUsed,
          dailyQuotaLimit: data.profile.daily_quota_limit ?? authUser.dailyQuotaLimit,
          avatarUrl: data.profile.avatar_url ?? authUser.avatarUrl,
          createdAt: data.profile.created_at ?? authUser.createdAt,
          emailVerified: data.profile.email_verified === true,
          emailVerifiedAt: data.profile.email_verified_at ?? null,
          watermarkDisabled: data.profile.watermark_disabled === true,
        });
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setAccountMessage({ type: 'success', text: '账号资料已保存' });
      refreshProfile();
    } catch (error) {
      setAccountMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败' });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSendProfileEmailCode = async () => {
    const authToken = accessToken || readStoredAuth().accessToken;
    if (!authToken) {
      setAccountMessage({ type: 'error', text: '请先登录后再验证邮箱' });
      return;
    }
    if (!isEmail(accountForm.email)) {
      setAccountMessage({ type: 'error', text: '请输入正确的邮箱地址' });
      return;
    }
    setSendingEmailCode(true);
    setAccountMessage(null);
    try {
      const response = await fetch('/api/email/send-profile-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ email: accountForm.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '验证码发送失败');
      setEmailVerifyCooldown(data.cooldown || 60);
      setShowEmailVerify(true);
      setAccountMessage({ type: 'success', text: data.message || '验证码已发送，请查收邮箱' });
    } catch (error) {
      setAccountMessage({ type: 'error', text: error instanceof Error ? error.message : '验证码发送失败' });
    } finally {
      setSendingEmailCode(false);
    }
  };

  const handleVerifyProfileEmail = async () => {
    const authToken = accessToken || readStoredAuth().accessToken;
    if (!authToken) return;
    if (!isEmail(accountForm.email) || !emailVerifyCode) {
      setAccountMessage({ type: 'error', text: '请填写邮箱和验证码' });
      return;
    }
    setVerifyingEmail(true);
    try {
      const response = await fetch('/api/email/verify-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ email: accountForm.email, code: emailVerifyCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '邮箱验证失败');
      if (data.profile) {
        updateProfile({
          email: data.profile.email,
          username: data.profile.username || user?.username || '',
          nickname: data.profile.nickname,
          phone: data.profile.phone || null,
          membershipTier: data.profile.membership_tier || user?.membershipTier || 'free',
          creditsBalance: data.profile.credits_balance ?? user?.creditsBalance ?? 0,
          dailyQuotaUsed: data.profile.daily_quota_used ?? user?.dailyQuotaUsed ?? 0,
          dailyQuotaLimit: data.profile.daily_quota_limit ?? user?.dailyQuotaLimit ?? 5,
          avatarUrl: data.profile.avatar_url ?? user?.avatarUrl ?? null,
          createdAt: data.profile.created_at ?? user?.createdAt ?? null,
          emailVerified: data.profile.email_verified === true,
          emailVerifiedAt: data.profile.email_verified_at ?? null,
          watermarkDisabled: data.profile.watermark_disabled === true,
        });
      }
      setShowEmailVerify(false);
      setEmailVerifyCode('');
      setAccountMessage({ type: 'success', text: data.message || '邮箱验证成功' });
      refreshProfile();
    } catch (error) {
      setAccountMessage({ type: 'error', text: error instanceof Error ? error.message : '邮箱验证失败' });
    } finally {
      setVerifyingEmail(false);
    }
  };

  // Not logged in (after hydration) - show login prompt
  if (mounted && !isLoggedIn) {
    return (
      <div className="profile-mobile-page min-h-screen bg-background flex items-center justify-center">
        <Card className="profile-mobile-card max-w-md w-full mx-4">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mx-auto mb-4">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="font-serif text-xl font-bold mb-2">尚未登录</h2>
            <p className="text-sm text-muted-foreground mb-6">登录后可以管理你的创作、积分和 API 密钥</p>
            <Button className="gap-2" onClick={() => router.push('/auth/login')}>
              <LogIn className="h-4 w-4" />
              立即登录
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Before hydration - render placeholder to avoid SSR/client mismatch
  if (!mounted) {
    return (
      <div className="profile-mobile-page min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <div className="mb-8">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
              <div className="space-y-2">
                <div className="h-6 w-24 rounded bg-muted animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-mobile-page min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Profile Header */}
        <div className="profile-mobile-hero mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary text-2xl font-serif font-bold ring-1 ring-primary/20">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.nickname} className="h-full w-full object-cover" />
                ) : (
                  profile.nickname[0]
                )}
              </div>
              <div>
                <h1 className="font-serif text-2xl font-bold">{profile.nickname}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="gap-1">
                    {profile.role === 'admin' && <Shield className="h-3 w-3" />}
                    {currentRole.label}
                  </Badge>
                  {membershipEnabled && <Badge variant="outline">{tierInfo.name}</Badge>}
                  <Badge variant={profile.email_verified ? 'secondary' : 'outline'} className={profile.email_verified ? 'text-emerald-500' : 'text-amber-500'}>
                    {profile.email_verified ? '邮箱已验证' : '邮箱未验证'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{profile.email}</span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              退出
            </Button>
          </div>

          {/* Quick Stats */}
          <div className="profile-mobile-stats grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {membershipEnabled && (
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Coins className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{profile.credits_balance}</p>
                    <p className="text-xs text-muted-foreground">剩余积分</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {membershipEnabled && (
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{profile.daily_quota_used}/{profile.daily_quota_limit}</p>
                    <p className="text-xs text-muted-foreground">今日额度</p>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Film className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{creationRecordCount}</p>
                  <p className="text-xs text-muted-foreground">创作记录</p>
                </div>
              </CardContent>
            </Card>
            {membershipEnabled && (
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{tierInfo.name}</p>
                    <p className="text-xs text-muted-foreground">当前会员</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`profile-mobile-tabs grid w-full grid-cols-3 ${membershipEnabled ? 'sm:grid-cols-6' : 'sm:grid-cols-3'} max-w-3xl`}>
            <TabsTrigger value="account" className="gap-1.5"><User className="h-4 w-4" /><span>账户</span></TabsTrigger>
            {membershipEnabled && <TabsTrigger value="membership" className="gap-1.5"><Crown className="h-4 w-4" /><span>会员</span></TabsTrigger>}
            {membershipEnabled && <TabsTrigger value="credits" className="gap-1.5"><Coins className="h-4 w-4" /><span>积分</span></TabsTrigger>}
            {membershipEnabled && <TabsTrigger value="orders" className="gap-1.5"><Receipt className="h-4 w-4" /><span>订单</span></TabsTrigger>}
            <TabsTrigger value="history" className="gap-1.5"><Image className="h-4 w-4" /><span>历史</span></TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5"><Key className="h-4 w-4" /><span>API</span></TabsTrigger>
          </TabsList>

          {/* Account Tab */}
          <TabsContent value="account" className="mt-6">
            <Card className="profile-mobile-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />账户信息</CardTitle>
                <CardDescription>管理你的账户基本信息</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {accountMessage && (
                  <div className={`rounded-md border px-3 py-2 text-sm ${
                    accountMessage.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-destructive/30 bg-destructive/10 text-destructive'
                  }`}>
                    {accountMessage.text}
                  </div>
                )}

                <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4 sm:flex-row sm:items-center">
                  <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-3xl font-serif font-bold text-primary ring-1 ring-primary/25">
                    {accountForm.avatarUrl ? (
                      <img src={accountForm.avatarUrl} alt="头像预览" className="h-full w-full object-cover" />
                    ) : (
                      (accountForm.nickname || profile.nickname || '用').slice(0, 1).toUpperCase()
                    )}
                    {processingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label>自定义头像</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="gap-2" asChild disabled={processingAvatar}>
                        <label className="cursor-pointer">
                          <Camera className="h-4 w-4" />
                          上传头像
                          <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                        </label>
                      </Button>
                      {accountForm.avatarUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setAccountForm(prev => ({ ...prev, avatarUrl: '' }))}
                          disabled={processingAvatar}
                        >
                          移除头像
                        </Button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">支持 JPG、PNG、WebP，系统会自动裁剪为方形头像。</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input
                      value={accountForm.username}
                      onChange={(event) => setAccountForm(prev => ({ ...prev, username: event.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">用户名可继续用于登录，不会在画廊公开显示。</p>
                  </div>
                  <div className="space-y-2">
                    <Label>昵称</Label>
                    <Input
                      value={accountForm.nickname}
                      onChange={(event) => setAccountForm(prev => ({ ...prev, nickname: event.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">昵称用于右上角、个人资料和画廊作者展示。</p>
                  </div>
                  <div className="space-y-2">
                    <Label>邮箱</Label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        value={accountForm.email}
                        onChange={(event) => setAccountForm(prev => ({ ...prev, email: event.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 gap-2"
                        onClick={handleSendProfileEmailCode}
                        disabled={sendingEmailCode || emailVerifyCooldown > 0 || !isEmail(accountForm.email)}
                      >
                        {sendingEmailCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
                        {emailVerifyCooldown > 0 ? `${emailVerifyCooldown}s` : profile.email_verified && accountForm.email === profile.email ? '重新验证' : '验证邮箱'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {profile.email_verified && accountForm.email === profile.email ? '该邮箱已验证，可用于找回密码。' : '邮箱验证后可用于找回密码和安全通知。'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>手机号</Label>
                    <Input
                      value={accountForm.phone}
                      onChange={(event) => setAccountForm(prev => ({ ...prev, phone: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>注册时间</Label>
                    <Input value={profile.created_at} disabled />
                  </div>
                </div>

                <Separator />

                <div className="rounded-xl border border-border bg-card/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">下载无水印</Label>
                      <p className="text-sm text-muted-foreground">
                        {canDisableWatermark ? '关闭后，下载导出的图片和视频将保留原文件。' : '升级会员后可关闭下载水印。'}
                      </p>
                    </div>
                    <Switch
                      checked={accountForm.watermarkDisabled}
                      disabled={!canDisableWatermark}
                      onCheckedChange={(checked) => setAccountForm(prev => ({ ...prev, watermarkDisabled: checked }))}
                      aria-label="下载无水印"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-3 flex items-center gap-2"><Shield className="h-4 w-4" />安全设置</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>当前密码</Label>
                      <Input
                        type="password"
                        value={passwordForm.currentPassword}
                        onChange={(event) => setPasswordForm(prev => ({ ...prev, currentPassword: event.target.value }))}
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>新密码</Label>
                      <Input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) => setPasswordForm(prev => ({ ...prev, newPassword: event.target.value }))}
                        autoComplete="new-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>确认新密码</Label>
                      <Input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) => setPasswordForm(prev => ({ ...prev, confirmPassword: event.target.value }))}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleAccountSave} disabled={savingAccount}>
                    {savingAccount && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    保存修改
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Membership Tab */}
          {membershipEnabled && <TabsContent value="membership" className="mt-6">
            <div className="space-y-6">
              <Card className="profile-mobile-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Crown className="h-5 w-5" />会员订阅</CardTitle>
                  <CardDescription>升级会员享受更多创作权益</CardDescription>
                </CardHeader>
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {membershipTiers.map((tier) => {
                  const tierRank = membershipRank[tier.tier] ?? 0;
                  const isCurrentTier = tier.tier === normalizedMembershipTier;
                  const isUnavailableTier = tierRank <= currentMembershipRank;
                  return (
                  <Card key={tier.tier} className={`profile-mobile-card flex flex-col ${isCurrentTier ? 'border-primary' : ''} ${isUnavailableTier && !isCurrentTier ? 'opacity-55' : ''}`}>
                    <CardContent className="p-6 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-serif font-semibold">{tier.name}</h3>
                        {isCurrentTier && (
                          <Badge>当前</Badge>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1 mb-4">
                        <span className="text-3xl font-bold">¥{tier.price}</span>
                        <span className="text-sm text-muted-foreground">/月</span>
                      </div>
                      <ul className="space-y-2 mb-6 flex-1">
                        {tier.features.map((f) => (
                          <li key={f} className="flex items-center gap-2 text-sm">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <Button
                        className="w-full shrink-0"
                        variant={isUnavailableTier ? 'outline' : 'default'}
                        disabled={isUnavailableTier}
                        onClick={!isUnavailableTier ? openRedeemCodeMall : undefined}
                      >
                        {isCurrentTier ? '当前方案' : isUnavailableTier ? '不可降级' : '升级'}
                      </Button>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </div>
          </TabsContent>}

          {/* Credits Tab */}
          {membershipEnabled && <TabsContent value="credits" className="mt-6">
            <CreditsTab creditsBalance={profile.credits_balance} />
          </TabsContent>}

          {/* Orders Tab */}
          {membershipEnabled && <TabsContent value="orders" className="mt-6">
            <OrdersTab />
          </TabsContent>}

          {/* Works Tab */}
          <TabsContent value="history" className="mt-6">
            <CreationHistoryTab />
          </TabsContent>

          {/* API Tab */}
          <TabsContent value="api" className="mt-6">
            <ApiKeyManager />
          </TabsContent>
        </Tabs>
        <Dialog open={showEmailVerify} onOpenChange={setShowEmailVerify}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>验证邮箱</DialogTitle>
              <DialogDescription>验证码已发送至 {accountForm.email}，请在有效期内完成验证。</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>邮箱验证码</Label>
              <Input
                placeholder="输入邮箱验证码"
                value={emailVerifyCode}
                onChange={(event) => setEmailVerifyCode(sanitizeCode(event.target.value))}
                className="uppercase"
                maxLength={10}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowEmailVerify(false)}>取消</Button>
              <Button onClick={handleVerifyProfileEmail} disabled={verifyingEmail}>
                {verifyingEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                完成验证
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
