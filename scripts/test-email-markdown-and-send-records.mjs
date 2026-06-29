import assert from 'node:assert/strict';
import EmailService from '../src/lib/email-service.ts';

const {
  buildAdminEmailImageStorageKey,
  getAdminEmailImagePublicUrl,
  getAdminEmailImageValidationError,
  resolveAdminEmailImagePublicBaseUrl,
} = await import('../src/lib/admin-email-image-upload.ts');

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function createSettings(overrides = {}) {
  return {
    enabled: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'service@example.com',
    smtpPassword: 'secret',
    smtpPasswordPreview: '****',
    fromEmail: 'service@example.com',
    fromName: '妙境官方通知',
    replyTo: 'support@example.com',
    appName: '妙境',
    appBaseUrl: 'https://miaojing.example',
    logoUrl: '/logo.png',
    contactEmail: 'support@example.com',
    copyright: '© 2026 妙境',
    codeLength: 6,
    codeCharset: 'alphanumeric',
    codeTtlMinutes: 5,
    ...overrides,
  };
}

function createSchemaClient() {
  const queries = [];
  return {
    queries,
    query: async (sql) => {
      queries.push(String(sql));
      return { rows: [] };
    },
  };
}

function createBatchClient() {
  const state = {
    inserted: null,
    completed: null,
    logs: [
      {
        id: 'log-failed-1',
        batch_id: 'batch-1',
        email: 'bad@example.com',
        recipient_user_id: '22222222-2222-2222-2222-222222222222',
        status: 'failed',
        error_message: 'SMTP 550 mailbox unavailable',
        created_at: '2026-06-18T09:00:01.000Z',
      },
    ],
  };

  return {
    state,
    query: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE') || text.includes('ALTER') || text.includes('CREATE INDEX')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO admin_email_send_batches')) {
        state.inserted = params;
        return { rows: [{ id: 'batch-1' }] };
      }
      if (text.includes('UPDATE admin_email_send_batches')) {
        state.completed = params;
        return { rows: [] };
      }
      if (text.includes('FROM admin_email_send_batches')) {
        return {
          rows: [{
            id: 'batch-1',
            mode: 'all',
            mail_kind: 'notification',
            title: '全员通知',
            subject: '【妙境】全员通知',
            recipient_count: 2,
            sent_count: 1,
            failed_count: 1,
            status: 'completed_with_errors',
            created_at: '2026-06-18T09:00:00.000Z',
            completed_at: '2026-06-18T09:00:02.000Z',
          }],
        };
      }
      if (text.includes('FROM email_send_logs')) {
        return { rows: state.logs };
      }
      return { rows: [] };
    },
  };
}

function createBackgroundBatchClient() {
  const state = {
    batchFinished: null,
    sent: [],
    released: false,
  };

  return {
    state,
    query: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE') || text.includes('ALTER') || text.includes('CREATE INDEX')) {
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM email_settings')) {
        return { rows: [{ enabled: true, from_email: 'service@example.com', smtp_host: 'smtp.example.com' }] };
      }
      if (text.includes('SELECT site_name, logo_url FROM site_config')) {
        return { rows: [{ site_name: '妙境', logo_url: '/logo.png' }] };
      }
      if (text.includes('INSERT INTO email_send_logs')) {
        state.sent.push({
          batchId: params[0],
          recipientUserId: params[1],
          email: params[2],
          status: params[6],
          error: params[7],
        });
        return { rows: [] };
      }
      if (text.includes('UPDATE admin_email_send_batches')) {
        state.batchFinished = params;
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {
      state.released = true;
    },
  };
}

