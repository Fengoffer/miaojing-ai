'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useSiteConfig } from '@/lib/site-config';
import { useAuth } from '@/lib/auth-store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, CheckCircle2, Crown, Eye, Globe, Image, LayoutTemplate, Loader2, Logs, Mail, RefreshCw, Save, Send, ToggleLeft, Upload } from 'lucide-react';
import { toast } from 'sonner';
// ============================================================
// Tab 6: Settings
// ============================================================

type EmailSettingsForm = {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpPasswordPreview: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  appName: string;
  appBaseUrl: string;
  logoUrl: string;
  contactEmail: string;
  copyright: string;
  codeLength: number;
  codeCharset: 'alphanumeric' | 'numeric' | 'letters';
  codeTtlMinutes: number;
};

type EmailRecipient = {
  id: string;
  email: string;
  nickname: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
};

type EmailSendFailure = {
  id: string;
  email: string;
  recipientUserId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type EmailSendBatch = {
  id: string;
  mode: 'selected' | 'all';
  mailKind: 'notification' | 'admin';
  title: string;
  subject: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  failed: EmailSendFailure[];
};

type SettingsSection = 'site' | 'footer' | 'logs' | 'email' | 'mail' | 'features';

const DEFAULT_EMAIL_SETTINGS: EmailSettingsForm = {
  enabled: false,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  smtpPasswordPreview: '****',
  fromEmail: '',
  fromName: '妙境官方通知',
  replyTo: '',
  appName: '妙境',
  appBaseUrl: '',
  logoUrl: '/logo.png',
  contactEmail: '',
  copyright: '',
  codeLength: 6,
  codeCharset: 'alphanumeric',
  codeTtlMinutes: 5,
};

function formatEmailBatchTime(value: string | null): string {
  if (!value) return '进行中';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function emailBatchStatusLabel(batch: EmailSendBatch): string {
  if (batch.status === 'completed') return '全部成功';
  if (batch.status === 'failed') return '全部失败';
  if (batch.status === 'completed_with_errors') return '部分失败';
  return '发送中';
}

function SectionMenu<T extends string>({
  items,
  activeValue,
  onChange,
}: {
  items: Array<{ value: T; label: string; description?: string }>;
  activeValue: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-1">
      <div className="flex min-w-max gap-1">
        {items.map(item => {
          const active = activeValue === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`min-w-40 rounded-md px-4 py-3 text-left transition-colors ${
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              {item.description && <span className="mt-1 block text-xs opacity-75">{item.description}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SettingsTab() {
  const { config: siteConfig, loaded: siteConfigLoaded, saveSiteConfig } = useSiteConfig();
  const { accessToken } = useAuth();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const mailMarkdownImageInputRef = useRef<HTMLInputElement>(null);
  const mailPureImageInputRef = useRef<HTMLInputElement>(null);

  // Local form state (not committed until save)
  const [formSiteName, setFormSiteName] = useState('');
  const [formTabTitle, setFormTabTitle] = useState('');
  const [formLogoBase64, setFormLogoBase64] = useState<string | null>(null);
  const [formFaviconBase64, setFormFaviconBase64] = useState<string | null>(null);
  const [formMembershipEnabled, setFormMembershipEnabled] = useState(true);
  const [formTermsOfService, setFormTermsOfService] = useState('');
  const [formPrivacyPolicy, setFormPrivacyPolicy] = useState('');
  const [formAboutUs, setFormAboutUs] = useState('');
  const [formHelpCenter, setFormHelpCenter] = useState('');
  const [formFilingInfo, setFormFilingInfo] = useState('');
  const [formFilingUrl, setFormFilingUrl] = useState('');
  const [formPublicSecurityFilingInfo, setFormPublicSecurityFilingInfo] = useState('');
  const [formPublicSecurityFilingUrl, setFormPublicSecurityFilingUrl] = useState('');
  const [formLogRetentionDays, setFormLogRetentionDays] = useState(30);
  const [formImageCompositionSkillEnabled, setFormImageCompositionSkillEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [emailSettings, setEmailSettings] = useState<EmailSettingsForm>(DEFAULT_EMAIL_SETTINGS);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [mailMode, setMailMode] = useState<'all' | 'selected'>('selected');
  const [mailKind, setMailKind] = useState<'notification' | 'admin'>('notification');
  const [mailTitle, setMailTitle] = useState('');
  const [mailContentMode, setMailContentMode] = useState<'markdown' | 'image'>('markdown');
  const [mailContent, setMailContent] = useState('');
  const [mailPreviewMode, setMailPreviewMode] = useState(false);
  const [mailImageUrl, setMailImageUrl] = useState('');
  const [mailPureImageUrl, setMailPureImageUrl] = useState('');
  const [mailPureImageAlt, setMailPureImageAlt] = useState('');
  const [mailMarkdownImageUploading, setMailMarkdownImageUploading] = useState(false);
  const [mailPureImageUploading, setMailPureImageUploading] = useState(false);
  const [mailButtonText, setMailButtonText] = useState('');
  const [mailButtonUrl, setMailButtonUrl] = useState('');
  const [activeMailBatchId, setActiveMailBatchId] = useState<string | null>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [recipientResults, setRecipientResults] = useState<EmailRecipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<EmailRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [mailSending, setMailSending] = useState(false);
  const [mailHistoryLoading, setMailHistoryLoading] = useState(false);
  const [mailBatches, setMailBatches] = useState<EmailSendBatch[]>([]);
  const [activeSection, setActiveSection] = useState<SettingsSection>('site');

  // Sync site config to form when loaded
  useEffect(() => {
    if (siteConfigLoaded && !initialized) {
      setFormSiteName(siteConfig.siteName);
      setFormTabTitle(siteConfig.siteTabTitle);
      setFormTermsOfService(siteConfig.termsOfService);
      setFormPrivacyPolicy(siteConfig.privacyPolicy);
      setFormAboutUs(siteConfig.aboutUs);
      setFormHelpCenter(siteConfig.helpCenter);
      setFormFilingInfo(siteConfig.filingInfo);
      setFormFilingUrl(siteConfig.filingUrl);
      setFormPublicSecurityFilingInfo(siteConfig.publicSecurityFilingInfo);
      setFormPublicSecurityFilingUrl(siteConfig.publicSecurityFilingUrl);
      setFormLogRetentionDays(siteConfig.logRetentionDays);
      setFormImageCompositionSkillEnabled(siteConfig.imageCompositionSkillEnabled);
      setInitialized(true);
    }
  }, [siteConfig, siteConfigLoaded, initialized]);

  useEffect(() => {
    setFormMembershipEnabled(siteConfig.membershipEnabled !== false);
  }, [siteConfig.membershipEnabled]);

  useEffect(() => {
    setFormImageCompositionSkillEnabled(siteConfig.imageCompositionSkillEnabled === true);
  }, [siteConfig.imageCompositionSkillEnabled]);

  const loadEmailSettings = useCallback(async () => {
    if (!accessToken) return;
    setEmailLoading(true);
    try {
      const response = await fetch('/api/admin/email-settings', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '邮箱配置加载失败');
      setEmailSettings({ ...DEFAULT_EMAIL_SETTINGS, ...(data.settings || {}), smtpPassword: '' });
      setEmailPreviewHtml(data.preview || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮箱配置加载失败');
    } finally {
      setEmailLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadEmailSettings();
  }, [loadEmailSettings]);

  const loadEmailRecipients = useCallback(async (query = '') => {
    if (!accessToken) return;
    setRecipientsLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      params.set('limit', '40');
      const response = await fetch(`/api/admin/email-recipients?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '收件用户加载失败');
      setRecipientResults(Array.isArray(data.users) ? data.users : []);
      setRecipientTotal(Number(data.total || 0));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '收件用户加载失败');
    } finally {
      setRecipientsLoading(false);
    }
  }, [accessToken]);

  const loadEmailSendHistory = useCallback(async () => {
    if (!accessToken) return;
    setMailHistoryLoading(true);
    try {
      const response = await fetch('/api/admin/send-email?limit=12&logLimit=300', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '邮件发送记录加载失败');
      setMailBatches(Array.isArray(data.batches) ? data.batches : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮件发送记录加载失败');
    } finally {
      setMailHistoryLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (mailMode !== 'selected') return;
    const timer = window.setTimeout(() => {
      loadEmailRecipients(recipientQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mailMode, recipientQuery, loadEmailRecipients]);

  useEffect(() => {
    if (mailMode === 'all') {
      loadEmailRecipients('');
    }
  }, [mailMode, loadEmailRecipients]);

  useEffect(() => {
    if (activeSection === 'mail') {
      loadEmailSendHistory();
    }
  }, [activeSection, loadEmailSendHistory]);

  useEffect(() => {
    if (!activeMailBatchId || activeSection !== 'mail') return;
    const batch = mailBatches.find(item => item.id === activeMailBatchId);
    if (batch && batch.status !== 'sending') {
      setActiveMailBatchId(null);
      return;
    }
    const timer = window.setTimeout(() => {
      loadEmailSendHistory();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [activeMailBatchId, activeSection, mailBatches, loadEmailSendHistory]);

  const handleFileUpload = async (
    file: File,
    setter: (val: string | null) => void,
    maxSizeKB: number = 2048,
    targetSize: number = 64,
  ) => {
    if (file.size > maxSizeKB * 1024) {
      toast.error(`文件大小不能超过 ${maxSizeKB >= 1024 ? `${maxSizeKB / 1024}MB` : `${maxSizeKB}KB`}`);
      return;
    }

    // SVG: read as text data URL directly
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) setter(result);
      };
      reader.readAsDataURL(file);
      return;
    }

    // PNG/JPG: resize to target dimensions
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) { toast.error('浏览器不支持 Canvas'); return; }
      ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
      bitmap.close();
      setter(canvas.toDataURL('image/png'));
    } catch {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) setter(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSiteConfig({
        siteName: formSiteName,
        siteTabTitle: formTabTitle,
        logoBase64: formLogoBase64 || undefined,
        faviconBase64: formFaviconBase64 || undefined,
        membershipEnabled: formMembershipEnabled,
        termsOfService: formTermsOfService,
        privacyPolicy: formPrivacyPolicy,
        aboutUs: formAboutUs,
        helpCenter: formHelpCenter,
        filingInfo: formFilingInfo,
        filingUrl: formFilingUrl,
        publicSecurityFilingInfo: formPublicSecurityFilingInfo,
        publicSecurityFilingUrl: formPublicSecurityFilingUrl,
        logRetentionDays: formLogRetentionDays,
        imageCompositionSkillEnabled: formImageCompositionSkillEnabled,
      });
      // Clear pending uploads after save
      setFormLogoBase64(null);
      setFormFaviconBase64(null);
      toast.success('网站配置已保存，所有访客将看到更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleMembershipToggle = async (checked: boolean) => {
    setFormMembershipEnabled(checked);
    try {
      await saveSiteConfig({ membershipEnabled: checked });
      toast.success(checked ? '会员功能已开启' : '会员功能已关闭');
    } catch (err) {
      setFormMembershipEnabled(!checked);
      toast.error(err instanceof Error ? err.message : '会员功能保存失败');
    }
  };

  const handleImageCompositionSkillToggle = async (checked: boolean) => {
    setFormImageCompositionSkillEnabled(checked);
    try {
      await saveSiteConfig({ imageCompositionSkillEnabled: checked });
      toast.success(checked ? '构图优化 Skill 已开启' : '构图优化 Skill 已关闭');
    } catch (err) {
      setFormImageCompositionSkillEnabled(!checked);
      toast.error(err instanceof Error ? err.message : '构图优化 Skill 保存失败');
    }
  };

  const handleEmailSettingChange = <K extends keyof EmailSettingsForm>(key: K, value: EmailSettingsForm[K]) => {
    setEmailSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveEmailSettings = async () => {
    if (!accessToken) return;
    setEmailSaving(true);
    try {
      const payload = {
        ...emailSettings,
        smtpPassword: emailSettings.smtpPassword || undefined,
      };
      const response = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '邮箱配置保存失败');
      setEmailSettings({ ...DEFAULT_EMAIL_SETTINGS, ...(data.settings || {}), smtpPassword: '' });
      toast.success(data.message || '邮箱配置已保存');
      loadEmailSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮箱配置保存失败');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!accessToken) return;
    if (!testEmail) {
      toast.error('请填写测试收件邮箱');
      return;
    }
    setEmailTesting(true);
    try {
      const response = await fetch('/api/admin/email-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '测试邮件发送失败');
      toast.success(data.message || '测试邮件已发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '测试邮件发送失败');
    } finally {
      setEmailTesting(false);
    }
  };

  const selectedRecipientIds = useMemo(
    () => new Set(selectedRecipients.map(user => user.id)),
    [selectedRecipients],
  );

  const toggleRecipient = (user: EmailRecipient) => {
    setSelectedRecipients(prev => {
      if (prev.some(item => item.id === user.id)) {
        return prev.filter(item => item.id !== user.id);
      }
      return [...prev, user];
    });
  };

  const insertMailImageIntoMarkdown = (url: string, alt = '邮件图片') => {
    setMailContent(prev => {
      const prefix = prev.trim() ? `${prev.replace(/\s*$/, '')}\n\n` : '';
      return `${prefix}![${alt}](${url})\n`;
    });
  };

  const handleInsertMailImage = () => {
    const url = mailImageUrl.trim();
    if (!url) {
      toast.error('请填写图片地址');
      return;
    }
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(url) && !/^\/[^\s"'<>]+$/.test(url)) {
      toast.error('图片地址需使用 HTTP(S) 或站内 / 开头路径');
      return;
    }
    insertMailImageIntoMarkdown(url);
    setMailImageUrl('');
    setMailPreviewMode(false);
  };

  const handleUploadMailImage = async (file: File, target: 'markdown' | 'pure') => {
    if (!accessToken) return;
    const setUploading = target === 'markdown' ? setMailMarkdownImageUploading : setMailPureImageUploading;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/admin/email-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '图片上传失败');
      const url = typeof data.url === 'string' ? data.url : '';
      if (!url) throw new Error('图片上传后没有返回可用地址');
      const alt = file.name.replace(/\.[^.]+$/, '').trim() || '邮件图片';
      if (target === 'markdown') {
        insertMailImageIntoMarkdown(url, alt);
        setMailPreviewMode(false);
      } else {
        setMailPureImageUrl(url);
        setMailPureImageAlt(prev => prev || alt);
      }
      toast.success('图片已上传');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSendUserEmail = async () => {
    if (!accessToken) return;
    if (!mailTitle.trim() || (mailContentMode === 'markdown' && !mailContent.trim())) {
      toast.error('请填写邮件标题和正文内容');
      return;
    }
    if (mailContentMode === 'image' && !mailPureImageUrl.trim()) {
      toast.error('请填写纯图片邮件的图片地址');
      return;
    }
    if (mailContentMode === 'image' && !/^https?:\/\/[^\s"'<>]+$/i.test(mailPureImageUrl.trim()) && !/^\/[^\s"'<>]+$/.test(mailPureImageUrl.trim())) {
      toast.error('图片地址需使用 HTTP(S) 或站内 / 开头路径');
      return;
    }
    if (mailMode === 'selected' && selectedRecipients.length === 0) {
      toast.error('请至少选择一个收件用户');
      return;
    }

    const confirmed = window.confirm(
      mailMode === 'all'
        ? `确定要发送给全部 ${recipientTotal || '非管理员'} 用户吗？`
        : `确定要发送给 ${selectedRecipients.length} 个指定用户吗？`,
    );
    if (!confirmed) return;

    setMailSending(true);
    try {
      const response = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          mode: mailMode,
          userIds: mailMode === 'selected' ? selectedRecipients.map(user => user.id) : undefined,
          mailKind,
          title: mailTitle,
          contentMode: mailContentMode,
          content: mailContentMode === 'markdown' ? mailContent : undefined,
          imageUrl: mailContentMode === 'image' ? mailPureImageUrl.trim() : undefined,
          imageAlt: mailContentMode === 'image' ? mailPureImageAlt.trim() || mailTitle.trim() : undefined,
          buttonText: mailButtonText || undefined,
          buttonUrl: mailButtonUrl || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.batchId) throw new Error(data.error || data.message || '邮件发送失败');
      if (data.status === 'sending') {
        toast.success(data.message || '邮件已开始发送，请在发送记录查看进度');
      } else if (data.failedCount) {
        toast.error(data.message || '邮件发送存在失败，请查看发送记录');
      } else {
        toast.success(data.message || '邮件已发送');
      }
      if (data.batchId) {
        setActiveMailBatchId(data.batchId);
        await loadEmailSendHistory();
      }
      if (!response.ok) return;
      if (data.status === 'sending' || !data.failedCount) {
        setMailTitle('');
        setMailContent('');
        setMailContentMode('markdown');
        setMailPureImageUrl('');
        setMailPureImageAlt('');
        setMailButtonText('');
        setMailButtonUrl('');
        setSelectedRecipients([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮件发送失败');
    } finally {
      setMailSending(false);
    }
  };

  const currentLogoSrc = formLogoBase64 || siteConfig.logoUrl || '/logo.png';
  const currentFaviconSrc = formFaviconBase64 || siteConfig.faviconUrl || '/favicon.png';

  return (
    <div className="space-y-6">
      <SectionMenu
        items={[
          { value: 'site', label: '网站配置', description: '名称、Logo、备案' },
          { value: 'footer', label: '页脚页面', description: '关于、条款、隐私、帮助' },
          { value: 'logs', label: '日志设置', description: `保存 ${formLogRetentionDays} 天` },
          { value: 'email', label: '邮箱服务', description: emailSettings.enabled ? '已启用' : '未启用' },
          { value: 'mail', label: '用户邮件', description: mailMode === 'all' ? '全部用户' : `${selectedRecipients.length} 个收件人` },
          { value: 'features', label: '功能开关', description: formImageCompositionSkillEnabled ? '构图 Skill 开启' : formMembershipEnabled ? '会员功能开启' : '会员功能关闭' },
        ]}
        activeValue={activeSection}
        onChange={setActiveSection}
      />

      {/* Site Config */}
      {activeSection === 'site' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            网站配置
          </CardTitle>
          <CardDescription>自定义网站名称、Logo 和浏览器标签页图标，保存后所有访客可见</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Site Name */}
          <div className="space-y-2">
            <Label>网站名称</Label>
            <p className="text-xs text-muted-foreground">显示在导航栏、首页标题等位置</p>
            <Input
              value={formSiteName}
              onChange={e => setFormSiteName(e.target.value)}
              placeholder="妙境"
            />
          </div>

          {/* Browser Tab Title */}
          <div className="space-y-2">
            <Label>浏览器标签页标题</Label>
            <p className="text-xs text-muted-foreground">显示在浏览器标签页上的文字</p>
            <Input
              value={formTabTitle}
              onChange={e => setFormTabTitle(e.target.value)}
              placeholder="妙境 - AI创作平台"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>备案信息</Label>
              <p className="text-xs text-muted-foreground">显示在网站页脚，例如：京ICP备XXXXXXXX号</p>
              <Input
                value={formFilingInfo}
                onChange={e => setFormFilingInfo(e.target.value)}
                placeholder="京ICP备XXXXXXXX号"
              />
            </div>
            <div className="space-y-2">
              <Label>备案跳转地址</Label>
              <p className="text-xs text-muted-foreground">留空则备案信息仅展示不可点击</p>
              <Input
                value={formFilingUrl}
                onChange={e => setFormFilingUrl(e.target.value)}
                placeholder="https://beian.miit.gov.cn/"
            />
          </div>
        </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>公安备案信息</Label>
              <p className="text-xs text-muted-foreground">显示在网站页脚，例如：京公网安备 XXXXXXXXXXXXXX号</p>
              <Input
                value={formPublicSecurityFilingInfo}
                onChange={e => setFormPublicSecurityFilingInfo(e.target.value)}
                placeholder="京公网安备 XXXXXXXXXXXXXX号"
              />
            </div>
            <div className="space-y-2">
              <Label>公安备案跳转地址</Label>
              <p className="text-xs text-muted-foreground">留空则公安备案信息仅展示不可点击</p>
              <Input
                value={formPublicSecurityFilingUrl}
                onChange={e => setFormPublicSecurityFilingUrl(e.target.value)}
                placeholder="https://www.beian.gov.cn/portal/registerSystemInfo"
              />
            </div>
          </div>

          {/* Logo Upload */}
          <div className="space-y-2">
            <Label>网站 Logo</Label>
            <p className="text-xs text-muted-foreground">
              支持 PNG / JPG / SVG 格式，建议尺寸 64×64px，正方形，最大 2MB
            </p>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-lg border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                <img src={currentLogoSrc} alt="Logo" className="h-full w-full object-contain" />
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, setFormLogoBase64, 2048, 64);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  上传 Logo
                </Button>
              </div>
            </div>
          </div>

          {/* Favicon Upload */}
          <div className="space-y-2">
            <Label>浏览器标签页图标 (Favicon)</Label>
            <p className="text-xs text-muted-foreground">
              支持 PNG / JPG / SVG 格式，建议尺寸 32×32px 或 64×64px，正方形，最大 1MB
            </p>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                <img src={currentFaviconSrc} alt="Favicon" className="h-full w-full object-contain" />
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, setFormFaviconBase64, 1024, 32);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => faviconInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  上传图标
                </Button>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存网站配置'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {activeSection === 'footer' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            页脚页面
          </CardTitle>
          <CardDescription>配置首页右下角“关于我们、使用条款、隐私政策、帮助中心”对应页面内容</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>关于我们</Label>
              <Textarea
                value={formAboutUs}
                onChange={e => setFormAboutUs(e.target.value)}
                placeholder="请输入关于我们页面内容"
                className="min-h-64 resize-y"
              />
            </div>
            <div className="space-y-2">
              <Label>帮助中心</Label>
              <Textarea
                value={formHelpCenter}
                onChange={e => setFormHelpCenter(e.target.value)}
                placeholder="请输入帮助中心页面内容"
                className="min-h-64 resize-y"
              />
            </div>
            <div className="space-y-2">
              <Label>使用条款</Label>
              <p className="text-xs text-muted-foreground">同时用于注册前必须阅读的服务条款弹窗</p>
              <Textarea
                value={formTermsOfService}
                onChange={e => setFormTermsOfService(e.target.value)}
                placeholder="请输入使用条款内容"
                className="min-h-64 resize-y"
              />
            </div>
            <div className="space-y-2">
              <Label>隐私政策</Label>
              <p className="text-xs text-muted-foreground">同时用于注册前必须阅读的隐私政策弹窗</p>
              <Textarea
                value={formPrivacyPolicy}
                onChange={e => setFormPrivacyPolicy(e.target.value)}
                placeholder="请输入隐私政策内容"
                className="min-h-64 resize-y"
              />
            </div>
          </div>
          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存页脚页面'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {activeSection === 'logs' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Logs className="h-5 w-5 text-primary" />
            日志设置
          </CardTitle>
          <CardDescription>配置平台日志的自动保存时间，最长 90 天，到期后系统会自动删除过期日志</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-md space-y-2">
            <Label>日志保存时间（天）</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={formLogRetentionDays}
              onChange={e => setFormLogRetentionDays(Math.min(90, Math.max(1, Number(e.target.value || 30))))}
            />
            <p className="text-xs text-muted-foreground">保存后会同步影响管理后台“系统日志”页面的自动清理策略。</p>
          </div>
          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存日志设置'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Email SMTP Config */}
      {activeSection === 'email' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            火山引擎域名邮箱
          </CardTitle>
          <CardDescription>配置 service@你的火山引擎托管域名.com 这类发件邮箱，用于注册验证、找回密码和系统通知</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium text-sm">启用邮箱服务</p>
              <p className="text-xs text-muted-foreground">关闭后不会发送验证码邮件，新用户注册验证码会不可用。</p>
            </div>
            <Switch
              checked={emailSettings.enabled}
              onCheckedChange={(checked) => handleEmailSettingChange('enabled', checked)}
              disabled={emailLoading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP 地址</Label>
              <Input value={emailSettings.smtpHost} onChange={e => handleEmailSettingChange('smtpHost', e.target.value)} placeholder="smtp.your-domain.com / smtp.exmail.qq.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP 端口</Label>
              <Input type="number" value={emailSettings.smtpPort} onChange={e => handleEmailSettingChange('smtpPort', Number(e.target.value) || 465)} placeholder="465" />
            </div>
            <div className="space-y-2">
              <Label>SMTP 账号</Label>
              <Input value={emailSettings.smtpUser} onChange={e => handleEmailSettingChange('smtpUser', e.target.value)} placeholder="service@your-domain.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP 授权码</Label>
              <Input
                type="password"
                value={emailSettings.smtpPassword}
                onChange={e => handleEmailSettingChange('smtpPassword', e.target.value)}
                placeholder={emailSettings.smtpPasswordPreview ? `已保存：${emailSettings.smtpPasswordPreview}` : '输入授权码'}
              />
              <p className="text-xs text-muted-foreground">授权码会加密存储；留空表示不修改已保存授权码。</p>
            </div>
            <div className="space-y-2">
              <Label>发件人邮箱</Label>
              <Input value={emailSettings.fromEmail} onChange={e => handleEmailSettingChange('fromEmail', e.target.value)} placeholder="service@your-domain.com" />
            </div>
            <div className="space-y-2">
              <Label>发件人名称</Label>
              <Input value={emailSettings.fromName} onChange={e => handleEmailSettingChange('fromName', e.target.value)} placeholder="妙境官方通知" />
            </div>
            <div className="space-y-2">
              <Label>回复邮箱</Label>
              <Input value={emailSettings.replyTo} onChange={e => handleEmailSettingChange('replyTo', e.target.value)} placeholder="support@your-domain.com" />
            </div>
            <div className="space-y-2">
              <Label>应用访问地址</Label>
              <Input value={emailSettings.appBaseUrl} onChange={e => handleEmailSettingChange('appBaseUrl', e.target.value)} placeholder="http://192.168.217.130:5000" />
            </div>
            <div className="space-y-2">
              <Label>邮件 Logo 地址</Label>
              <Input value={emailSettings.logoUrl} onChange={e => handleEmailSettingChange('logoUrl', e.target.value)} placeholder="/logo.png" />
            </div>
            <div className="space-y-2">
              <Label>联系邮箱</Label>
              <Input value={emailSettings.contactEmail} onChange={e => handleEmailSettingChange('contactEmail', e.target.value)} placeholder="support@your-domain.com" />
            </div>
            <div className="space-y-2">
              <Label>验证码位数</Label>
              <Input type="number" min={4} max={10} value={emailSettings.codeLength} onChange={e => handleEmailSettingChange('codeLength', Number(e.target.value) || 6)} />
            </div>
            <div className="space-y-2">
              <Label>验证码有效期（分钟）</Label>
              <Input type="number" min={1} max={30} value={emailSettings.codeTtlMinutes} onChange={e => handleEmailSettingChange('codeTtlMinutes', Number(e.target.value) || 5)} />
            </div>
            <div className="space-y-2">
              <Label>验证码字符类型</Label>
              <Select value={emailSettings.codeCharset} onValueChange={value => handleEmailSettingChange('codeCharset', value as EmailSettingsForm['codeCharset'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alphanumeric">数字 + 字母</SelectItem>
                  <SelectItem value="numeric">仅数字</SelectItem>
                  <SelectItem value="letters">仅字母</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>是否使用 SSL/TLS</Label>
              <div className="flex h-10 items-center gap-3 rounded-md border border-border px-3">
                <Switch checked={emailSettings.smtpSecure} onCheckedChange={(checked) => handleEmailSettingChange('smtpSecure', checked)} />
                <span className="text-sm text-muted-foreground">465 通常开启，587 通常关闭并使用 STARTTLS</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>版权信息</Label>
            <Input value={emailSettings.copyright} onChange={e => handleEmailSettingChange('copyright', e.target.value)} placeholder="© 2026 妙境. All rights reserved." />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label>测试收件邮箱</Label>
              <Input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your@email.com" />
            </div>
            <Button variant="outline" className="gap-2" onClick={handleSendTestEmail} disabled={emailTesting}>
              {emailTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送测试邮件
            </Button>
            <Button className="gap-2" onClick={handleSaveEmailSettings} disabled={emailSaving}>
              {emailSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存邮箱配置
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {activeSection === 'mail' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            用户邮件
          </CardTitle>
          <CardDescription>使用当前固定 UI 邮件模板，发送给全部非管理员用户或指定用户</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <input
            ref={mailMarkdownImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleUploadMailImage(file, 'markdown');
              e.target.value = '';
            }}
          />
          <input
            ref={mailPureImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleUploadMailImage(file, 'pure');
              e.target.value = '';
            }}
          />
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">给用户发送邮件</p>
                <p className="text-xs text-muted-foreground">使用当前固定 UI 邮件模板，可发送给全部非管理员用户，或指定一个/多个用户。</p>
              </div>
              <div className="flex rounded-lg border border-border bg-muted/30 p-1">
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mailMode === 'selected' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMailMode('selected')}
                >
                  指定用户
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mailMode === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMailMode('all')}
                >
                  全部用户
                </button>
              </div>
            </div>

            {mailMode === 'selected' ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <Label>搜索收件用户</Label>
                    <Input
                      value={recipientQuery}
                      onChange={e => setRecipientQuery(e.target.value)}
                      placeholder="搜索邮箱、昵称、手机号"
                    />
                  </div>
                  <Button variant="outline" onClick={() => loadEmailRecipients(recipientQuery)} disabled={recipientsLoading}>
                    {recipientsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    搜索
                  </Button>
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
                  {recipientResults.length > 0 ? recipientResults.map(user => {
                    const selected = selectedRecipientIds.has(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${selected ? 'border-primary/70 bg-primary/10' : 'border-border bg-background/70 hover:bg-muted/50'}`}
                        onClick={() => toggleRecipient(user)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{user.nickname}</span>
                          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{selected ? '已选择' : user.emailVerified ? '已验证' : '未验证'}</span>
                      </button>
                    );
                  }) : (
                    <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
                      {recipientsLoading ? '正在加载用户...' : '暂无可选用户'}
                    </div>
                  )}
                </div>
                {selectedRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedRecipients.map(user => (
                      <button
                        key={user.id}
                        type="button"
                        className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-foreground"
                        onClick={() => toggleRecipient(user)}
                        title="点击移除"
                      >
                        {user.nickname} · {user.email} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                将发送给所有非管理员、账号启用且填写了有效邮箱的用户。当前可发送用户约 {recipientTotal || 0} 个，管理员账号会自动排除。
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>邮件类型</Label>
                <Select value={mailKind} onValueChange={value => setMailKind(value as 'notification' | 'admin')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notification">通知邮件</SelectItem>
                    <SelectItem value="admin">管理员邮件</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>邮件标题</Label>
                <Input value={mailTitle} onChange={e => setMailTitle(e.target.value)} maxLength={120} placeholder="例如：平台功能更新通知" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>内容类型</Label>
                <div className="flex rounded-lg border border-border bg-muted/30 p-1">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mailContentMode === 'markdown' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setMailContentMode('markdown')}
                  >
                    Markdown 正文
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mailContentMode === 'image' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setMailContentMode('image')}
                  >
                    纯图片
                  </button>
                </div>
              </div>
              {mailContentMode === 'markdown' ? (
                <>
                  <div className="space-y-2">
                    <Label>按钮文字（可选）</Label>
                    <Input value={mailButtonText} onChange={e => setMailButtonText(e.target.value)} maxLength={40} placeholder="查看详情" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>按钮链接（可选）</Label>
                    <Input value={mailButtonUrl} onChange={e => setMailButtonUrl(e.target.value)} placeholder="https:// 或 http:// 开头" />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>图片地址</Label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input value={mailPureImageUrl} onChange={e => setMailPureImageUrl(e.target.value)} placeholder="https:// 或 /api/local-storage/... " />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => mailPureImageInputRef.current?.click()}
                        disabled={mailPureImageUploading}
                      >
                        {mailPureImageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        上传图片
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>图片说明（可选）</Label>
                    <Input value={mailPureImageAlt} onChange={e => setMailPureImageAlt(e.target.value)} placeholder="活动海报" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="rounded-lg border border-border bg-background p-3">
                      {mailPureImageUrl.trim() ? (
                        <img
                          src={mailPureImageUrl.trim()}
                          alt={mailPureImageAlt.trim() || mailTitle.trim() || '邮件图片'}
                          className="max-h-64 w-full rounded-md object-contain"
                        />
                      ) : (
                        <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">填写图片地址后可预览</div>
                      )}
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2 md:col-span-2">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <Label>邮件正文</Label>
                  {mailContentMode === 'markdown' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={!mailPreviewMode ? 'default' : 'outline'}
                        className="h-8 gap-1.5"
                        onClick={() => setMailPreviewMode(false)}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={mailPreviewMode ? 'default' : 'outline'}
                        className="h-8 gap-1.5"
                        onClick={() => setMailPreviewMode(true)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        预览
                      </Button>
                    </div>
                  )}
                </div>
                {mailContentMode === 'markdown' ? (
                  <>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <Input
                        value={mailImageUrl}
                        onChange={e => setMailImageUrl(e.target.value)}
                        placeholder="图片地址，例如 /api/local-storage/... 或 https://..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => mailMarkdownImageInputRef.current?.click()}
                        disabled={mailMarkdownImageUploading}
                      >
                        {mailMarkdownImageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        上传插入
                      </Button>
                      <Button type="button" variant="outline" className="gap-2" onClick={handleInsertMailImage}>
                        <Image className="h-4 w-4" />
                        插入图片
                      </Button>
                    </div>
                    {mailPreviewMode ? (
                      <div className="announcement-markdown min-h-36 max-h-96 overflow-y-auto rounded-md border border-input bg-background p-4">
                        {mailContent.trim() ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{mailContent}</ReactMarkdown>
                        ) : (
                          <p className="text-sm text-muted-foreground">暂无内容</p>
                        )}
                      </div>
                    ) : (
                      <Textarea
                        value={mailContent}
                        onChange={e => setMailContent(e.target.value)}
                        maxLength={20000}
                        className="min-h-56 resize-y font-mono text-sm"
                        placeholder={[
                          '支持 Markdown：',
                          '## 标题',
                          '**加粗**、*斜体*、~~删除线~~',
                          '- 列表 / 1. 编号 / > 引用',
                          '| 表格 | 状态 |',
                          '![图片说明](https://example.com/banner.png)',
                        ].join('\n')}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">{mailContent.length}/20000，支持标题、列表、表格、链接、引用、代码块和 Markdown 图片。</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">纯图片模式下正文区域会只渲染图片，不会显示 Markdown 内容。</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-muted-foreground">
                {mailMode === 'all' ? '提交后会在后台继续发送，可在发送记录查看进度。' : `已选择 ${selectedRecipients.length} 个收件用户。`}
              </p>
              <Button className="gap-2" onClick={handleSendUserEmail} disabled={mailSending}>
                {mailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {mailMode === 'all' ? '发送给全部用户' : '发送给指定用户'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">最近发送记录</p>
                <p className="text-xs text-muted-foreground">可查看全员邮件和指定邮件的成功/失败统计，以及失败邮箱和原因。</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={loadEmailSendHistory} disabled={mailHistoryLoading}>
                {mailHistoryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </div>

            {mailBatches.length === 0 ? (
              <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                {mailHistoryLoading ? '正在加载发送记录...' : '暂无发送记录'}
              </div>
            ) : (
              <div className="space-y-3">
                {mailBatches.map(batch => {
                  const hasFailure = batch.failedCount > 0;
                  const isSending = batch.status === 'sending';
                  return (
                    <div key={batch.id} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold">{batch.title}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${isSending ? 'bg-amber-500/10 text-amber-600' : hasFailure ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
                              {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : hasFailure ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                              {emailBatchStatusLabel(batch)}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {batch.mode === 'all' ? '全部用户' : '指定用户'}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{batch.subject}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {isSending ? `创建于 ${formatEmailBatchTime(batch.createdAt)}，正在后台发送` : formatEmailBatchTime(batch.completedAt || batch.createdAt)}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs md:min-w-52">
                          <div className="rounded-md bg-background px-2 py-2">
                            <span className="block font-semibold text-foreground">{batch.recipientCount}</span>
                            <span className="text-muted-foreground">总数</span>
                          </div>
                          <div className="rounded-md bg-background px-2 py-2">
                            <span className="block font-semibold text-green-600">{batch.sentCount}</span>
                            <span className="text-muted-foreground">成功</span>
                          </div>
                          <div className="rounded-md bg-background px-2 py-2">
                            <span className="block font-semibold text-destructive">{batch.failedCount}</span>
                            <span className="text-muted-foreground">失败</span>
                          </div>
                        </div>
                      </div>

                      {hasFailure && (
                        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                          <p className="mb-2 text-xs font-medium text-destructive">失败明细</p>
                          {batch.failed.length > 0 ? (
                            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                              {batch.failed.map(item => (
                                <div key={item.id || `${batch.id}-${item.email}-${item.createdAt}`} className="rounded-md bg-background/80 px-3 py-2 text-xs">
                                  <div className="font-medium text-foreground">{item.email}</div>
                                  <div className="mt-1 break-words text-muted-foreground">{item.error || '未知失败原因'}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">该批次记录了失败数量，但暂未返回失败明细，请刷新后重试。</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-3 text-sm font-medium">邮件模板预览</p>
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              {emailPreviewHtml ? (
                <iframe title="邮件模板预览" srcDoc={emailPreviewHtml} className="h-[420px] w-full bg-background" />
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">保存或刷新配置后显示模板预览</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">火山引擎域名配置提醒</p>
            <p className="mt-2">如果域名 DNS 托管在火山引擎云解析，请进入：云解析 DNS 控制台 / 公网域名管理 / 选择域名 / 记录管理 / 添加记录。</p>
            <p className="mt-1">火山引擎云解析负责 DNS；SMTP 地址以你实际开通的邮箱服务或自建邮件服务器为准，例如自建 smtp.your-domain.com、腾讯企业邮 smtp.exmail.qq.com、阿里云企业邮箱 smtp.mxhichina.com。</p>
            <p className="mt-1">为降低进入垃圾箱概率，请添加 SPF、DKIM、DMARC，并确保发件人邮箱域名、SMTP 登录账号和 DNS 授权记录一致。</p>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Feature Toggles */}
      {activeSection === 'features' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ToggleLeft className="h-5 w-5 text-primary" />
            功能开关
          </CardTitle>
          <CardDescription>控制前台页面的功能显示</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">会员功能</p>
                <p className="text-xs text-muted-foreground">关闭后隐藏会员、积分、订单、额度和积分消耗提示，并禁用系统默认 API 配置</p>
              </div>
            </div>
            <Switch
              checked={formMembershipEnabled}
              onCheckedChange={handleMembershipToggle}
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LayoutTemplate className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">100 Layout Compositions 构图优化 Skill</p>
                <p className="text-xs text-muted-foreground">开启后，文生图/图生图任务会自动注入构图策略；来源 nevertoday/100-layout-compositions，CC BY 4.0。</p>
              </div>
            </div>
            <Switch
              checked={formImageCompositionSkillEnabled}
              onCheckedChange={handleImageCompositionSkillToggle}
            />
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
