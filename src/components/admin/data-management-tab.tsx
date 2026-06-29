'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
import { getClientAuthHeaders } from '@/lib/client-auth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, AlertTriangle, Calendar, Check, CheckCircle2, Coins, CreditCard, Crown, Database, Download, Edit3, FileUp, Gift, Globe, Loader2, Megaphone, Pencil, Plus, Receipt, Save, ToggleLeft, Trash2, Upload, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
// ============================================================
// Data Management Tab — Export / Import
// ============================================================

interface ImportTableResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const MAX_IMPORT_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_IMPORT_FILE_LABEL = '1GB';

function getAdminAuthHeaders(): HeadersInit {
  return getClientAuthHeaders();
}

export default function DataManagementTab() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<Record<string, ImportTableResult> | null>(null);
  const [skipAuth, setSkipAuth] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/admin/data-export', {
        headers: getAdminAuthHeaders(),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '导出失败' }));
        throw new Error(errData.error || '导出失败');
      }
      const data = await res.json();

      // Create downloadable JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.href = url;
      link.download = `miaojing-backup-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`数据导出成功，共 ${Object.values(data._meta.counts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)} 条记录`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.length) {
      toast.error('请选择要导入的备份文件');
      return;
    }

    const file = fileInput.files[0];
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      toast.error(`文件大小不能超过 ${MAX_IMPORT_FILE_LABEL}`);
      return;
    }

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('文件格式错误：无法解析 JSON');
      }

      const res = await fetch('/api/admin/data-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({
          ...data,
          options: { skipAuth },
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '导入失败');

      setImportResult(result.details || {});
      const totalImported = Object.values(result.details || {}).reduce(
        (sum: number, r: unknown) => sum + ((r as ImportTableResult).imported || 0), 0
      );
      const deduped = (result.details?.dedupe_works as ImportTableResult | undefined)?.skipped || 0;
      toast.success(`数据导入完成，共导入 ${totalImported} 条记录${deduped > 0 ? `，合并重复作品 ${deduped} 条` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            数据导出
          </CardTitle>
          <CardDescription>
            一键导出平台业务数据和本地媒体文件，生成可迁移恢复的 JSON 备份文件
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <p className="text-sm font-medium">导出内容包括：</p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li>用户资料 (profiles) + 认证账号 (auth_users)</li>
              <li>创作作品 (works) + 点赞记录 (work_likes)</li>
              <li>作品、参考图、Logo、站点图标等本地媒体文件 (_media)</li>
              <li>积分记录 (credit_transactions) + 订单 (orders)</li>
              <li>用户 API 密钥 (user_api_keys)</li>
              <li>公告 (announcements) + 网站配置 (site_config) + 访问统计 (site_stats)</li>
            </ul>
          </div>
          <Button onClick={handleExport} disabled={exporting} className="gap-1.5">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? '导出中...' : '导出全部数据'}
          </Button>
        </CardContent>
      </Card>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            数据导入
          </CardTitle>
          <CardDescription>
            从备份文件恢复数据到当前平台，或迁移到新平台。导入会在事务内合并记录、还原媒体，并按来源 URL/媒体哈希合并重复作品
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-sm font-medium">注意事项</p>
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>导入将合并数据，不会删除已有记录（upsert 模式）</li>
              <li>新版导出文件会包含 _media，可完整恢复画廊图片、创作历史图片和站点图片</li>
              <li>旧版导出文件不含 _media 时，只能恢复数据库记录；如媒体文件未同步，画廊图片仍可能无法显示</li>
              <li>新平台的数据库需先运行初始化脚本 (init-database.sql)</li>
              <li>认证账号会自动创建，密码为随机临时密码，用户需通过管理员重置</li>
              <li>如新平台已有相同邮箱的用户，将更新其信息而非重复创建</li>
              <li>大型数据集导入可能需要较长时间，请耐心等待</li>
            </ul>
          </div>

          {/* File input */}
          <div className="space-y-2">
            <Label>选择备份文件</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-primary/10 file:text-primary
                hover:file:bg-primary/20
                file:cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">仅支持 .json 格式，文件大小不超过 {MAX_IMPORT_FILE_LABEL}</p>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
            <Switch
              id="skip-auth"
              checked={skipAuth}
              onCheckedChange={setSkipAuth}
            />
            <div>
              <Label htmlFor="skip-auth" className="cursor-pointer">跳过认证账号导入</Label>
              <p className="text-xs text-muted-foreground">仅导入 profiles 数据，不创建 auth 账号（用户需自行注册后关联）</p>
            </div>
          </div>

          <Button onClick={handleImport} disabled={importing} className="gap-1.5">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {importing ? '导入中...' : '开始导入'}
          </Button>

          {/* Import Result */}
          {importResult && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <p className="text-sm font-medium">导入结果</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(importResult).map(([table, r]) => (
                  <div key={table} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                    <span className="text-muted-foreground">{table}</span>
                    <span className="font-medium">
                      {r.imported > 0 && <span className="text-emerald-600">{r.imported} 导入</span>}
                      {r.skipped > 0 && <span className="text-amber-600 ml-2">{r.skipped} {table === 'dedupe_works' ? '合并' : '跳过'}</span>}
                      {r.imported === 0 && r.skipped === 0 && <span className="text-muted-foreground">无数据</span>}
                    </span>
                  </div>
                ))}
              </div>
              {/* Show errors if any */}
              {Object.entries(importResult).some(([, r]) => r.errors.length > 0) && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-600">部分记录导入失败：</p>
                  <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-0.5">
                    {Object.entries(importResult).map(([table, r]) =>
                      r.errors.map((err, i) => (
                        <div key={`${table}-${i}`} className="flex gap-1">
                          <AlertCircle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                          <span>{err}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Admin Stats Bar
// ============================================================
