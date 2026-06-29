'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCcw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';

type LogType = 'all' | 'auth' | 'generation' | 'admin' | 'database' | 'storage' | 'security' | 'system';
type LogLevel = 'all' | 'info' | 'warning' | 'error';

interface PlatformLog {
  id: string;
  type: Exclude<LogType, 'all'>;
  level: Exclude<LogLevel, 'all'>;
  action: string;
  message: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const TYPE_LABELS: Record<LogType, string> = {
  all: '全部类型',
  auth: '登录认证',
  generation: '生成任务',
  admin: '管理操作',
  database: '数据库',
  storage: '存储',
  security: '安全',
  system: '系统',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  all: '全部级别',
  info: '信息',
  warning: '警告',
  error: '错误',
};

const LEVEL_BADGE: Record<Exclude<LogLevel, 'all'>, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warning: 'outline',
  error: 'destructive',
};

const ACTION_LABELS: Record<string, string> = {
  console_login_success: '管理员登录成功',
  user_login_success: '用户登录成功',
  console_login_denied: '管理后台登录被拒绝',
  generation_job_created: '创建生成任务',
  generation_job_succeeded: '生成任务成功',
  generation_job_failed: '生成任务失败',
  generation_jobs_cleanup: '清理生成任务',
  platform_log_retention_updated: '更新日志保存时间',
  site_config_updated: '更新系统设置',
};

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getUserLabel(log: PlatformLog) {
  if (log.user_name || log.user_email) return log.user_name || log.user_email;
  return log.user_id || '系统';
}

function toLocalInputValue(value: Date) {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export default function LogManagementTab() {
  const { accessToken } = useAuth();
  const [logs, setLogs] = useState<PlatformLog[]>([]);
  const [type, setType] = useState<LogType>('all');
  const [level, setLevel] = useState<LogLevel>('all');
  const [userSearch, setUserSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);

  const headers = useMemo<HeadersInit>(() => ({
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }), [accessToken]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (type !== 'all') params.set('type', type);
      if (level !== 'all') params.set('level', level);
      if (userSearch.trim()) params.set('user', userSearch.trim());
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (startTime) params.set('startTime', new Date(startTime).toISOString());
      if (endTime) params.set('endTime', new Date(endTime).toISOString());

      const res = await fetch(`/api/admin/logs?${params.toString()}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载日志失败');
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      setRetentionDays(Number(data.settings?.retentionDays || 30));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载日志失败');
    } finally {
      setLoading(false);
    }
  }, [endTime, headers, keyword, level, page, pageSize, startTime, type, userSearch]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const setLastDays = (days: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setStartTime(toLocalInputValue(start));
    setEndTime(toLocalInputValue(now));
    setPage(1);
  };

  const saveRetention = async () => {
    setSavingRetention(true);
    try {
      const safeDays = Math.min(90, Math.max(1, Number(retentionDays || 30)));
      const res = await fetch('/api/admin/logs', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ retentionDays: safeDays }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存日志设置失败');
      setRetentionDays(Number(data.settings?.retentionDays || safeDays));
      toast.success(`日志保存时间已设置为 ${data.settings?.retentionDays || safeDays} 天`);
      await loadLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存日志设置失败');
    } finally {
      setSavingRetention(false);
    }
  };

  const resetFilters = () => {
    setType('all');
    setLevel('all');
    setUserSearch('');
    setKeyword('');
    setStartTime('');
    setEndTime('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>系统日志</CardTitle>
          <CardDescription>查看平台登录、生成任务、管理操作、安全和系统运行日志，所有日志按中文说明展示。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>日志保存时间</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={retentionDays}
                onChange={event => setRetentionDays(Math.min(90, Math.max(1, Number(event.target.value || 30))))}
              />
              <p className="text-xs text-muted-foreground">最长可设置 90 天，过期日志会在查询和保存设置时自动清理。</p>
            </div>
            <div className="space-y-2">
              <Label>快捷时间段</Label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setLastDays(1)}>近 1 天</Button>
                <Button variant="outline" size="sm" onClick={() => setLastDays(7)}>近 7 天</Button>
                <Button variant="outline" size="sm" onClick={() => { setStartTime(''); setEndTime(''); setPage(1); }}>全部时间</Button>
              </div>
            </div>
            <Button className="gap-2" onClick={saveRetention} disabled={savingRetention}>
              {savingRetention ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存设置
            </Button>
          </div>

          <div className="grid gap-3 xl:grid-cols-7">
            <div className="space-y-2">
              <Label>日志类型</Label>
              <Select value={type} onValueChange={(value) => { setType(value as LogType); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>日志级别</Label>
              <Select value={level} onValueChange={(value) => { setLevel(value as LogLevel); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>用户筛选</Label>
              <Input value={userSearch} onChange={event => { setUserSearch(event.target.value); setPage(1); }} placeholder="昵称、邮箱、用户ID" />
            </div>
            <div className="space-y-2">
              <Label>关键字</Label>
              <Input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="行为、内容、对象" />
            </div>
            <div className="space-y-2">
              <Label>开始时间</Label>
              <Input type="datetime-local" value={startTime} onChange={event => { setStartTime(event.target.value); setPage(1); }} />
            </div>
            <div className="space-y-2">
              <Label>结束时间</Label>
              <Input type="datetime-local" value={endTime} onChange={event => { setEndTime(event.target.value); setPage(1); }} />
            </div>
            <div className="space-y-2">
              <Label>每页数量</Label>
              <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map(value => (
                    <SelectItem key={value} value={String(value)}>{value} 条</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={resetFilters}>重置筛选</Button>
            <Button variant="outline" onClick={loadLogs} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              刷新
            </Button>
            <Button onClick={loadLogs} disabled={loading}>
              <Search className="mr-2 h-4 w-4" />
              查询日志
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">时间</th>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">级别</th>
                  <th className="px-3 py-2 text-left font-medium">用户</th>
                  <th className="px-3 py-2 text-left font-medium">日志内容</th>
                  <th className="px-3 py-2 text-left font-medium">对象</th>
                  <th className="px-3 py-2 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>日志加载中...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>暂无日志</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatTime(log.created_at)}</td>
                    <td className="px-3 py-2">{TYPE_LABELS[log.type] || log.type}</td>
                    <td className="px-3 py-2"><Badge variant={LEVEL_BADGE[log.level]}>{LEVEL_LABELS[log.level]}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="max-w-[220px]">
                        <div className="truncate font-medium">{getUserLabel(log)}</div>
                        <div className="truncate text-xs text-muted-foreground">{log.user_email || log.user_id || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[420px]">
                        <div className="font-medium">{log.message}</div>
                        <div className="truncate text-xs text-muted-foreground" title={log.action}>
                          {ACTION_LABELS[log.action] || log.action}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[220px] truncate" title={log.target_id || ''}>
                        {log.target_type || '-'} {log.target_id ? `· ${log.target_id}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2">{log.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>共 {total} 条，第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