await runTest('renders admin email body as GFM Markdown with absolute image URLs', () => {
  const html = EmailService.renderEmailTemplate(createSettings(), {
    title: '功能更新',
    body: [
      '## 更新重点',
      '',
      '- 支持 **Markdown** 邮件',
      '- 支持任务列表',
      '',
      '| 项目 | 状态 |',
      '| --- | --- |',
      '| 图片 | 已支持 |',
      '',
      '![更新图](/api/local-storage/email/banner.png)',
      '',
      '[查看详情](/gallery)',
    ].join('\n'),
    assetBaseUrl: 'https://miaojing.example',
  });

  assert.match(html, /<h2[^>]*>更新重点<\/h2>/);
  assert.match(html, /<strong[^>]*>Markdown<\/strong>/);
  assert.match(html, /<table[^>]*>/);
  assert.match(html, /<img[^>]*src="https:\/\/miaojing\.example\/api\/local-storage\/email\/banner\.png"[^>]*alt="更新图"/);
  assert.match(html, /<a[^>]*href="https:\/\/miaojing\.example\/gallery"/);
  assert.doesNotMatch(html, /\*\*Markdown\*\*/);
});

await runTest('renders pure image email body without visible body title or markdown text', () => {
  const html = EmailService.renderEmailTemplate(createSettings(), {
    title: '夏日活动海报',
    bodyMode: 'image',
    imageUrl: '/api/local-storage/email/summer-poster.png',
    imageAlt: '夏日活动海报',
    assetBaseUrl: 'https://miaojing.example',
  });

  assert.match(html, /<title>夏日活动海报<\/title>/);
  assert.doesNotMatch(html, /<h1[^>]*>夏日活动海报<\/h1>/);
  assert.match(html, /<img[^>]*src="https:\/\/miaojing\.example\/api\/local-storage\/email\/summer-poster\.png"[^>]*alt="夏日活动海报"/);
  assert.doesNotMatch(html, /\!\[夏日活动海报\]/);
});

await runTest('email schema creates batch table and links send logs to a batch', async () => {
  const client = createSchemaClient();
  await EmailService.ensureEmailSchema(client);
  const sql = client.queries.join('\n');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS admin_email_send_batches/);
  assert.match(sql, /ALTER TABLE email_send_logs[\s\S]*ADD COLUMN IF NOT EXISTS batch_id UUID/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS recipient_user_id UUID/);
  assert.match(sql, /email_send_logs_batch_created_idx/);
});

await runTest('admin email batch records expose failed recipients and reasons', async () => {
  assert.equal(typeof EmailService.createAdminEmailSendBatch, 'function');
  assert.equal(typeof EmailService.finishAdminEmailSendBatch, 'function');
  assert.equal(typeof EmailService.listAdminEmailSendBatches, 'function');

  const client = createBatchClient();
  const batchId = await EmailService.createAdminEmailSendBatch(client, {
    mode: 'all',
    mailKind: 'notification',
    title: '全员通知',
    subject: '【妙境】全员通知',
    recipientCount: 2,
    createdBy: '11111111-1111-1111-1111-111111111111',
  });
  await EmailService.finishAdminEmailSendBatch(client, batchId, {
    sentCount: 1,
    failedCount: 1,
  });

  const result = await EmailService.listAdminEmailSendBatches(client, { limit: 10 });

  assert.equal(batchId, 'batch-1');
  assert.equal(client.state.inserted[0], 'all');
  assert.equal(client.state.completed[0], 1);
  assert.equal(result.batches[0].failedCount, 1);
  assert.deepEqual(result.batches[0].failed[0], {
    id: 'log-failed-1',
    email: 'bad@example.com',
    recipientUserId: '22222222-2222-2222-2222-222222222222',
    status: 'failed',
    error: 'SMTP 550 mailbox unavailable',
    createdAt: '2026-06-18T09:00:01.000Z',
  });
});

