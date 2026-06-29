'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Shield, Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, parseApiUser } from '@/lib/auth-store';

const authInputIconClass = 'pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/70 dark:text-foreground/80';
const authPasswordToggleClass = 'absolute right-3 top-1/2 z-10 -translate-y-1/2 text-foreground/70 transition-colors hover:text-foreground dark:text-foreground/80';

export default function ConsoleLoginPage() {
  const router = useRouter();
  const { login, isLoggedIn, isAdmin } = useAuth();
  const { setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && isLoggedIn && isAdmin) {
      router.replace('/console/dashboard');
    }
  }, [mounted, isLoggedIn, isAdmin, router]);

  const handleLogin = async () => {
    if (!account || !password) {
      toast.error('请填写管理员账号和密码');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password, adminOnly: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '管理员登录失败');

      const authUser = parseApiUser(data.user || {});
      if (authUser.role !== 'admin' && authUser.role !== 'enterprise_admin') {
        throw new Error('只有管理员可以登录管理后台');
      }

      login(authUser, data.session?.access_token || '');
      setTheme(authUser.preferredTheme);
      toast.success('管理员登录成功');
      router.replace('/console/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '管理员登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-mobile-page min-h-screen bg-background flex items-center justify-center px-4">
      <div className="auth-mobile-shell w-full max-w-md">
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回站点
          </Link>
        </div>

        <Card className="auth-mobile-card">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-2xl">管理后台</CardTitle>
              <CardDescription>仅管理员账号可登录</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="console-account">管理员账号</Label>
              <div className="relative">
                <Mail className={authInputIconClass} />
                <Input
                  id="console-account"
                  type="text"
                  placeholder="邮箱、手机号或用户名"
                  value={account}
                  onChange={event => setAccount(event.target.value)}
                  className="pl-10"
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleLogin();
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="console-password">密码</Label>
              <div className="relative">
                <Lock className={authInputIconClass} />
                <Input
                  id="console-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="输入管理员密码"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className="pl-10 pr-10"
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleLogin();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  className={authPasswordToggleClass}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button className="h-11 w-full" onClick={handleLogin} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
              登录管理后台
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
