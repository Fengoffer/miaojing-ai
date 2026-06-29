'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminConfig, type ManagedUser } from '@/lib/admin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Coins, Edit3, KeyRound, Loader2, Plus, Save, Search, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-store';

// ============================================================
// Tab 2: User Management
// ============================================================

export default function UserManagementTab() {
  const { config, addUser, updateUser, removeUser, adjustUserCredits, setUserCredits } = useAdminConfig();
  const { accessToken } = useAuth();
  const [activeView, setActiveView] = useState<'users' | 'invitations'>('users');
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [rechargeUser, setRechargeUser] = useState<ManagedUser | null>(null);
  const [realUsers, setRealUsers] = useState<Array<{
    id: string; email: string; nickname: string; role: string;
    membership_tier: string; credits_balance: number;
    daily_quota_limit: number; daily_quota_used: number;
    is_active: boolean;
    watermark_disabled: boolean;
    status: string; created_at: string; phone?: string | null;
    invite_code?: string | null; referred_by_user_id?: string | null;
    referred_by_email?: string | null; referred_by_nickname?: string | null;
    invited_count?: number;
  }>>([]);
  const [invitationRecords, setInvitationRecords] = useState<Array<{
    id: string;
    inviteCode: string;
    inviterEmail?: string;
    inviterNickname?: string;
    inviteeEmail?: string;
    inviteeNickname?: string;
    inviterBonusCredits: number;
    inviteeBonusCredits: number;
    createdAt: string;
  }>>([]);
  const [loadingRealUsers, setLoadingRealUsers] = useState(true);
  const [useRealData, setUseRealData] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(20);
  const [realUsersTotal, setRealUsersTotal] = useState(0);
  const [realUsersTotalPages, setRealUsersTotalPages] = useState(1);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [invitationSearchQuery, setInvitationSearchQuery] = useState('');
  const [invitationPage, setInvitationPage] = useState(1);
  const [invitationPageSize, setInvitationPageSize] = useState(20);
  const [invitationTotal, setInvitationTotal] = useState(0);
  const [invitationTotalPages, setInvitationTotalPages] = useState(1);

  // Fetch real users from the server with pagination/search.
  const fetchRealUsers = useCallback(async () => {
    setLoadingRealUsers(true);
    try {
      const params = new URLSearchParams({
        page: String(userPage),
        pageSize: String(userPageSize),
      });
      if (userSearchQuery.trim()) {
        params.set('search', userSearchQuery.trim());
      }
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setRealUsers(data.users);
          setRealUsersTotal(Number(data.total || data.users.length || 0));
          setRealUsersTotalPages(Math.max(1, Number(data.totalPages || 1)));
          setUseRealData(true);
        }
      }
    } catch { /* ignore */ }
    setLoadingRealUsers(false);
  }, [accessToken, userPage, userPageSize, userSearchQuery]);

  const fetchInvitationRecords = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      const params = new URLSearchParams({
        page: String(invitationPage),
        pageSize: String(invitationPageSize),
      });
      if (invitationSearchQuery.trim()) params.set('search', invitationSearchQuery.trim());
      const res = await fetch(`/api/admin/invitations?${params.toString()}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.referrals)) {
        setInvitationRecords(data.referrals);
        setInvitationTotal(Number(data.total || data.referrals.length || 0));
        setInvitationTotalPages(Math.max(1, Number(data.totalPages || 1)));
      }
    } catch {
      // Keep the user list usable even if invitation stats fail.
    } finally {
      setLoadingInvitations(false);
    }
  }, [accessToken, invitationPage, invitationPageSize, invitationSearchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchRealUsers();
    }, userSearchQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchRealUsers, userSearchQuery]);

  useEffect(() => {
    if (activeView !== 'invitations') return;
    const timer = window.setTimeout(() => {
      fetchInvitationRecords();
    }, invitationSearchQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [activeView, fetchInvitationRecords, invitationSearchQuery]);

  // Merge: real Supabase users take priority, then admin-store users
  const displayUsers: ManagedUser[] = useRealData
    ? realUsers.map(u => ({
        id: u.id,
        email: u.email || '',
        nickname: u.nickname || u.email?.split('@')[0] || '用户',
        role: (u.role || 'user') as ManagedUser['role'],
        membershipTier: (u.membership_tier || 'free') as ManagedUser['membershipTier'],
        creditsBalance: u.credits_balance ?? 0,
        dailyQuotaLimit: u.daily_quota_limit ?? 5,
        dailyQuotaUsed: u.daily_quota_used ?? 0,
        watermarkDisabled: u.watermark_disabled === true,
        status: u.is_active === false ? 'suspended' as const : 'active' as const,
        createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '',
      }))
    : config.users;

  const filteredDisplayUsers = displayUsers.filter(user => {
    if (useRealData) return true;
    const query = userSearchQuery.trim().toLowerCase();
    if (!query) return true;
    const realUser = realUsers.find(item => item.id === user.id);
    return [
      user.id,
      user.email,
      user.nickname,
      user.role,
      user.membershipTier,
      user.status,
      realUser?.phone || '',
    ].some(value => String(value || '').toLowerCase().includes(query));
  });

  const membershipPlans = config.membershipPlans.filter(plan => ['free', 'pro', 'max', 'ultra'].includes(plan.tier));

  const applyRealUserPatch = useCallback((userId: string, updates: Partial<{
    role: string;
    membership_tier: string;
    credits_balance: number;
    daily_quota_limit: number;
    daily_quota_used: number;
    watermark_disabled: boolean;
    is_active: boolean;
    nickname: string;
    email: string;
    phone: string | null;
  }>) => {
    setRealUsers(prev => prev.map(user => user.id === userId ? { ...user, ...updates } : user));
  }, []);

  // Add form
  const [addEmail, setAddEmail] = useState('');
  const [addNickname, setAddNickname] = useState('');
  const [addRole, setAddRole] = useState<ManagedUser['role']>('user');
  const [addTier, setAddTier] = useState<ManagedUser['membershipTier']>('free');
  const [addCredits, setAddCredits] = useState('10');
  const [addQuota, setAddQuota] = useState('5');

  // Edit form
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<ManagedUser['role']>('user');
  const [editTier, setEditTier] = useState<ManagedUser['membershipTier']>('free');
  const [editCredits, setEditCredits] = useState('0');
  const [editQuota, setEditQuota] = useState('5');
  const [editStatus, setEditStatus] = useState<ManagedUser['status']>('active');
  const [editWatermarkDisabled, setEditWatermarkDisabled] = useState(false);

  // Reset password
  const [resetPwUser, setResetPwUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetPwLoading, setResetPwLoading] = useState(false);

  // Recharge form
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeReason, setRechargeReason] = useState('管理员手动充值');
  const [rechargeMode, setRechargeMode] = useState<'add' | 'set'>('add');

  const handleAddUser = () => {
    if (!addEmail) { toast.error('请填写邮箱'); return; }
    addUser({
      email: addEmail,
      nickname: addNickname || addEmail.split('@')[0],
      role: addRole,
      membershipTier: addTier,
      creditsBalance: Number(addCredits) || 0,
      dailyQuotaLimit: Number(addQuota) || 5,
      status: 'active',
    });
    setAddEmail(''); setAddNickname(''); setAddRole('user'); setAddTier('free'); setAddCredits('10'); setAddQuota('5');
    setShowAddForm(false);
    toast.success('用户已添加');
  };

  const startEdit = (user: ManagedUser) => {
    setEditingUser(user);
    setResetPwUser(null);
    setRechargeUser(null);
    setShowAddForm(false);
    setEditRole(user.role); setEditTier(user.membershipTier);
    setEditEmail(user.email || '');
    setEditCredits(String(user.creditsBalance)); setEditQuota(String(user.dailyQuotaLimit));
    setEditStatus(user.status);
    setEditWatermarkDisabled(user.watermarkDisabled === true);
  };

  const startResetPassword = (user: ManagedUser) => {
    setResetPwUser(user);
    setNewPassword('');
    setEditingUser(null);
    setRechargeUser(null);
    setShowAddForm(false);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    // Save to localStorage (admin-store)
    updateUser(editingUser.id, {
      role: editRole,
      membershipTier: editTier,
      creditsBalance: Number(editCredits) || 0,
      dailyQuotaLimit: Number(editQuota) || 5,
      watermarkDisabled: editWatermarkDisabled,
      status: editStatus,
    });
    // Also save to Supabase if using real data
    if (useRealData) {
      try {
        const res = await fetch('/api/admin/users', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            userId: editingUser.id,
            email: editEmail || undefined,
            role: editRole,
            membershipTier: editTier,
            creditsBalance: Number(editCredits) || 0,
            dailyQuotaLimit: Number(editQuota) || 5,
            watermarkDisabled: editWatermarkDisabled,
            status: editStatus,
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.user) {
            applyRealUserPatch(editingUser.id, data.user);
          }
          await fetchRealUsers();
        } else {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '更新失败');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '更新失败');
        return;
      }
    }
    setEditingUser(null);
    toast.success('用户信息已更新');
  };

  const startRecharge = (user: ManagedUser) => {
    setRechargeUser(user);
    setRechargeAmount('');
    setRechargeReason('管理员手动充值');
    setRechargeMode('add');
    setEditingUser(null);
    setResetPwUser(null);
    setShowAddForm(false);
  };

  const handleRecharge = async () => {
    if (!rechargeUser) return;
    const amount = Number(rechargeAmount);
    if (!amount || amount <= 0) { toast.error('请输入有效的积分数量'); return; }
    if (rechargeMode === 'add') {
      adjustUserCredits({
        userId: rechargeUser.id,
        type: 'topup',
        amount,
        reason: rechargeReason || '管理员手动充值',
      });
      // Also update Supabase
      if (useRealData) {
        try {
          const res = await fetch('/api/admin/users', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              userId: rechargeUser.id,
              creditsBalance: (rechargeUser.creditsBalance || 0) + amount,
            }),
          });
          if (res.ok) await fetchRealUsers();
        } catch { /* non-critical */ }
      }
      toast.success(`已为 ${rechargeUser.nickname} 充值 ${amount} 积分`);
    } else {
      setUserCredits({
        userId: rechargeUser.id,
        balance: amount,
        reason: rechargeReason || '管理员设置积分',
      });
      // Also update Supabase
      if (useRealData) {
        try {
          const res = await fetch('/api/admin/users', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              userId: rechargeUser.id,
              creditsBalance: amount,
            }),
          });
          if (res.ok) await fetchRealUsers();
        } catch { /* non-critical */ }
      }
      toast.success(`已将 ${rechargeUser.nickname} 的积分设置为 ${amount}`);
    }
    setRechargeUser(null);
  };

  const handleQuickRecharge = async (user: ManagedUser, amount: number) => {
    adjustUserCredits({
      userId: user.id,
      type: 'topup',
      amount,
      reason: '管理员快捷充值',
    });
    // Also update Supabase
    if (useRealData) {
      try {
        const res = await fetch('/api/admin/users', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            userId: user.id,
            creditsBalance: (user.creditsBalance || 0) + amount,
          }),
        });
        if (res.ok) await fetchRealUsers();
      } catch { /* non-critical */ }
    }
    toast.success(`已为 ${user.nickname} 充值 ${amount} 积分`);
  };

  const handleTierChange = async (user: ManagedUser, tier: ManagedUser['membershipTier']) => {
    const plan = membershipPlans.find(p => p.tier === tier);
    const nextQuota = plan?.dailyQuota ?? user.dailyQuotaLimit;
    const nextCredits = Math.max(user.creditsBalance || 0, plan?.credits ?? (user.creditsBalance || 0));
    const nextRole = user.role === 'admin' || user.role === 'enterprise_admin'
      ? user.role
      : tier === 'free' ? 'user' : 'vip';
    updateUser(user.id, {
      role: nextRole,
      membershipTier: tier,
      dailyQuotaLimit: nextQuota,
      creditsBalance: nextCredits,
    });
    // Also update Supabase
    if (useRealData) {
      applyRealUserPatch(user.id, {
        role: nextRole,
        membership_tier: tier,
        daily_quota_limit: nextQuota,
        credits_balance: nextCredits,
      });
      try {
        const res = await fetch('/api/admin/users', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            userId: user.id,
            membershipTier: tier,
            dailyQuotaLimit: nextQuota,
            creditsBalance: nextCredits,
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.user) applyRealUserPatch(user.id, data.user);
          await fetchRealUsers();
        } else {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '调整失败');
        }
      } catch (err) {
        await fetchRealUsers();
        toast.error(err instanceof Error ? err.message : '调整失败');
        return;
      }
    }
    toast.success(`已将 ${user.nickname} 的会员等级调整为 ${plan?.name ?? tier}`);
  };

  const handleResetPassword = async () => {
    if (!resetPwUser || !newPassword) {
      toast.error('请输入新密码');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('密码至少6位');
      return;
    }
    setResetPwLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: resetPwUser.id,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重置失败');
      toast.success(`已重置 ${resetPwUser.nickname} 的密码`);
      setResetPwUser(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setResetPwLoading(false);
    }
  };

  const handleDeleteUser = async (user: ManagedUser) => {
    if (user.role === 'admin') {
      toast.error('管理员账号不可在这里删除');
      return;
    }
    const confirmed = window.confirm(`确认完整删除用户「${user.nickname || user.email}」？该操作会删除账号、作品、API 配置、订单、任务等关联数据，无法恢复。`);
    if (!confirmed) return;

    if (useRealData) {
      try {
        const res = await fetch('/api/admin/users', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ userId: user.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '删除失败');
        setRealUsers(prev => prev.filter(item => item.id !== user.id));
        setRealUsersTotal(prev => Math.max(0, prev - 1));
        await fetchRealUsers();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除失败');
        return;
      }
    } else {
      removeUser(user.id);
    }
    toast.success('用户已从数据库删除');
  };

  const roleLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
    admin: { label: '管理员', variant: 'default' },
    enterprise_admin: { label: '企业管理员', variant: 'default' },
    vip: { label: 'VIP', variant: 'secondary' },
    user: { label: '普通', variant: 'outline' },
  };

  const tierLabels: Record<string, string> = { free: '免费版', basic: 'Pro版', pro: 'Pro版', max: 'Max版', enterprise: 'Ultra版', ultra: 'Ultra版' };
  const totalDisplayUserCount = useRealData ? realUsersTotal : displayUsers.length;
  const totalDisplayUserPages = useRealData ? realUsersTotalPages : 1;

  const statusLabels: Record<string, { label: string; color: string }> = {
    active: { label: '正常', color: 'text-primary' },
    suspended: { label: '暂停', color: 'text-yellow-500' },
    banned: { label: '封禁', color: 'text-destructive' },
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg">{activeView === 'users' ? '用户管理' : '邀请注册记录'}</CardTitle>
              <CardDescription>
                {activeView === 'users'
                  ? '查看、编辑用户角色与权限资源'
                  : '长期查询邀请人、被邀请人和奖励发放记录'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg border border-border bg-muted/20 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={activeView === 'users' ? 'default' : 'ghost'}
                  onClick={() => setActiveView('users')}
                >
                  用户列表
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={activeView === 'invitations' ? 'default' : 'ghost'}
                  className="gap-1.5"
                  onClick={() => setActiveView('invitations')}
                >
                  <Users className="h-4 w-4" />邀请注册记录
                </Button>
              </div>
              {activeView === 'users' && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setShowAddForm(true);
                    setEditingUser(null);
                    setResetPwUser(null);
                    setRechargeUser(null);
                  }}
                >
                  <Plus className="h-4 w-4" />添加用户
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeView === 'invitations' ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={invitationSearchQuery}
                    onChange={e => { setInvitationSearchQuery(e.target.value); setInvitationPage(1); }}
                    placeholder="搜索邀请人、被邀请人、邀请码"
                    className="pl-9"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  共 {invitationTotal} 条邀请记录
                </div>
              </div>

              {loadingInvitations ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
                  <p>加载邀请记录...</p>
                </div>
              ) : invitationRecords.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                  暂无邀请注册记录
                </div>
              ) : (
                <div className="space-y-2">
                  {invitationRecords.map(record => (
                    <div key={record.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline">邀请码 {record.inviteCode}</Badge>
                            <span className="font-medium">{record.inviterNickname || record.inviterEmail || '邀请人'}</span>
                            <span className="text-muted-foreground">邀请了</span>
                            <span className="font-medium">{record.inviteeNickname || record.inviteeEmail || '被邀请人'}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>邀请人：{record.inviterEmail || '无邮箱'}</span>
                            <span>被邀请人：{record.inviteeEmail || '无邮箱'}</span>
                            <span>{record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN') : ''}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Badge variant="secondary">邀请人 +{record.inviterBonusCredits || 50}</Badge>
                          <Badge variant="secondary">被邀请人 +{record.inviteeBonusCredits || 50}</Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>第 {invitationPage} / {invitationTotalPages} 页</span>
                  <Select
                    value={String(invitationPageSize)}
                    onValueChange={value => {
                      setInvitationPageSize(Number(value));
                      setInvitationPage(1);
                    }}
                  >
                    <SelectTrigger className="h-11 w-[112px] px-4 text-base leading-none [&_[data-slot=select-value]]:leading-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent side="top" align="start" sideOffset={8}>
                      <SelectItem value="20">20/页</SelectItem>
                      <SelectItem value="50">50/页</SelectItem>
                      <SelectItem value="100">100/页</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={invitationPage <= 1 || loadingInvitations}
                    onClick={() => setInvitationPage(page => Math.max(1, page - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={invitationPage >= invitationTotalPages || loadingInvitations}
                    onClick={() => setInvitationPage(page => Math.min(invitationTotalPages, page + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          ) : loadingRealUsers ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
                <p>加载用户数据...</p>
              </div>
            ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={userSearchQuery}
                  onChange={e => { setUserSearchQuery(e.target.value); setUserPage(1); }}
                  placeholder="搜索昵称、邮箱、手机号、用户ID"
                  className="pl-9"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                共 {totalDisplayUserCount} 个用户，当前显示 {filteredDisplayUsers.length} 个
              </div>
            </div>

            {filteredDisplayUsers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                未找到匹配的用户
              </div>
            ) : filteredDisplayUsers.map(user => {
              const rl = roleLabels[user.role] || roleLabels.user;
              const sl = statusLabels[user.status] || statusLabels.active;
              const realUser = realUsers.find(item => item.id === user.id);
              return (
                <div key={user.id} className="p-4 rounded-lg border border-border space-y-3">
                  {/* Row 1: user info + actions */}
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                      {user.nickname[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{user.nickname}</span>
                        <Badge variant={rl.variant}>{rl.label}</Badge>
                        {user.watermarkDisabled && <Badge variant="secondary">无水印下载</Badge>}
                        <span className={`text-xs ${sl.color}`}>{sl.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>{user.email}</span>
                        <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{user.creditsBalance} 积分</span>
                        {realUser?.invited_count ? <span>已邀请 {realUser.invited_count} 人</span> : null}
                        {realUser?.referred_by_nickname && <span>邀请人：{realUser.referred_by_nickname}</span>}
                        <span>日配额 {user.dailyQuotaUsed}/{user.dailyQuotaLimit}</span>
                        <span>{user.createdAt}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => startRecharge(user)}>
                        <Coins className="h-3.5 w-3.5" />充值
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => startResetPassword(user)}>
                        <KeyRound className="h-3.5 w-3.5" />重置密码
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(user)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      {user.role !== 'admin' && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(user)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Row 2: quick actions */}
                  <div className="flex items-center gap-2 pl-14 flex-wrap">
                    <span className="text-xs text-muted-foreground mr-1">快捷充值:</span>
                    {[50, 100, 200, 500].map(n => (
                      <Button key={n} variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => handleQuickRecharge(user, n)}>
                        +{n}
                      </Button>
                    ))}
                    <span className="text-xs text-muted-foreground ml-3 mr-1">会员等级:</span>
                    {membershipPlans.map(plan => (
                      <Button
                        key={plan.tier}
                        variant={user.membershipTier === plan.tier ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => handleTierChange(user, plan.tier)}
                      >
                        {plan.name}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
            {useRealData && (
              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>第 {userPage} / {totalDisplayUserPages} 页</span>
                  <Select
                    value={String(userPageSize)}
                    onValueChange={value => {
                      setUserPageSize(Number(value));
                      setUserPage(1);
                    }}
                  >
                    <SelectTrigger className="h-11 w-[112px] px-4 text-base leading-none [&_[data-slot=select-value]]:leading-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent side="top" align="start" sideOffset={8}>
                      <SelectItem value="20">20/页</SelectItem>
                      <SelectItem value="50">50/页</SelectItem>
                      <SelectItem value="100">100/页</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={userPage <= 1 || loadingRealUsers}
                    onClick={() => setUserPage(page => Math.max(1, page - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={userPage >= totalDisplayUserPages || loadingRealUsers}
                    onClick={() => setUserPage(page => Math.min(totalDisplayUserPages, page + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </div>
            )}
        </CardContent>
      </Card>

      {/* Add User Form */}
      {showAddForm && (
        <Card>
          <CardHeader><CardTitle className="text-lg">添加用户</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input placeholder="user@example.com" value={addEmail} onChange={e => setAddEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>昵称</Label>
                <Input placeholder="用户昵称" value={addNickname} onChange={e => setAddNickname(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>角色</Label>
                <Select value={addRole} onValueChange={v => setAddRole(v as ManagedUser['role'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">普通用户</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>会员等级</Label>
                <Select value={addTier} onValueChange={v => setAddTier(v as ManagedUser['membershipTier'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">免费版</SelectItem>
                    <SelectItem value="pro">Pro版</SelectItem>
                    <SelectItem value="max">Max版</SelectItem>
                    <SelectItem value="ultra">Ultra版</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>初始积分</Label>
                <Input type="number" value={addCredits} onChange={e => setAddCredits(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>每日配额</Label>
                <Input type="number" value={addQuota} onChange={e => setAddQuota(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>取消</Button>
              <Button className="gap-1.5" onClick={handleAddUser}><Save className="h-4 w-4" />添加</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reset Password Form */}
      {resetPwUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-lg border-primary/30 shadow-xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" />
                    重置密码 - {resetPwUser.nickname}
                  </CardTitle>
                  <CardDescription>{resetPwUser.email}</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setResetPwUser(null); setNewPassword(''); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>新密码</Label>
                <Input
                  type="text"
                  placeholder="输入新密码（至少6位）"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">重置后请通知用户使用新密码登录</p>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => { setResetPwUser(null); setNewPassword(''); }}>取消</Button>
                <Button className="gap-1.5" onClick={handleResetPassword} disabled={resetPwLoading || newPassword.length < 6}>
                  <KeyRound className="h-4 w-4" />
                  {resetPwLoading ? '重置中...' : '确认重置'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit User Form */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">编辑用户: {editingUser.nickname}</CardTitle>
                  <CardDescription>{editingUser.email}</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setEditingUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>邮箱</Label>
                  <Input
                    type="email"
                    placeholder="用户邮箱"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>角色</Label>
                  <Select value={editRole} onValueChange={v => setEditRole(v as ManagedUser['role'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">普通用户</SelectItem>
                      <SelectItem value="vip">VIP</SelectItem>
                      <SelectItem value="admin">管理员</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>会员等级</Label>
                  <Select
                    value={editTier}
                    onValueChange={v => {
                      const nextTier = v as ManagedUser['membershipTier'];
                      const plan = membershipPlans.find(item => item.tier === nextTier);
                      setEditTier(nextTier);
                      if (editRole !== 'admin' && editRole !== 'enterprise_admin') {
                        setEditRole(nextTier === 'free' ? 'user' : 'vip');
                      }
                      if (plan) {
                        setEditQuota(String(plan.dailyQuota));
                        setEditCredits(current => String(Math.max(Number(current) || 0, plan.credits)));
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">免费版</SelectItem>
                      <SelectItem value="pro">Pro版</SelectItem>
                      <SelectItem value="max">Max版</SelectItem>
                      <SelectItem value="ultra">Ultra版</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select value={editStatus} onValueChange={v => setEditStatus(v as ManagedUser['status'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">正常</SelectItem>
                      <SelectItem value="suspended">暂停</SelectItem>
                      <SelectItem value="banned">封禁</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>积分余额</Label>
                  <Input type="number" value={editCredits} onChange={e => setEditCredits(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>每日配额</Label>
                  <Input type="number" value={editQuota} onChange={e => setEditQuota(e.target.value)} />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">下载无水印</Label>
                    <p className="text-xs text-muted-foreground">
                      开启后，该用户下载自己生成的图片和视频时返回原文件；站内展示仍保留水印。
                    </p>
                  </div>
                  <Switch
                    checked={editWatermarkDisabled}
                    onCheckedChange={setEditWatermarkDisabled}
                    aria-label="下载无水印"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => startResetPassword(editingUser)}
                >
                  <KeyRound className="h-4 w-4" />重置密码
                </Button>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setEditingUser(null)}>取消</Button>
                  <Button className="gap-1.5" onClick={handleSaveEdit}><Save className="h-4 w-4" />保存</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recharge Dialog */}
      {rechargeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-lg border-primary/30 shadow-xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Coins className="h-5 w-5 text-primary" />
                    积分充值 - {rechargeUser.nickname}
                  </CardTitle>
                  <CardDescription>
                    {rechargeUser.email}
                    <span className="mx-2">·</span>
                    当前积分: <span className="text-primary font-bold">{rechargeUser.creditsBalance}</span>
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setRechargeUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode switch */}
              <div className="flex gap-2">
                <Button
                  variant={rechargeMode === 'add' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRechargeMode('add')}
                >
                  增加积分
                </Button>
                <Button
                  variant={rechargeMode === 'set' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRechargeMode('set')}
                >
                  设置为指定值
                </Button>
              </div>

              {/* Quick amounts */}
              <div className="space-y-2">
                <Label>快捷选择</Label>
                <div className="flex gap-2 flex-wrap">
                  {[50, 100, 200, 500, 1000, 2000].map(n => (
                    <Button
                      key={n}
                      variant={rechargeAmount === String(n) ? 'default' : 'outline'}
                      size="sm"
                      className="gap-1"
                      onClick={() => setRechargeAmount(String(n))}
                    >
                      {rechargeMode === 'add' ? '+' : ''}{n} 积分
                    </Button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div className="space-y-2">
                <Label>{rechargeMode === 'add' ? '充值数量' : '设置为'}</Label>
                <Input
                  type="number"
                  placeholder={rechargeMode === 'add' ? '输入要增加的积分数量' : '输入要设置的积分值'}
                  value={rechargeAmount}
                  onChange={e => setRechargeAmount(e.target.value)}
                />
                {rechargeAmount && Number(rechargeAmount) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {rechargeMode === 'add'
                      ? `充值后余额: ${rechargeUser.creditsBalance + Number(rechargeAmount)} 积分`
                      : `设置后余额: ${Number(rechargeAmount)} 积分`
                    }
                  </p>
                )}
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label>备注原因</Label>
                <Input
                  placeholder="管理员手动充值"
                  value={rechargeReason}
                  onChange={e => setRechargeReason(e.target.value)}
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => setRechargeUser(null)}>取消</Button>
                <Button className="gap-1.5" onClick={handleRecharge}>
                  <Coins className="h-4 w-4" />
                  确认{rechargeMode === 'add' ? '充值' : '设置'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Credit Transactions */}
      {config.creditTransactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">积分变动记录</CardTitle>
            <CardDescription>最近的积分调整记录</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {config.creditTransactions.slice(0, 20).map(tx => (
                <div key={tx.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0 text-sm">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    tx.amount > 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                  }`}>
                    {tx.amount > 0 ? '+' : '-'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{tx.userEmail}</span>
                      <span className={tx.amount > 0 ? 'text-primary' : 'text-destructive'}>
                        {tx.amount > 0 ? '+' : ''}{tx.amount} 积分
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{tx.reason}</span>
                      <span>余额: {tx.balanceAfter}</span>
                      <span>{new Date(tx.createdAt).toLocaleString('zh-CN')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