await runTest('background admin email sender always finishes batch after per-recipient failures', async () => {
  assert.equal(typeof EmailService.sendAdminEmailBatchInBackground, 'function');

  const client = createBackgroundBatchClient();
  await EmailService.sendAdminEmailBatchInBackground({
    client,
    batchId: 'batch-bg-1',
    recipients: [
      { id: 'user-1', email: 'ok@example.com' },
      { id: 'user-2', email: 'bad@example.com' },
    ],
    mailKind: 'admin',
    mailKindLabel: '管理员邮件',
    subject: '【妙境】后台群发',
    title: '后台群发',
    content: '正文',
    contentMode: 'markdown',
    buttonText: '',
    buttonUrl: '',
    assetBaseUrl: 'https://miaojing.example',
    mode: 'all',
    sendEmail: async ({ to }) => {
      if (to === 'bad@example.com') throw new Error('SMTP 550 mailbox unavailable');
    },
  });

  assert.equal(client.state.sent.length, 2);
  assert.equal(client.state.sent[0].status, 'sent');
  assert.equal(client.state.sent[1].status, 'failed');
  assert.equal(client.state.sent[1].error, 'SMTP 550 mailbox unavailable');
  assert.deepEqual(client.state.batchFinished, [1, 1, 'completed_with_errors', 'batch-bg-1']);
  assert.equal(client.state.released, true);
});

await runTest('admin email image upload validates files and returns local-storage URLs', () => {
  assert.equal(getAdminEmailImageValidationError({
    name: 'poster.png',
    type: 'image/png',
    size: 1024,
  }), null);
  assert.match(getAdminEmailImageValidationError({
    name: 'poster.svg',
    type: 'image/svg+xml',
    size: 1024,
  }) || '', /仅支持/);
  assert.match(getAdminEmailImageValidationError({
    name: 'poster.png',
    type: 'image/png',
    size: 9 * 1024 * 1024,
  }) || '', /不能超过/);

  const key = buildAdminEmailImageStorageKey({
    id: '11111111-1111-4111-8111-111111111111',
    contentType: 'image/png',
    now: new Date('2026-06-18T09:00:00.000Z'),
  });
  assert.equal(key, 'email/admin/2026/06/11111111-1111-4111-8111-111111111111.png');
  assert.equal(getAdminEmailImagePublicUrl(key), '/api/local-storage/email/admin/2026/06/11111111-1111-4111-8111-111111111111.png');
  assert.equal(
    getAdminEmailImagePublicUrl(key, 'https://miaojing.example'),
    'https://miaojing.example/api/local-storage/email/admin/2026/06/11111111-1111-4111-8111-111111111111.png',
  );
  assert.equal(resolveAdminEmailImagePublicBaseUrl({
    requestBaseUrl: 'https://miaojing.example.com',
    envBaseUrl: 'http://127.0.0.1:8000',
    settingsBaseUrl: 'http://127.0.0.1:8000',
  }), 'https://miaojing.example.com');
});

await runTest('local-storage email images can be embedded as cid attachments', async () => {
  assert.equal(typeof EmailService.rewriteHtmlImagesWithInlineAttachments, 'function');
  assert.equal(typeof EmailService.buildSmtpMimeMessage, 'function');

  const sourceHtml = '<p>海报</p><img src="https://miaojing.example.com/api/local-storage/email/admin/poster.png" alt="海报">';
  const prepared = await EmailService.rewriteHtmlImagesWithInlineAttachments(sourceHtml, async key => ({
    content: Buffer.from('fake-png'),
    contentType: 'image/png',
    filename: key.split('/').pop(),
  }));

  assert.equal(prepared.attachments.length, 1);
  assert.match(prepared.html, /src="cid:mj-image-/);
  assert.doesNotMatch(prepared.html, /https:\/\/miaojing\.toplee\.cn\/api\/local-storage/);

  const message = EmailService.buildSmtpMimeMessage(createSettings(), {
    to: 'user@example.com',
    subject: '【妙境】海报',
    html: prepared.html,
    attachments: prepared.attachments,
  });
  assert.match(message, /Content-Type: multipart\/related;/);
  assert.match(message, /Content-ID: <mj-image-/);
  assert.match(message, /Content-Type: image\/png;/);
});

if (process.exitCode) process.exit(process.exitCode);
