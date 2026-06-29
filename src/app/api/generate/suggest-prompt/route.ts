import { NextRequest, NextResponse } from 'next/server';
import { buildCustomApiHeaders, fetchWithRetry, parseCustomApiError } from '@/lib/custom-api-fetch';
import { resolveServerApiConfig } from '@/lib/server-api-config';
import {
  getAgnesPromptOptimizationTarget,
  isAgnesPromptOptimizerModel,
  type AgnesPromptOptimizationMediaType,
  type AgnesPromptOptimizationTarget,
} from '@/lib/agnes-model-templates';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import {
  createModelCallRecordStandalone,
  updateModelCallRecordById,
} from '@/lib/model-call-records';

interface CustomApiConfig {
  apiUrl: string;
  modelName: string;
  apiKey: string;
  provider: string;
  customApiKeyId?: string;
  systemApiId?: string;
}

type TargetGenerationModel = {
  modelName?: string;
  displayName?: string;
  mediaType?: AgnesPromptOptimizationMediaType;
};

const SUGGEST_TIMEOUT = 60_000;

function safeTargetText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTargetGenerationModel(input: TargetGenerationModel | undefined): AgnesPromptOptimizationTarget | undefined {
  if (!input) return undefined;
  const modelName = safeTargetText(input.modelName);
  const displayName = safeTargetText(input.displayName);
  if (!modelName && !displayName) return undefined;
  return {
    modelName: modelName || displayName,
    displayName: displayName || modelName,
    mediaType: input.mediaType === 'video' ? 'video' : 'image',
  };
}

function parseOptimizedPrompt(content: string): { prompt: string; negativePrompt?: string } {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const prompt = typeof parsed.prompt === 'string'
        ? parsed.prompt
        : typeof parsed.positivePrompt === 'string'
          ? parsed.positivePrompt
          : typeof parsed.positive === 'string'
            ? parsed.positive
            : '';
      const negativePrompt = typeof parsed.negativePrompt === 'string'
        ? parsed.negativePrompt
        : typeof parsed.negative === 'string'
          ? parsed.negative
          : '';
      if (prompt.trim()) {
        return {
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
        };
      }
    } catch {
      // Fall through to labeled text parsing.
    }
  }

  const positiveMatch = trimmed.match(/(?:正向提示词|优化提示词|正面提示词|Positive Prompt|Prompt)\s*[:：]\s*([\s\S]*?)(?=(?:负向提示词|负面提示词|反向提示词|Negative Prompt|Negative)\s*[:：]|$)/i);
  const negativeMatch = trimmed.match(/(?:负向提示词|负面提示词|反向提示词|Negative Prompt|Negative)\s*[:：]\s*([\s\S]*)$/i);
  const prompt = (positiveMatch?.[1] || trimmed).trim();
  const negativePrompt = negativeMatch?.[1]?.trim();

  return {
    prompt,
    negativePrompt: negativePrompt || undefined,
  };
}

function buildSuggestPromptSystemMessage(
  systemPrefix: string | undefined,
  targetGenerationModel: AgnesPromptOptimizationTarget | undefined,
  agnesTarget: AgnesPromptOptimizationTarget | undefined,
): string {
  if (agnesTarget) {
    const outputType = agnesTarget.mediaType === 'video' ? 'video generation' : 'image generation';
    return [
      `此次提示词优化面向 ${agnesTarget.displayName}（${agnesTarget.modelName}）${agnesTarget.mediaType === 'video' ? '视频生成' : '图片生成'}模型。`,
      `You are optimizing the user's idea specifically for Agnes ${outputType}.`,
      'Return one English positive prompt and one English negative prompt that match Agnes prompt style.',
      'The positive prompt should be concrete, visual, concise but information-dense, with subject, scene, composition, style, lighting, camera/lens or motion cues, mood, and quality details that the target Agnes model can understand.',
      'The negative prompt should be an English list of things to avoid, including low quality, artifacts, wrong anatomy, distorted structure, text, watermark, logo, blur, noise, duplicate subjects, and model-specific generation defects.',
      'Only return valid JSON. Do not include Markdown or explanation. Format: {"prompt":"English positive prompt","negativePrompt":"English negative prompt"}',
    ].join('\n');
  }

  const baseInstruction = targetGenerationModel
    ? `此次提示词优化面向 ${targetGenerationModel.displayName}（${targetGenerationModel.modelName}）${targetGenerationModel.mediaType === 'video' ? '视频生成' : '图片生成'}模型。请针对该模型的生成特点优化提示词。`
    : systemPrefix
      ? `${systemPrefix}。`
      : '你是一个专业的AI绘图/视频提示词优化专家。';
  return `${baseInstruction}请基于用户描述同时生成正向提示词和反向/负面提示词。正向提示词要更详细、更有画面感、更适合生成模型；负面提示词要列出应避免的低质量、畸形、错误结构、画面瑕疵、文字水印等内容。只返回JSON，不要解释，格式为：{"prompt":"优化后的正向提示词","negativePrompt":"优化后的负面提示词"}`;
}

