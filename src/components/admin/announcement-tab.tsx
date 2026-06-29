'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-store';
import { useAdminConfig, type CreditPricing } from '@/lib/admin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useSiteConfig } from '@/lib/site-config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, AlertTriangle, Calendar, Check, CheckCircle2, Coins, CreditCard, Crown, Database, Download, Edit3, FileUp, Gift, Globe, Loader2, Megaphone, Pencil, Plus, Receipt, Save, ToggleLeft, Trash2, Upload, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
// ============================================================
// Tab 5: Announcement Management
// ============================================================

interface ServerAnnouncement {
  id: string;
  title: string;
  content: string;
  start_date?: string | null;
  end_date?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  enabled?: boolean;
  is_active?: boolean;
  created_at: string;
}

function announcementStartDate(ann: ServerAnnouncement): string {
  return ann.start_date || ann.starts_at || '';
}

function announcementEndDate(ann: ServerAnnouncement): string {
  return ann.end_date || ann.expires_at || '';
}

function announcementEnabled(ann: ServerAnnouncement): boolean {
  return ann.enabled !== false && ann.is_active !== false;
}

function formatDateInputValue(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function AnnouncementTab() {
  const { accessToken } = useAuth();
  const [announcements, setAnnouncements] = useState<ServerAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [now, setNow] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNow(Date.now()); }, []);

  // Fetch announcements from server API
  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await fetch('/api/announcements');
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data || []);
      }
    } catch (err) {
      console.error('[AnnouncementTab] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const resetForm = () => {
    setFormTitle('');
    setFormContent('');
    setFormStartDate('');
    setFormEndDate('');
    setFormEnabled(true);
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (ann: ServerAnnouncement) => {
    setEditingId(ann.id);
    setFormTitle(ann.title);
    setFormContent(ann.content);
    setFormStartDate(formatDateInputValue(announcementStartDate(ann)));
    setFormEndDate(formatDateInputValue(announcementEndDate(ann)));
    setFormEnabled(announcementEnabled(ann));
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error('请填写公告标题和内容');
      return;
    }
    if (!formStartDate || !formEndDate) {
      toast.error('请设置有效期');
      return;
    }

    setSaving(true);
    try {
      const body = {
        title: formTitle.trim(),
        content: formContent.trim(),
        startDate: new Date(formStartDate).toISOString(),
        endDate: new Date(formEndDate).toISOString(),
        enabled: formEnabled,
      };

      let res: Response;
      if (editingId) {
        res = await fetch('/api/announcements', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ id: editingId, ...body }),
        });
      } else {
        res = await fetch('/api/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        toast.success(editingId ? '公告已更新' : '公告已创建');
        resetForm();
        fetchAnnouncements();
      } else {
        const err = await res.json();
        toast.error(err.error || '操作失败');
      }
    } catch {
      toast.error('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (res.ok) {
        toast.success('公告已删除');
        fetchAnnouncements();
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('网络错误，请重试');
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/announcements', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ id, enabled }),
      });
      if (res.ok) {
        fetchAnnouncements();
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const isActive = (ann: ServerAnnouncement) => {
    if (!announcementEnabled(ann)) return false;
    if (!now) return false;
    const startValue = announcementStartDate(ann);
    const endValue = announcementEndDate(ann);
    const start = startValue ? new Date(startValue).getTime() : 0;
    const endDate = endValue ? new Date(endValue) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999);
    const end = endDate ? endDate.getTime() : Number.POSITIVE_INFINITY;
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return now >= start && now <= end;
  };

  const getStatusBadge = (ann: ServerAnnouncement) => {
    if (isActive(ann)) return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">生效中</Badge>;
    if (!announcementEnabled(ann)) return <Badge variant="secondary">已禁用</Badge>;
    const startValue = announcementStartDate(ann);
    if (now && startValue && now < new Date(startValue).getTime()) return <Badge variant="outline">待生效</Badge>;
    return <Badge variant="secondary">已过期</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          加载中...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-primary" />
                公告管理
              </CardTitle>
              <CardDescription>创建和管理首页弹窗公告，可设置有效期，所有访客可见</CardDescription>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="h-3.5 w-3.5" />
              新建公告
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {announcements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无公告</p>
            </div>
          ) : (
            announcements.map(ann => (
              <div key={ann.id} className="flex items-start gap-4 p-4 rounded-lg border border-border">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isActive(ann) ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Megaphone className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">{ann.title}</span>
                    {getStatusBadge(ann)}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{ann.content}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {announcementStartDate(ann) ? new Date(announcementStartDate(ann)).toLocaleDateString('zh-CN') : '立即'} - {announcementEndDate(ann) ? new Date(announcementEndDate(ann)).toLocaleDateString('zh-CN') : '长期'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={announcementEnabled(ann)}
                    onCheckedChange={(checked) => handleToggleEnabled(ann.id, checked)}
                  />
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleEdit(ann)}>
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(ann.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? '编辑公告' : '新建公告'}</CardTitle>
            <CardDescription>设置公告标题、内容和有效期</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>公告标题</Label>
              <Input
                placeholder="例如：系统维护通知"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>公告内容</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={!previewMode ? 'default' : 'outline'}
                    className="h-7 text-xs px-2"
                    onClick={() => setPreviewMode(false)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={previewMode ? 'default' : 'outline'}
                    className="h-7 text-xs px-2"
                    onClick={() => setPreviewMode(true)}
                  >
                    预览
                  </Button>
                </div>
              </div>
              {previewMode ? (
                <div className="announcement-markdown rounded-md border border-input bg-background p-3 min-h-[100px] max-h-[300px] overflow-y-auto">
                  {formContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{formContent}</ReactMarkdown>
                  ) : (
                    <p className="text-sm text-muted-foreground">暂无内容，请先在编辑模式输入</p>
                  )}
                </div>
              ) : (
                <Textarea
                  placeholder="支持 Markdown 格式，例如：&#10;## 标题&#10;**加粗** *斜体* ~~删除线~~&#10;- 列表项&#10;[链接文字](URL)&#10;> 引用&#10;`行内代码` ```代码块```"
                  rows={8}
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                />
              )}
              <p className="text-xs text-muted-foreground">支持完整 Markdown 语法：标题、加粗、斜体、列表、链接、引用、代码块、表格等</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>开始时间</Label>
                <Input
                  type="datetime-local"
                  value={formStartDate}
                  onChange={e => setFormStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>结束时间</Label>
                <Input
                  type="datetime-local"
                  value={formEndDate}
                  onChange={e => setFormEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              <Label>创建后立即启用</Label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? '保存中...' : editingId ? '保存修改' : '创建公告'}
              </Button>
              <Button size="sm" variant="outline" onClick={resetForm}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
