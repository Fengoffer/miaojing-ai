import assert from 'node:assert/strict';
import fs from 'node:fs';

const routeSource = fs.readFileSync('src/app/api/generate/image/route.ts', 'utf8');
const manifestExecutorSource = fs.readFileSync('src/lib/user-api-manifest-executor.ts', 'utf8');
const imageTemplateTypes = fs.readFileSync('src/lib/image-api-templates/types.ts', 'utf8');
const genericImageTemplate = fs.readFileSync('src/lib/image-api-templates/generic-json.ts', 'utf8');
const openAIImageTemplate = fs.readFileSync('src/lib/image-api-templates/openai-compatible.ts', 'utf8');

assert.match(
  routeSource,
  /generateObjectReadUrl\(fileKey,\s*3600\)/,
  'img2img uploaded reference images should expose object signed URLs to upstream providers',
);

assert.match(
  routeSource,
  /toAbsolutePublicUrl\(publicUrl\)/,
  'img2img fallback public URLs should be absolute when object signed URLs are unavailable',
);

assert.match(
  routeSource,
  /localStorage\.getKeyFromPublicUrl\(normalizedImage\)/,
  'img2img should detect stored /api/local-storage reference images before fetching over HTTP',
);

assert.match(
  routeSource,
  /localStorage\.readFileAsync\(storedReferenceKey\)/,
  'img2img should read stored reference images through the storage adapter for FormData uploads',
);

assert.match(
  routeSource,
  /allReferenceImages\?: string\[\]/,
  'custom img2img fallback should accept all normalized references, not only the first image',
);

assert.match(
  routeSource,
  /const referenceInputs = allReferenceImages\?\.length \? allReferenceImages : \[image\]/,
  'custom img2img fallback should preserve every uploaded reference image',
);

assert.match(
  routeSource,
  /if \(referenceImages\.length > 0\)[\s\S]*customApiImageToImage\([\s\S]*referenceImages\[0\][\s\S]*referenceImages/,
  'image route should use normalized referenceImages, not only the legacy top-level image field, to enter img2img fallback',
);

assert.match(
  routeSource,
  /const primarySdkReferenceImage = referenceImages\[0\]/,
  'SDK fallback should also use the normalized first reference image',
);

assert.match(
  routeSource,
  /imageUrls: resolvedReferences\.map\(item => item\.imageUrl\)\.filter\(Boolean\)/,
  'custom img2img fallback should pass all reference URLs into template requests',
);

assert.match(
  routeSource,
  /formDataFileCount: referenceFiles\.length/,
  'custom img2img FormData fallback should prepare multiple reference file fields when available',
);

assert.match(
  imageTemplateTypes,
  /imageUrls\?: string\[\]/,
  'image templates should accept multiple reference image URLs',
);

for (const source of [genericImageTemplate, openAIImageTemplate]) {
  assert.match(
    source,
    /\.\.\.imageUrls\.map\(url => \(\{ type: 'image_url', image_url: \{ url \} \}\)\)/,
    'chat/completions img2img fallback should include every reference image URL',
  );
  assert.match(
    source,
    /reference_urls: imageUrls/,
    'generation JSON img2img fallback should include provider-friendly reference_urls',
  );
}

assert.match(
  manifestExecutorSource,
  /logManifestReferenceFields/,
  'manifest image-to-image requests should log safe reference-field evidence for every provider',
);

assert.match(
  manifestExecutorSource,
  /\[User API Manifest Image Refs\] Request refs/,
  'manifest image-to-image logs should use a generic provider-safe reference log line',
);

assert.match(
  manifestExecutorSource,
  /collectImageReferenceFields/,
  'manifest logs should inspect common image/reference fields in rendered request bodies',
);

console.log('custom img2img reference URL policy ok');
