export type AdminGalleryPromptReasonKey =
  | 'remove_sensitive_words'
  | 'improve_wording'
  | 'remove_private_info'
  | 'platform_policy_adjustment'
  | 'custom';

export interface AdminGalleryPromptAdmin {
  userId: string;
  role: string;
}

export interface AdminGalleryPromptWorkRow {
  id: string;
  user_id: string | null;
  type: string | null;
  title: string | null;
  prompt: string | null;
  negative_prompt?: string | null;
  result_url: string | null;
  thumbnail_url?: string | null;
  likes_count?: number | null;
  is_public: boolean | null;
  status: string | null;
  created_at: string | Date | null;
  author_email: string | null;
  author_nickname?: string | null;
  author_display_nickname?: string | null;
  author_avatar_url?: string | null;
}

export interface AdminGalleryPromptInput {
  workId: string;
  prompt: string;
  emailSubject: string;
  emailBody: string;
  reasonKey?: string;
}

export interface AdminGalleryPromptEmailMessage {
  to: string;
  subject: string;
  body: string;
  work: AdminGalleryPromptWorkRow;
  reasonKey: AdminGalleryPromptReasonKey;
}

export interface AdminGalleryPromptDeps {
  admin: AdminGalleryPromptAdmin;
  loadWork: (workId: string) => Promise<AdminGalleryPromptWorkRow | null>;
  updatePrompt: (workId: string, prompt: string) => Promise<AdminGalleryPromptWorkRow>;
  sendEmail: (message: AdminGalleryPromptEmailMessage) => Promise<void>;
  writeLog: (entry: Record<string, unknown>) => Promise<void>;
}

export class AdminGalleryPromptError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function updateAdminGalleryPrompt(input: AdminGalleryPromptInput, deps: AdminGalleryPromptDeps) {
  const workId = normalizeUuid(input.workId, '缺少作品 ID');
  const prompt = normalizeRequiredText(input.prompt, '请填写新的提示词', 8000);
  const emailSubject = normalizeRequiredText(input.emailSubject, '请填写邮件标题', 120);
  const emailBody = normalizeRequiredText(input.emailBody, '请填写邮件正文', 5000);
  const reasonKey = normalizeReasonKey(input.reasonKey);

  const work = await deps.loadWork(workId);
  if (!work || work.is_public !== true || work.status !== 'completed' || !work.result_url) {
    throw new AdminGalleryPromptError('作品不存在或不是公开作品', 404);
  }

  const oldPrompt = String(work.prompt || '').trim();
  if (oldPrompt === prompt) {
    throw new AdminGalleryPromptError('提示词没有变化', 400);
  }

  const authorEmail = normalizeEmailAddress(work.author_email);
  if (!isValidEmailAddress(authorEmail)) {
    throw new AdminGalleryPromptError('作者邮箱不可用，无法完成邮件通知', 400);
  }

  await deps.sendEmail({ to: authorEmail, subject: emailSubject, body: emailBody, work, reasonKey });
  const updated = await deps.updatePrompt(workId, prompt);

  await deps.writeLog({
    type: 'admin',
    level: 'info',
    action: 'admin_gallery_prompt_update',
    message: '管理员修改公开画廊作品提示词并发送邮件通知',
    userId: deps.admin.userId,
    targetType: 'work',
    targetId: workId,
    metadata: {
      workId,
      authorId: work.user_id,
      authorEmail,
      reasonKey,
      oldPromptLength: oldPrompt.length,
      newPromptLength: prompt.length,
      notificationSent: true,
    },
  });

  return {
    work: toAdminGalleryPromptWork(updated, authorEmail),
    notificationSent: true,
  };
}

export function toAdminGalleryPromptWork(row: AdminGalleryPromptWorkRow, authorEmail = normalizeEmailAddress(row.author_email)) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt || null,
    url: row.result_url,
    thumbnailUrl: row.thumbnail_url || null,
    likes: Number(row.likes_count || 0),
    authorId: row.user_id,
    authorEmail,
    authorNickname: row.author_display_nickname || row.author_nickname || (authorEmail ? authorEmail.split('@')[0] : '匿名用户'),
    authorAvatarUrl: row.author_avatar_url || null,
    publishedAt: row.created_at,
  };
}

export function normalizeReasonKey(value: unknown): AdminGalleryPromptReasonKey {
  if (
    value === 'remove_sensitive_words'
    || value === 'improve_wording'
    || value === 'remove_private_info'
    || value === 'platform_policy_adjustment'
  ) {
    return value;
  }
  return 'custom';
}

function normalizeUuid(value: unknown, message: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-fA-F-]{36}$/.test(text)) {
    throw new AdminGalleryPromptError(message, 400);
  }
  return text;
}

function normalizeRequiredText(value: unknown, message: string, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AdminGalleryPromptError(message, 400);
  }
  return text.slice(0, maxLength);
}

function normalizeEmailAddress(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmailAddress(value: string) {
  return value.length > 3 && value.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value);
}
