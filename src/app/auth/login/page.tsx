'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Brush, Mail, Lock, User, Phone, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, parseApiUser } from '@/lib/auth-store';
import { RegistrationAgreementDialog } from '@/components/auth/registration-agreement-dialog';

const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const authInputIconClass = 'pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/70 dark:text-foreground/80';
const authPasswordToggleClass = 'absolute right-3 top-1/2 z-10 -translate-y-1/2 text-foreground/70 transition-colors hover:text-foreground dark:text-foreground/80';

function isEmail(value: string) {
  return EMAIL_REGEX.test(value.trim());
}

function sanitizeCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 10);
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Login form
  const [loginAccount, setLoginAccount] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regNickname, setRegNickname] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regInviteCode, setRegInviteCode] = useState('');
  const [regEmailCode, setRegEmailCode] = useState('');
  const [regCodeCooldown, setRegCodeCooldown] = useState(0);
  const [sendingRegCode, setSendingRegCode] = useState(false);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [showForgotPw, setShowForgotPw] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetCooldown, setResetCooldown] = useState(0);
  const [sendingResetCode, setSendingResetCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);

  // Auto-initialize default admin account on mount (fire-and-forget)
  useEffect(() => {
    fetch('/api/auth/admin-exists').catch(() => {/* silent */});
  }, []);

  useEffect(() => {
    if (regCodeCooldown <= 0) return;
    const timer = window.setInterval(() => setRegCodeCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [regCodeCooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = window.setInterval(() => setResetCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resetCooldown]);

  const handleLogin = async () => {
    if (!loginAccount || !loginPassword) {
      toast.error('请填写账号和密码');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: loginAccount, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');

      // Save auth state with full profile
      const authUser = parseApiUser(data.user || {});
      login(authUser, data.session?.access_token || '');
      setTheme(authUser.preferredTheme);

      toast.success('登录成功');
      router.push('/create');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regEmail || !regPassword) {
      toast.error('请填写邮箱和密码');
      return;
    }
    if (!isEmail(regEmail)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPassword,
          nickname: regNickname,
          phone: regPhone,
          inviteCode: regInviteCode || undefined,
          emailCode: showInviteCode && regInviteCode ? undefined : regEmailCode,
          acceptedTerms: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '注册失败');

      // Save auth state with full profile
      const authUser = parseApiUser(data.user || {});
      login(authUser, data.session?.access_token || '');
      setTheme(authUser.preferredTheme);

      toast.success(data.message || '注册成功');
      router.push('/create');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const requestRegisterAgreement = () => {
    setShowAgreement(true);
  };

  const handleAgreeAndRegister = () => {
    setShowAgreement(false);
    handleRegister();
  };

  const handleSendRegisterCode = async () => {
    if (!isEmail(regEmail)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }
    setSendingRegCode(true);
    try {
      const res = await fetch('/api/email/send-register-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '验证码发送失败');
      setRegCodeCooldown(data.cooldown || 60);
      toast.success(data.message || '验证码已发送');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSendingRegCode(false);
    }
  };

  const handleSendResetCode = async () => {
    if (!isEmail(resetEmail)) {
      toast.error('请输入注册时绑定并验证过的邮箱');
      return;
    }
    setSendingResetCode(true);
    try {
      const res = await fetch('/api/email/send-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '验证码发送失败');
      setResetCooldown(data.cooldown || 60);
      toast.success(data.message || '如果该邮箱可用于重置，我们已发送验证码');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSendingResetCode(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isEmail(resetEmail) || !resetCode) {
      toast.error('请填写邮箱和验证码');
      return;
    }
    if (!isStrongPassword(resetPassword)) {
      toast.error('新密码至少 8 位，并同时包含字母和数字');
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setResettingPassword(true);
    try {
      const res = await fetch('/api/email/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword: resetPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '密码重置失败');
      toast.success(data.message || '密码已重置，请重新登录');
      setShowForgotPw(false);
      setLoginAccount(resetEmail);
      setResetCode('');
      setResetPassword('');
      setResetConfirmPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div className="auth-mobile-page min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>

      <div className="auth-mobile-shell w-full max-w-md">
        {/* Logo */}
        <div className="auth-mobile-brand text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Brush className="h-5 w-5" />
            </div>
            <span className="font-serif text-2xl font-bold">妙境</span>
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">妙手丹青，境随心造</p>
        </div>

        <Card className="auth-mobile-card">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader className="pb-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent className="pt-6">
              <TabsContent value="login" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <Label htmlFor="login-account">邮箱 / 手机号 / 用户名</Label>
                  <div className="relative">
                    <Mail className={authInputIconClass} />
                    <Input
                      id="login-account"
                      type="text"
                      placeholder="邮箱、手机号或用户名"
                      value={loginAccount}
                      onChange={(e) => setLoginAccount(e.target.value)}
                      className="pl-10"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密码</Label>
                  <div className="relative">
                    <Lock className={authInputIconClass} />
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="输入密码"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="pl-10 pr-10"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className={authPasswordToggleClass}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowForgotPw(true)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    忘记密码?
                  </button>
                </div>
                <Button className="w-full h-11" onClick={handleLogin} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  登录
                </Button>
              </TabsContent>

              <TabsContent value="register" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <Label htmlFor="reg-email">邮箱</Label>
                  <div className="relative">
                    <Mail className={authInputIconClass} />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="your@email.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                {!(showInviteCode && regInviteCode) && (
                  <div className="space-y-2">
                    <Label htmlFor="reg-email-code">邮箱验证码</Label>
                    <div className="auth-mobile-code-row flex gap-2">
                      <Input
                        id="reg-email-code"
                        placeholder="输入验证码"
                        value={regEmailCode}
                        onChange={(e) => setRegEmailCode(sanitizeCode(e.target.value))}
                        className="uppercase"
                        maxLength={10}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={handleSendRegisterCode}
                        disabled={sendingRegCode || regCodeCooldown > 0 || !isEmail(regEmail)}
                      >
                        {sendingRegCode ? <Loader2 className="h-4 w-4 animate-spin" /> : regCodeCooldown > 0 ? `${regCodeCooldown}s` : '发送验证码'}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="reg-nickname">用户名</Label>
                  <div className="relative">
                    <User className={authInputIconClass} />
                    <Input
                      id="reg-nickname"
                      placeholder="用于登录的用户名"
                      value={regNickname}
                      onChange={(e) => setRegNickname(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">系统会自动生成一个中文昵称和默认头像，注册后可在个人资料中修改。</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-phone">手机号 (选填)</Label>
                  <div className="relative">
                    <Phone className={authInputIconClass} />
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="13800138000"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">密码</Label>
                  <div className="relative">
                    <Lock className={authInputIconClass} />
                    <Input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="至少6位密码"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="pl-10 pr-10"
                      onKeyDown={(e) => { if (e.key === 'Enter') requestRegisterAgreement(); }}
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className={authPasswordToggleClass}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {/* Admin invite code */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reg-invite" className="text-xs text-muted-foreground">邀请码 (选填)</Label>
                    <button
                      type="button"
                      onClick={() => setShowInviteCode(!showInviteCode)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showInviteCode ? '隐藏' : '管理员注册?'}
                    </button>
                  </div>
                  {showInviteCode && (
                    <div className="relative">
                      <Lock className={authInputIconClass} />
                      <Input
                        id="reg-invite"
                        type="text"
                        placeholder="输入管理员邀请码"
                        value={regInviteCode}
                        onChange={(e) => setRegInviteCode(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  )}
                </div>
                <Button className="w-full h-11" onClick={requestRegisterAgreement} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  注册
                </Button>
                <p className="text-sm text-center leading-6 text-muted-foreground">
                  注册即表示同意
                  <span className="mx-1 font-medium text-primary">
                    服务条款
                  </span>
                  和
                  <span className="mx-1 font-medium text-primary">
                    隐私政策
                  </span>
                </p>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        {/* Forgot Password Dialog */}
        <Dialog open={showForgotPw} onOpenChange={setShowForgotPw}>
          <DialogContent className="auth-mobile-dialog sm:max-w-md">
            <DialogHeader>
              <DialogTitle>忘记密码</DialogTitle>
              <DialogDescription>
                输入已验证邮箱，获取验证码后设置新密码。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>注册邮箱</Label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>验证码</Label>
                <div className="auth-mobile-code-row flex gap-2">
                  <Input
                    placeholder="输入邮箱验证码"
                    value={resetCode}
                    onChange={(e) => setResetCode(sanitizeCode(e.target.value))}
                    className="uppercase"
                    maxLength={10}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={handleSendResetCode}
                    disabled={sendingResetCode || resetCooldown > 0 || !isEmail(resetEmail)}
                  >
                    {sendingResetCode ? <Loader2 className="h-4 w-4 animate-spin" /> : resetCooldown > 0 ? `${resetCooldown}s` : '发送验证码'}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>新密码</Label>
                <Input
                  type="password"
                  placeholder="至少 8 位，包含字母和数字"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>确认新密码</Label>
                <Input
                  type="password"
                  placeholder="再次输入新密码"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForgotPw(false)}>取消</Button>
              <Button onClick={handleResetPassword} disabled={resettingPassword}>
                {resettingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                重置密码
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <RegistrationAgreementDialog
          open={showAgreement}
          onOpenChange={setShowAgreement}
          onAgree={handleAgreeAndRegister}
        />
      </div>
    </div>
  );
}