function getSuggestPromptErrorStatus(message: string): number {
  if (/请先登录|未登录|unauthorized|jwt|token/i.test(message)) return 401;
  if (/无权|会员等级|权限/.test(message)) return 403;
  if (/不存在|未启用|未配置|不可用/.test(message)) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  let modelCallRecordId: string | null = null;
  try {
    const body = await request.json();
    const {
      prompt,
      modelName,
      customApiConfig,
      systemPrefix,
      targetGenerationModel,
    } = body as {
      prompt?: string;
      modelName?: string;
      customApiConfig?: CustomApiConfig;
      systemPrefix?: string;
      targetGenerationModel?: TargetGenerationModel;
    };

    if (!prompt) {
      return NextResponse.json({ error: '请提供创作描述' }, { status: 400 });
    }

    const normalizedTargetGenerationModel = normalizeTargetGenerationModel(targetGenerationModel);
    const requestedAgnesPromptTarget = getAgnesPromptOptimizationTarget(normalizedTargetGenerationModel);
    const requestedAgnesOptimizer = requestedAgnesPromptTarget && isAgnesPromptOptimizerModel(customApiConfig?.modelName || modelName)
      ? requestedAgnesPromptTarget
      : undefined;
    const resolvedCustomApiConfig = await resolveServerApiConfig(request, customApiConfig);
    const agnesPromptTarget = requestedAgnesOptimizer && isAgnesPromptOptimizerModel(resolvedCustomApiConfig?.modelName)
      ? requestedAgnesOptimizer
      : undefined;
    if (requestedAgnesPromptTarget && isAgnesPromptOptimizerModel(customApiConfig?.modelName || modelName) && !resolvedCustomApiConfig?.apiKey) {
      return NextResponse.json(
        { error: 'Agnes 提示词优化模型未配置或未启用，请在系统默认模型中启用 Agnes 2.0 Flash 并填写 API Key' },
        { status: 400 },
      );
    }

    // Use custom/system multimodal model API if provided
    if (resolvedCustomApiConfig && resolvedCustomApiConfig.apiKey) {
      const resolvedApiKey = resolvedCustomApiConfig.apiKey;
      const endpoint = resolvedCustomApiConfig.apiUrl;
      if (!endpoint) {
        return NextResponse.json({ error: '多模态模型API未配置请求地址' }, { status: 400 });
      }
      if (!resolvedCustomApiConfig.modelName) {
        return NextResponse.json({ error: '多模态模型API未配置模型名称' }, { status: 400 });
      }

      const systemMessage = buildSuggestPromptSystemMessage(systemPrefix, normalizedTargetGenerationModel, agnesPromptTarget);
      const userId = await getAuthenticatedUserId(request);
      modelCallRecordId = await createModelCallRecordStandalone({
        userId,
        source: 'suggest-prompt',
        operation: agnesPromptTarget ? 'agnes-prompt-optimization' : 'suggest-prompt',
        type: 'text',
        provider: resolvedCustomApiConfig.provider,
        modelName: resolvedCustomApiConfig.modelName,
        apiUrl: endpoint,
        systemApiId: resolvedCustomApiConfig.systemApiId,
        customApiKeyId: resolvedCustomApiConfig.customApiKeyId,
        status: 'running',
        metadata: {
          targetGenerationModel: normalizedTargetGenerationModel,
          promptLength: prompt.length,
          systemPrefix: systemPrefix || '',
        },
      });

      const headers = buildCustomApiHeaders(resolvedApiKey);
      const chatBody = {
        model: resolvedCustomApiConfig.modelName,
        stream: false,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt },
        ],
      };

      console.log('[Suggest Prompt] Using custom multimodal model:', resolvedCustomApiConfig.modelName, '| prefix:', systemPrefix || 'default', '| target:', agnesPromptTarget?.displayName || normalizedTargetGenerationModel?.displayName || 'generic');

      try {
        const response = await fetchWithRetry(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(chatBody),
          },
          SUGGEST_TIMEOUT,
          1,
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Suggest Prompt] API error:', response.status, errorText.slice(0, 200));
          await updateModelCallRecordById(modelCallRecordId, {
            status: 'failed',
            error: parseCustomApiError(response.status, errorText, 'multimodal'),
            resultCount: 0,
            metadata: { upstreamStatus: response.status },
          });
          return NextResponse.json(
            { error: parseCustomApiError(response.status, errorText, 'multimodal') },
            { status: response.status >= 500 ? 502 : response.status }
          );
        }

        const data = await response.json();
        const choices = (data as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
        if (choices && choices.length > 0) {
          const message = choices[0].message as Record<string, unknown>;
          const content = message?.content;
          if (typeof content === 'string' && content.trim()) {
            await updateModelCallRecordById(modelCallRecordId, {
              status: 'succeeded',
              resultCount: 1,
              creditsCost: 0,
              metadata: { outputLength: content.length },
            });
            return NextResponse.json(parseOptimizedPrompt(content));
          }
        }

        await updateModelCallRecordById(modelCallRecordId, {
          status: 'failed',
          error: '多模态模型未返回有效内容',
          resultCount: 0,
        });
        return NextResponse.json({ error: '多模态模型未返回有效内容' }, { status: 502 });
      } catch (fetchError: unknown) {
        const msg = fetchError instanceof Error ? fetchError.message : '请求失败';
        console.error('[Suggest Prompt] Fetch error:', msg);
        await updateModelCallRecordById(modelCallRecordId, {
          status: 'failed',
          error: `提示词优化失败: ${msg}`,
          resultCount: 0,
        });
        return NextResponse.json({ error: `提示词优化失败: ${msg}` }, { status: 502 });
      }
    }

    // No multimodal model configured
    return NextResponse.json({ error: '未配置多模态模型，请在API设置中添加多模态模型' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '提示词优化失败';
    const status = getSuggestPromptErrorStatus(message);
    if (status >= 500) {
      console.error('[Suggest Prompt Error]', message);
    } else {
      console.log('[Suggest Prompt Reject]', message);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
