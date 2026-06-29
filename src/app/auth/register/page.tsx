'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Brush, Mail, Lock, User, Phone, Eye, EyeOff, Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { addCreditRecord } from '@/lib/credit-records-store';
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
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [showAgreement, setShowAgreement] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('invite') || params.get('ref') || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 32);
    if (code) setReferralCode(code);
  }, []);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(() => setCodeCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const handleRegister = async () => {
    if (!email || !password) {
      toast.error('请填写邮箱和密码');
      return;
    }
    if (!isEmail(email)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }
    if (!isStrongPassword(password)) {
      toast.error('密码至少 8 位，并同时包含字母和数字');
      return;
    }
    if (!emailCode) {
      toast.error('请输入邮箱验证码');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nickname: username, phone, emailCode, referralCode, acceptedTerms: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '注册失败');
      const bonus = referralCode ? 60 : 10;
      toast.success(referralCode ? '注册成功，已获得10积分体验金和50积分邀请奖励' : '注册成功，赠送10积分体验金');
      addCreditRecord({ type: 'gift', amount: bonus, balanceAfter: bonus, description: referralCode ? '注册和邀请奖励' : '新用户注册奖励' });
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

  const handleSendCode = async () => {
    if (!isEmail(email)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }
    setSendingCode(true);
    try {
      const res = await fetch('/api/email/send-register-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '验证码发送失败');
      setCodeCooldown(data.cooldown || 60);
      toast.success(data.message || '验证码已发送');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  return (
    <div className="auth-mobile-page min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>
      <div className="auth-mobile-shell w-full max-w-md">
        <div className="auth-mobile-brand text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Brush className="h-5 w-5" />
            </div>
            <span className="font-serif text-2xl font-bold">妙境</span>
          </Link>
        </div>

        <Card className="auth-mobile-card">
          <CardHeader>
            <CardTitle className="font-serif text-xl">创建账号</CardTitle>
            <CardDescription>{referralCode ? '通过邀请注册可额外获得50积分' : '注册即可获得10积分体验金'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {referralCode && (
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <Gift className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="font-medium">已识别邀请链接</p>
                  <p className="text-xs text-muted-foreground">注册成功后，你和邀请人各获得50积分。</p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱 *</Label>
              <div className="relative">
                <Mail className={authInputIconClass} />
                <Input id="email" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailCode">邮箱验证码 *</Label>
              <div className="auth-mobile-code-row flex gap-2">
                <Input
                  id="emailCode"
                  placeholder="输入验证码"
                  value={emailCode}
                  onChange={(e) => setEmailCode(sanitizeCode(e.target.value))}
                  className="uppercase"
                  maxLength={10}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleSendCode}
                  disabled={sendingCode || codeCooldown > 0 || !isEmail(email)}
                >
                  {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nickname">用户名</Label>
              <div className="relative">
                <User className={authInputIconClass} />
                <Input id="nickname" placeholder="用于登录的用户名" value={username} onChange={(e) => setUsername(e.target.value)} className="pl-10" />
              </div>
              <p className="text-xs text-muted-foreground">系统会自动生成一个中文昵称和默认头像，注册后可在个人资料中修改。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <div className="relative">
                <Phone className={authInputIconClass} />
                <Input id="phone" type="tel" placeholder="13800138000" value={phone} onChange={(e) => setPhone(e.target.value)} className="pl-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码 *</Label>
              <div className="relative">
                <Lock className={authInputIconClass} />
                <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="至少8位，包含字母和数字" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 pr-10" />
                <button onClick={() => setShowPassword(!showPassword)} className={authPasswordToggleClass}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button className="w-full h-11" onClick={requestRegisterAgreement} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              注册
            </Button>
            <p className="text-center text-sm leading-6 text-muted-foreground">
              注册即表示同意
              <span className="mx-1 font-medium text-primary">
                服务条款
              </span>
              和
              <span className="mx-1 font-medium text-primary">
                隐私政策
              </span>
            </p>
            <p className="text-center text-sm text-muted-foreground">
              已有账号？ <Link href="/auth/login" className="text-primary hover:underline">去登录</Link>
            </p>
          </CardContent>
        </Card>
      </div>
      <RegistrationAgreementDialog
        open={showAgreement}
        onOpenChange={setShowAgreement}
        onAgree={handleAgreeAndRegister}
      />
    </div>
  );
}
