'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type JobStatus = 'all' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface GenerationJob {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_nickname: string | null;
  type: 'image' | 'video';
  status: Exclude<JobStatus, 'all'>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  all: '全部',
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

const STATUS_BADGE: Record<Exclude<JobStatus, 'all'>, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  running: 'outline',
  succeeded: 'default',
  failed: 'destructive',
  cancelled: 'secondary',
};

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getJobAccountLabel(job: GenerationJob) {
  if (job.user_nickname || job.user_email) return job.user_nickname || job.user_email;
  return job.user_id ? '未知账号' : '历史任务（未记录账号）';
}

export default function TaskManagementTab() {
  const { accessToken } = useAuth();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [status, setStatus] = useState<JobStatus>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const headers = useMemo<HeadersInit>(() => ({
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }), [accessToken]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status !== 'all') params.set('status', status);
      if (userSearch.trim()) params.set('userSearch', userSearch.trim());
      const res = await fetch(`/api/admin/generation-jobs?${params.toString()}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载任务失败');
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setTotal(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  }, [headers, page, pageSize, status, userSearch]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function cleanup(cleanupStatus: 'failed' | 'succeeded') {
    setCleaning(true);
    try {
      const params = new URLSearchParams({
        status: cleanupStatus,
        olderThanDays: String(olderThanDays),
      });
      const res = await fetch(`/api/admin/generation-jobs?${params.toString()}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '清理任务失败');
      toast.success(`已清理 ${data.deleted || 0} 条任务`);
      await loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理任务失败');
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>任务管理</CardTitle>
          <CardDescription>查看生成任务状态，清理失败或过期任务，不展示任务 payload 和用户 API Key。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-2">
                <Label>账号筛选</Label>
                <Input
                  value={userSearch}
                  onChange={(event) => { setUserSearch(event.target.value); setPage(1); }}
                  placeholder="邮箱、昵称、用户ID"
                />
              </div>
              <div className="space-y-2">
                <Label>状态筛选</Label>
                <Select value={status} onValueChange={(value) => { setStatus(value as JobStatus); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="space-y-2">
                <Label>清理阈值（天）</Label>
                <Input
                  type="number"
                  min={0}
                  value={olderThanDays}
                  onChange={(event) => setOlderThanDays(Math.max(0, Number(event.target.value || 0)))}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={loadJobs} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                刷新
              </Button>
              <Button variant="outline" onClick={() => cleanup('failed')} disabled={cleaning}>
                <Trash2 className="mr-2 h-4 w-4" />
                清理失败
              </Button>
              <Button variant="outline" onClick={() => cleanup('succeeded')} disabled={cleaning}>
                <Trash2 className="mr-2 h-4 w-4" />
                清理已完成
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">任务ID</th>
                  <th className="px-3 py-2 text-left font-medium">账号</th>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                  <th className="px-3 py-2 text-left font-medium">错误</th>
                  <th className="px-3 py-2 text-left font-medium">创建时间</th>
                  <th className="px-3 py-2 text-left font-medium">完成时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>加载中...</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>暂无任务</td></tr>
                ) : jobs.map(job => (
                  <tr key={job.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{job.id}</td>
                    <td className="px-3 py-2">
                      <div className="max-w-[220px]">
                        <div className="truncate font-medium">{getJobAccountLabel(job)}</div>
                        <div className="truncate text-xs text-muted-foreground">{job.user_email || job.user_id || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{job.type === 'image' ? '生图' : '视频'}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_BADGE[job.status]}>{STATUS_LABELS[job.status]}</Badge>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground" title={job.error || ''}>
                      {job.error || '-'}
                    </td>
                    <td className="px-3 py-2">{formatTime(job.created_at)}</td>
                    <td className="px-3 py-2">{formatTime(job.finished_at)}</td>
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
