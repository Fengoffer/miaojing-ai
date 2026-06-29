'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Edit3, Eye, ImageIcon, Loader2, Mail, RefreshCcw, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type GalleryWorkType = 'text2img' | 'img2img' | 'text2video' | 'img2video';
type GalleryFilterType = 'all' | 'image' | 'video' | GalleryWorkType;

interface AdminGalleryWork {
  id: string;
  type: GalleryWorkType;
  title: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  likes: number;
  authorId: string | null;
  authorEmail: string;
  authorNickname: string;
  authorAvatarUrl: string | null;
  publishedAt: string | null;
}

interface GalleryWorksResponse {
  works?: AdminGalleryWork[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  nextOffset?: number;
  hasMore?: boolean;
  error?: string;
}

type ReasonTemplateKey =
  | 'remove_sensitive_words'
  | 'improve_wording'
  | 'remove_private_info'
  | 'platform_policy_adjustment';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const TYPE_OPTIONS: Array<{ value: GalleryFilterType; label: string }> = [
  { value: 'all', label: '全部公开作品' },
  { value: 'image', label: '全部图片' },
  { value: 'video', label: '全部视频' },
  { value: 'text2img', label: '文生图' },
  { value: 'img2img', label: '图生图' },
  { value: 'text2video', label: '文生视频' },
  { value: 'img2video', label: '图生视频' },
];

const TYPE_LABELS: Record<string, string> = {
  text2img: '文生图',
  img2img: '图生图',
  text2video: '文生视频',
  img2video: '图生视频',
};

const REASON_TEMPLATES: Array<{ key: ReasonTemplateKey; label: string; description: string }> = [
  { key: 'remove_sensitive_words', label: '删除敏感词', description: '删除敏感词，确保公开展示合规' },
  { key: 'improve_wording', label: '优化表述', description: '优化提示词表述，避免误导或不适内容' },
  { key: 'remove_private_info', label: '移除隐私', description: '移除个人信息或隐私相关描述' },
  { key: 'platform_policy_adjustment', label: '平台规范', description: '根据平台内容规范调整公开展示文案' },
];

function formatDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function isVideoWork(work: AdminGalleryWork | null) {
  return work?.type === 'text2video' || work?.type === 'img2video';
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function buildEmailTemplate(work: AdminGalleryWork, template: { key: ReasonTemplateKey; description: string }) {
  return {
    subject: '公开画廊作品提示词已调整',
    body: [
      `${work.authorNickname || '你好'}，`,
      '',
      `你分享至妙境公开画廊的作品（ID：${shortId(work.id)}）提示词已由管理员调整。`,
      `调整原因：${template.description}。`,
      '',
      '本次调整只影响作品在公开画廊中展示的提示词文案，不会删除你的作品或修改生成结果。',
      '如有疑问，请通过平台联系方式反馈。',
    ].join('\n'),
  };
}

function defaultEmailDraft(work: AdminGalleryWork | null) {
  if (!work) return { subject: '', body: '' };
  return buildEmailTemplate(work, REASON_TEMPLATES[0]);
}

export default function GalleryManagementTab() {
  const { accessToken } = useAuth();
  const [works, setWorks] = useState<AdminGalleryWork[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [type, setType] = useState<GalleryFilterType>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [selectedWork, setSelectedWork] = useState<AdminGalleryWork | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [reasonKey, setReasonKey] = useState<ReasonTemplateKey | 'custom'>('remove_sensitive_words');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [saving, setSaving] = useState(false);

  const headers = useMemo<HeadersInit>(() => ({
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }), [accessToken]);

  const loadWorks = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        type,
      });
      if (activeSearch.trim()) params.set('q', activeSearch.trim());
      const res = await fetch(`/api/admin/gallery/works?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as GalleryWorksResponse;
      if (!res.ok) throw new Error(data.error || '加载画廊作品失败');

      const incoming = Array.isArray(data.works) ? data.works : [];
      setWorks(incoming);
      setTotal(Number(data.total || 0));
      const normalizedTotalPages = Math.max(1, Number(data.totalPages || 1));
      setTotalPages(normalizedTotalPages);
      if (page > normalizedTotalPages) setPage(normalizedTotalPages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载画廊作品失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeSearch, headers, page, pageSize, type]);

  useEffect(() => {
    void loadWorks();
  }, [loadWorks]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setActiveSearch(searchDraft.trim());
  }

  function openEditor(work: AdminGalleryWork) {
    setSelectedWork(work);
    setPromptDraft(work.prompt || '');
    const draft = defaultEmailDraft(work);
    setReasonKey('remove_sensitive_words');
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
    setEditOpen(true);
  }

  function openEmailDialog() {
    if (!selectedWork) return;
    if (!promptDraft.trim()) {
      toast.error('请填写新的提示词');
      return;
    }
    if (promptDraft.trim() === (selectedWork.prompt || '').trim()) {
      toast.error('提示词没有变化');
      return;
    }
    const draft = defaultEmailDraft(selectedWork);
    if (!emailSubject.trim()) setEmailSubject(draft.subject);
    if (!emailBody.trim()) setEmailBody(draft.body);
    setEditOpen(false);
    setEmailOpen(true);
  }

  function applyReasonTemplate(key: ReasonTemplateKey) {
    if (!selectedWork) return;
    const template = REASON_TEMPLATES.find(item => item.key === key);
    if (!template) return;
    const draft = buildEmailTemplate(selectedWork, template);
    setReasonKey(key);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
  }

  async function submitPromptUpdate() {
    if (!selectedWork) return;
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error('请填写邮件标题和正文');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/gallery/prompt', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          workId: selectedWork.id,
          prompt: promptDraft.trim(),
          emailSubject: emailSubject.trim(),
          emailBody: emailBody.trim(),
          reasonKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '修改提示词失败');

      const updated = data.work as AdminGalleryWork;
      setWorks(prev => prev.map(work => (work.id === updated.id ? { ...work, ...updated } : work)));
      toast.success('提示词已修改，通知邮件已发送');
      setEmailOpen(false);
      setSelectedWork(null);
      setPromptDraft('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '修改提示词失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>画廊管理</CardTitle>
          <CardDescription>管理公开画廊作品提示词；修改必须发送邮件通知作者。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between" onSubmit={submitSearch}>
            <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_140px]">
              <div className="space-y-2">
                <Label>搜索</Label>
                <div className="flex gap-2">
                  <Input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="作品 ID、提示词、作者邮箱或昵称"
                  />
                  <Button type="submit" variant="outline" className="shrink-0 gap-2">
                    <Search className="h-4 w-4" />
                    搜索
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>作品类型</Label>
                <Select value={type} onValueChange={(value) => { setType(value as GalleryFilterType); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>每页数量</Label>
                <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(value => (
                      <SelectItem key={value} value={String(value)}>{value} 条</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="button" variant="outline" className="gap-2" onClick={loadWorks} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              刷新
            </Button>
          </form>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">作品</th>
                  <th className="px-3 py-2 text-left font-medium">作者</th>
                  <th className="px-3 py-2 text-left font-medium">提示词</th>
                  <th className="px-3 py-2 text-left font-medium">公开时间</th>
                  <th className="px-3 py-2 text-left font-medium">热度</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-3 py-10 text-center text-muted-foreground" colSpan={6}>加载中...</td></tr>
                ) : works.length === 0 ? (
                  <tr><td className="px-3 py-10 text-center text-muted-foreground" colSpan={6}>暂无公开画廊作品</td></tr>
                ) : works.map(work => (
                  <tr key={work.id} className="border-t align-top">
                    <td className="px-3 py-3">
                      <div className="flex min-w-[220px] items-center gap-3">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                          {isVideoWork(work) && work.url ? (
                            <video src={work.url} className="h-full w-full object-cover" muted playsInline />
                          ) : work.thumbnailUrl || work.url ? (
                            <img src={work.thumbnailUrl || work.url || ''} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{TYPE_LABELS[work.type] || work.type}</Badge>
                            <span className="font-mono text-xs text-muted-foreground">{shortId(work.id)}</span>
                          </div>
                          <div className="mt-1 max-w-[220px] truncate font-medium">{work.title || '未命名作品'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-[220px]">
                        <div className="truncate font-medium">{work.authorNickname || '匿名用户'}</div>
                        <div className="truncate text-xs text-muted-foreground">{work.authorEmail || '-'}</div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="line-clamp-3 max-w-[380px] whitespace-pre-wrap text-muted-foreground">
                        {work.prompt || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{formatDateTime(work.publishedAt)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Eye className="h-4 w-4" />
                        {Number(work.likes || 0)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button size="sm" className="gap-2" onClick={() => openEditor(work)}>
                        <Edit3 className="h-4 w-4" />
                        编辑提示词
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>共 {total} 个公开作品，第 {page} / {totalPages} 页，当前显示 {works.length} 个</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>编辑公开提示词</DialogTitle>
            <DialogDescription>保存前必须填写通知邮件，邮件发送成功后才会修改提示词。</DialogDescription>
          </DialogHeader>
          {selectedWork && (
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
                  {isVideoWork(selectedWork) && selectedWork.url ? (
                    <video src={selectedWork.url} className="h-full w-full object-cover" muted playsInline controls />
                  ) : selectedWork.thumbnailUrl || selectedWork.url ? (
                    <img src={selectedWork.thumbnailUrl || selectedWork.url || ''} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="rounded-md border bg-muted/35 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{selectedWork.authorNickname || '匿名用户'}</div>
                  <div className="mt-1 break-all">{selectedWork.authorEmail || '-'}</div>
                  <div className="mt-2 font-mono">{selectedWork.id}</div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>原提示词</Label>
                  <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground">
                    <pre className="whitespace-pre-wrap font-sans">{selectedWork.prompt || '-'}</pre>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>新提示词</Label>
                  <Textarea
                    value={promptDraft}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    className="min-h-44"
                    placeholder="填写公开画廊中展示的新提示词"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={openEmailDialog} className="gap-2">
              <Mail className="h-4 w-4" />
              保存并通知用户
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>邮件通知用户</DialogTitle>
            <DialogDescription>选择内置原因或手写邮件内容。发送成功后才会完成提示词修改。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {REASON_TEMPLATES.map(template => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => applyReasonTemplate(template.key)}
                  className={`rounded-md border p-3 text-left transition-colors hover:bg-muted/60 ${
                    reasonKey === template.key ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="font-medium">{template.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <Label>邮件标题</Label>
              <Input
                value={emailSubject}
                onChange={(event) => { setEmailSubject(event.target.value); setReasonKey('custom'); }}
                placeholder="填写邮件标题"
              />
            </div>
            <div className="space-y-2">
              <Label>邮件正文</Label>
              <Textarea
                value={emailBody}
                onChange={(event) => { setEmailBody(event.target.value); setReasonKey('custom'); }}
                className="min-h-56"
                placeholder="填写邮件正文"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEmailOpen(false); setEditOpen(true); }} disabled={saving}>
              返回编辑
            </Button>
            <Button onClick={submitPromptUpdate} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送邮件并保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
