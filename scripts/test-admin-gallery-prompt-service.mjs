import assert from 'node:assert/strict';
import { updateAdminGalleryPrompt } from '../src/lib/admin-gallery-prompt-service.ts';
import {
  buildAdminGalleryWorksPaginationMeta,
  parseAdminGalleryWorksPagination,
} from '../src/lib/admin-gallery-works-pagination.ts';

function createWork(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    type: 'text2img',
    title: 'public work',
    prompt: 'old public prompt',
    negative_prompt: null,
    result_url: '/api/local-storage/gallery/image.webp',
    thumbnail_url: '/api/local-storage/thumbnails/gallery/image.webp',
    likes_count: 3,
    is_public: true,
    status: 'completed',
    created_at: '2026-05-20T00:00:00.000Z',
    author_email: 'author@example.com',
    author_nickname: 'Author',
    author_display_nickname: 'Author Display',
    author_avatar_url: null,
    ...overrides,
  };
}

function createServiceHarness({ work, emailFails = false } = {}) {
  const state = {
    work: work || createWork(),
    updates: [],
    emails: [],
    logs: [],
  };

  return {
    state,
    deps: {
      loadWork: async (workId) => (workId === state.work.id ? state.work : null),
      updatePrompt: async (workId, prompt) => {
        state.updates.push({ workId, prompt });
        state.work = { ...state.work, prompt };
        return state.work;
      },
      sendEmail: async (message) => {
        state.emails.push(message);
        if (emailFails) throw new Error('SMTP down');
      },
      writeLog: async (entry) => {
        state.logs.push(entry);
      },
    },
  };
}

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

const admin = { userId: '33333333-3333-3333-3333-333333333333', role: 'admin' };
const baseInput = {
  workId: '11111111-1111-1111-1111-111111111111',
  prompt: 'new compliant prompt',
  emailSubject: '公开作品提示词已调整',
  emailBody: '你的公开作品提示词已根据平台规范调整。',
  reasonKey: 'remove_sensitive_words',
};

await runTest('rejects non-public works', async () => {
  const { deps, state } = createServiceHarness({ work: createWork({ is_public: false }) });
  await assert.rejects(() => updateAdminGalleryPrompt(baseInput, { admin, ...deps }), /作品不存在或不是公开作品/);
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails.length, 0);
});

await runTest('rejects missing author email', async () => {
  const { deps, state } = createServiceHarness({ work: createWork({ author_email: '' }) });
  await assert.rejects(() => updateAdminGalleryPrompt(baseInput, { admin, ...deps }), /作者邮箱不可用/);
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails.length, 0);
});

await runTest('rejects unchanged prompt', async () => {
  const { deps, state } = createServiceHarness();
  await assert.rejects(
    () => updateAdminGalleryPrompt({ ...baseInput, prompt: 'old public prompt' }, { admin, ...deps }),
    /提示词没有变化/,
  );
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails.length, 0);
});

await runTest('does not update prompt when email sending fails', async () => {
  const { deps, state } = createServiceHarness({ emailFails: true });
  await assert.rejects(() => updateAdminGalleryPrompt(baseInput, { admin, ...deps }), /SMTP down/);
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails.length, 1);
});

await runTest('sends email before updating prompt', async () => {
  const { deps, state } = createServiceHarness();
  const result = await updateAdminGalleryPrompt(baseInput, { admin, ...deps });
  assert.equal(state.emails.length, 1);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].prompt, 'new compliant prompt');
  assert.equal(result.work.prompt, 'new compliant prompt');
});

await runTest('writes moderation log metadata without full prompt text', async () => {
  const { deps, state } = createServiceHarness();
  await updateAdminGalleryPrompt(baseInput, { admin, ...deps });
  assert.equal(state.logs.length, 1);
  const logText = JSON.stringify(state.logs[0]);
  assert.match(logText, /remove_sensitive_words/);
  assert.doesNotMatch(logText, /old public prompt/);
  assert.doesNotMatch(logText, /new compliant prompt/);
});

await runTest('parses admin gallery page and pageSize into limit and offset', async () => {
  const pagination = parseAdminGalleryWorksPagination(new URLSearchParams('page=3&pageSize=50'));
  assert.deepEqual(pagination, {
    page: 3,
    pageSize: 50,
    limit: 50,
    offset: 100,
  });
});

await runTest('keeps limit and offset compatibility for admin gallery works', async () => {
  const pagination = parseAdminGalleryWorksPagination(new URLSearchParams('limit=15&offset=30'));
  assert.deepEqual(pagination, {
    page: 3,
    pageSize: 15,
    limit: 15,
    offset: 30,
  });
});

await runTest('builds admin gallery pagination metadata', async () => {
  const meta = buildAdminGalleryWorksPaginationMeta({ total: 46, page: 2, pageSize: 20, resultCount: 20 });
  assert.deepEqual(meta, {
    total: 46,
    page: 2,
    pageSize: 20,
    totalPages: 3,
    nextOffset: 40,
    hasMore: true,
  });
});

if (process.exitCode) process.exit(process.exitCode);
