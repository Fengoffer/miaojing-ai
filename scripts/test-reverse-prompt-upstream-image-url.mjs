#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/generate/reverse-prompt/route.ts');
const source = fs.readFileSync(routePath, 'utf8');

assert.match(
  source,
  /localStorage\.generateObjectReadUrl\(storageKey,\s*3600\)/,
  'reverse-prompt should still prepare an object-storage read URL as a fallback for upstream multimodal image access',
);

assert.match(
  source,
  /localStorage\.objectFileExistsAsync\(storageKey\)/,
  'reverse-prompt should verify the object exists before keeping the object-storage fallback URL',
);

assert.match(
  source,
  /const upstreamImage\s*=\s*publicReferenceImage\s*\|\|\s*persistedReferenceImage\.objectReadUrl\s*\|\|\s*image/,
  'reverse-prompt should prefer the platform URL, then the object-storage fallback, and only then the raw input',
);

assert.match(
  source,
  /type:\s*'input_image'[\s\S]*image_url:\s*upstreamImage/,
  'reverse-prompt upstream Responses payload should send upstreamImage as an input_image instead of the raw upload data URL',
);

assert.match(
  source,
  /stream:\s*true/,
  'reverse-prompt upstream Responses payload should use streaming to avoid synchronous gateway timeouts',
);

assert.match(
  source,
  /REVERSE_PROMPT_RESPONSES_REASONING_EFFORT\s*=\s*'xhigh'/,
  'reverse-prompt should normalize XHigh to the lowercase Responses effort value accepted by mozhe',
);

assert.match(
  source,
  /reasoning:\s*\{\s*effort:\s*REVERSE_PROMPT_RESPONSES_REASONING_EFFORT\s*\}/,
  'reverse-prompt upstream Responses payload should set the configured reasoning effort in the mozhe-compatible nested field',
);

assert.doesNotMatch(
  source,
  /reasoning:\s*\{\s*effort:\s*REVERSE_PROMPT_REASONING_EFFORT\s*\}/,
  'reverse-prompt should not send uppercase nested reasoning.effort because mozhe /responses returns 502 for that shape',
);

assert.doesNotMatch(
  source,
  /reasoning_effort:\s*REVERSE_PROMPT_REASONING_EFFORT/,
  'reverse-prompt should not use reasoning_effort because mozhe accepts it but does not apply XHigh',
);

assert.match(
  source,
  /readResponsesStreamText/,
  'reverse-prompt should parse streamed Responses API output text',
);

assert.match(
  source,
  /readStreamChunkWithTimeout/,
  'reverse-prompt should timeout stalled upstream response streams',
);

assert.match(
  source,
  /referenceImage:\s*persistedReferenceImage\.publicUrl/,
  'reverse-prompt response should keep the stable platform URL for history/UI',
);

assert.match(
  source,
  /usesObjectReadUrl/,
  'reverse-prompt logs should expose whether a safe object-storage URL was used',
);

assert.match(
  source,
  /sanitizeUpstreamError/,
  'reverse-prompt should sanitize upstream error logs before printing them',
);

assert.match(
  source,
  /parseReversePromptObject/,
  'reverse-prompt should normalize nested JSON prompt fields returned by multimodal models',
);

assert.match(
  source,
  /stripJsonCodeFence/,
  'reverse-prompt should tolerate JSON code fences in upstream responses',
);

console.log('reverse-prompt upstream image URL policy ok');
