'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Clock3, Coins, Loader2, RefreshCcw, Search, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';

type CallStatus = 'all' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type CallType = 'all' | 'image' | 'video' | 'text' | 'reverse-prompt';
type CallSource = 'all' | 'generation-job' | 'suggest-prompt';

interface ModelCallRecord {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_nickname: string | null;
  source: Exclude<CallSource, 'all'>;
  operation: string;
  generation_job_id: string | null;
  type: Exclude<CallType, 'all'>;
  provider: string;
  model_name: string;
  api_url: string;
  system_api_id: string | null;
  custom_api_key_id: string | null;
  status: Exclude<CallStatus, 'all'>;
  credits_cost: number;
  result_count: number;
  duration_ms: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface ModelCallSummary {
  total_calls: number;
  succeeded_calls: number;
  failed_calls: number;
  cancelled_calls: number;
  total_credits_cost: number;
  credits_cost_7d: number;
  total_results: number;
  avg_duration_ms: number;
}

interface TopModelRow {
  type: Exclude<CallType, 'all'>;
  provider: string;
  model_name: string;
  calls: number;
  succeeded: number;
  failed: number;
  credits_cost: number;
  result_count: number;
  avg_duration_ms: number;
}

const EMPTY_SUMMARY: ModelCallSummary = {
  total_calls: 0,
  succeeded_calls: 0,
  failed_calls: 0,
  cancelled_calls: 0,
  total_credits_cost: 0,
  credits_cost_7d: 0,
  total_results: 0,
  avg_duration_ms: 0,
};

const STATUS_LABELS: Record<CallStatus, string> = {
  all: '全部状态',
  queued: '排队中',
  running: '调用中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_BADGE: Record<Exclude<CallStatus, 'all'>, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  running: 'outline',
  succeeded: 'default',
  failed: 'destructive',
  cancelled: 'secondary',
};

const TYPE_LABELS: Record<CallType, string> = {
  all: '全部类型',
  image: '生图',
  video: '视频',
  text: '文本',
  'reverse-prompt': '反推提示词',
};

const SOURCE_LABELS: Record<CallSource, string> = {
  all: '全部来源',
  'generation-job': '后台任务',
  'suggest-prompt': '提示词优化',
};

const OPERATION_LABELS: Record<string, string> = {
  text2img: '文生图',
  img2img: '图生图',
  text2video: '文生视频',
  img2video: '图生视频',
  'reverse-prompt': '反推提示词',
  'suggest-prompt': '提示词优化',
  'agnes-prompt-optimization': 'Agnes 提示词优化',
};

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatNumber(value: number | string | null | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function getAccountLabel(record: ModelCallRecord) {
  if (record.user_nickname || record.user_email) return record.user_nickname || record.user_email;
  return record.user_id ? '未知账号' : '系统/未记录账号';
}

function toLocalInputValue(value: Date) {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function operationLabel(value: string) {
  return OPERATION_LABELS[value] || value || '-';
}

export default function ModelCallRecordsTab() {
  const { accessToken } = useAuth();
  const [records, setRecords] = useState<ModelCallRecord[]>([]);
  const [summary, setSummary] = useState<ModelCallSummary>(EMPTY_SUMMARY);
  const [topModels, setTopModels] = useState<TopModelRow[]>([]);
  const [status, setStatus] = useState<CallStatus>('all');
  const [type, setType] = useState<CallType>('all');
  const [source, setSource] = useState<CallSource>('all');
  const [userSearch, setUserSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const headers = useMemo<HeadersInit>(() => ({
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }), [accessToken]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status !== 'all') params.set('status', status);
      if (type !== 'all') params.set('type', type);
      if (source !== 'all') params.set('source', source);
      if (userSearch.trim()) params.set('userSearch', userSearch.trim());
      if (modelSearch.trim()) params.set('model', modelSearch.trim());
      if (startTime) params.set('startTime', new Date(startTime).toISOString());
      if (endTime) params.set('endTime', new Date(endTime).toISOString());

      const res = await fetch(`/api/admin/model-call-records?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载模型调用记录失败');
      setRecords(Array.isArray(data.records) ? data.records : []);
      setSummary({ ...EMPTY_SUMMARY, ...(data.summary || {}) });
      setTopModels(Array.isArray(data.topModels) ? data.topModels : []);
      setTotal(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载模型调用记录失败');
    } finally {
      setLoading(false);
    }
  }, [endTime, headers, modelSearch, page, pageSize, source, startTime, status, type, userSearch]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const setLastDays = (days: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setStartTime(toLocalInputValue(start));
    setEndTime(toLocalInputValue(now));
    setPage(1);
  };

  const resetFilters = () => {
    setStatus('all');
    setType('all');
    setSource('all');
    setUserSearch('');
    setModelSearch('');
    setStartTime('');
    setEndTime('');
    setPage(1);
  };

  const statCards = [
    { label: '总调用', value: formatNumber(summary.total_calls), sub: `成功 ${formatNumber(summary.succeeded_calls)} 次`, icon: Activity },
    { label: '失败调用', value: formatNumber(summary.failed_calls), sub: `取消 ${formatNumber(summary.cancelled_calls)} 次`, icon: XCircle },
    { label: '总消耗', value: `${formatNumber(summary.total_credits_cost)} 积分`, sub: `近 7 日 ${formatNumber(summary.credits_cost_7d)} 积分`, icon: Coins },
    { label: '平均耗时', value: formatDuration(Number(summary.avg_duration_ms || 0)), sub: `结果 ${formatNumber(summary.total_results)} 个`, icon: Clock3 },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>模型调用记录</CardTitle>
          <CardDescription>记录后台任务和提示词优化调用的模型、状态、耗时、结果数量与积分消耗，不展示 payload、API Key 或用户提示词原文。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statCards.map(item => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-md border border-border/70 bg-background/45 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{loading ? <Loader2 className="h-6 w-6 animate-spin" /> : item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 xl:grid-cols-8">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={status} onValueChange={(value) => { setStatus(value as CallStatus); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={type} onValueChange={(value) => { setType(value as CallType); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>来源</Label>
              <Select value={source} onValueChange={(value) => { setSource(value as CallSource); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 xl:col-span-2">
              <Label>模型/供应商</Label>
              <Input value={modelSearch} onChange={event => { setModelSearch(event.target.value); setPage(1); }} placeholder="模型、供应商、地址" />
            </div>
            <div className="space-y-2 xl:col-span-2">
              <Label>用户</Label>
              <Input value={userSearch} onChange={event => { setUserSearch(event.target.value); setPage(1); }} placeholder="昵称、邮箱、用户ID" />
            </div>
            <div className="space-y-2">
              <Label>每页</Label>
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

          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label>开始时间</Label>
              <Input type="datetime-local" value={startTime} onChange={event => { setStartTime(event.target.value); setPage(1); }} />
            </div>
            <div className="space-y-2">
              <Label>结束时间</Label>
              <Input type="datetime-local" value={endTime} onChange={event => { setEndTime(event.target.value); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setLastDays(1)}>近 1 天</Button>
              <Button variant="outline" size="sm" onClick={() => setLastDays(7)}>近 7 天</Button>
              <Button variant="outline" size="sm" onClick={resetFilters}>重置</Button>
              <Button onClick={loadRecords} disabled={loading}>
                <Search className="mr-2 h-4 w-4" />
                查询
              </Button>
              <Button variant="outline" onClick={loadRecords} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                刷新
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1360px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">时间</th>
                  <th className="px-3 py-2 text-left font-medium">用户</th>
                  <th className="px-3 py-2 text-left font-medium">调用</th>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                  <th className="px-3 py-2 text-left font-medium">配置</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                  <th className="px-3 py-2 text-left font-medium">消耗/结果</th>
                  <th className="px-3 py-2 text-left font-medium">耗时</th>
                  <th className="px-3 py-2 text-left font-medium">错误</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>调用记录加载中...</td></tr>
                ) : records.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>暂无模型调用记录</td></tr>
                ) : records.map(record => (
                  <tr key={record.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatTime(record.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="max-w-[220px]">
                        <div className="truncate font-medium">{getAccountLabel(record)}</div>
                        <div className="truncate text-xs text-muted-foreground">{record.user_email || record.user_id || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{operationLabel(record.operation)}</span>
                        <span className="text-xs text-muted-foreground">{TYPE_LABELS[record.type]} · {SOURCE_LABELS[record.source]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[260px]">
                        <div className="truncate font-medium" title={record.model_name || ''}>{record.model_name || '-'}</div>
                        <div className="truncate text-xs text-muted-foreground" title={record.provider || ''}>{record.provider || '-'}</div>
                        {record.api_url && <div className="truncate text-xs text-muted-foreground" title={record.api_url}>{record.api_url}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[210px] text-xs text-muted-foreground">
                        <div className="truncate" title={record.system_api_id || ''}>系统：{record.system_api_id || '-'}</div>
                        <div className="truncate" title={record.custom_api_key_id || ''}>自定义：{record.custom_api_key_id || '-'}</div>
                        <div className="truncate" title={record.generation_job_id || ''}>任务：{record.generation_job_id || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2"><Badge variant={STATUS_BADGE[record.status]}>{STATUS_LABELS[record.status]}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap">{formatNumber(record.credits_cost)} 积分</div>
                      <div className="text-xs text-muted-foreground">{formatNumber(record.result_count)} 个结果</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDuration(record.duration_ms)}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={record.error || ''}>{record.error || '-'}</td>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            模型调用排行
          </CardTitle>
          <CardDescription>按当前筛选条件统计调用次数、失败数、消耗和平均耗时。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">调用</th>
                  <th className="px-3 py-2 text-left font-medium">成功/失败</th>
                  <th className="px-3 py-2 text-left font-medium">消耗</th>
                  <th className="px-3 py-2 text-left font-medium">结果数</th>
                  <th className="px-3 py-2 text-left font-medium">平均耗时</th>
                </tr>
              </thead>
              <tbody>
                {topModels.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>暂无排行数据</td></tr>
                ) : topModels.map((model, index) => (
                  <tr key={`${model.type}:${model.provider}:${model.model_name}:${index}`} className="border-t">
                    <td className="px-3 py-2">
                      <div className="max-w-[320px]">
                        <div className="truncate font-medium" title={model.model_name}>{model.model_name || '-'}</div>
                        <div className="truncate text-xs text-muted-foreground" title={model.provider}>{model.provider || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{TYPE_LABELS[model.type]}</td>
                    <td className="px-3 py-2">{formatNumber(model.calls)}</td>
                    <td className="px-3 py-2">{formatNumber(model.succeeded)} / {formatNumber(model.failed)}</td>
                    <td className="px-3 py-2">{formatNumber(model.credits_cost)} 积分</td>
                    <td className="px-3 py-2">{formatNumber(model.result_count)}</td>
                    <td className="px-3 py-2">{formatDuration(model.avg_duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
