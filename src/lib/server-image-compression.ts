import sharp from 'sharp';

export type ImageBufferInput = {
  buffer: Buffer;
  mimeType: string;
};

export type CompressedImageBuffer = ImageBufferInput & {
  changed: boolean;
  originalBytes: number;
};

type CompressOptions = {
  maxDimension?: number;
  maxBytes?: number;
  quality?: number;
  minQuality?: number;
};

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_MAX_BYTES = 1536 * 1024;
const DEFAULT_QUALITY = 92;
const DEFAULT_MIN_QUALITY = 68;

export function dataUrlToImageBuffer(dataUrl: string): ImageBufferInput | null {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export function imageBufferToDataUrl(input: ImageBufferInput): string {
  return `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
}

export async function compressImageBufferForUpstream(
  input: ImageBufferInput,
  options: CompressOptions = {},
): Promise<CompressedImageBuffer> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const minQuality = options.minQuality ?? DEFAULT_MIN_QUALITY;

  if (input.buffer.length <= maxBytes && /^image\/(jpeg|jpg|webp)$/i.test(input.mimeType)) {
    return {
      ...input,
      changed: false,
      originalBytes: input.buffer.length,
    };
  }

  let image = sharp(input.buffer, { failOn: 'none', limitInputPixels: 48_000_000 }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || maxDimension;
  const height = metadata.height || maxDimension;
  const resizeNeeded = Math.max(width, height) > maxDimension;
  if (resizeNeeded) {
    image = image.resize({
      width: width >= height ? maxDimension : undefined,
      height: height > width ? maxDimension : undefined,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  }

  let output = await image.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  let currentQuality = quality;
  while (output.length > maxBytes && currentQuality > minQuality) {
    currentQuality = Math.max(minQuality, currentQuality - 4);
    output = await sharp(output, { failOn: 'none', limitInputPixels: 48_000_000 })
      .jpeg({ quality: currentQuality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }

  if (output.length >= input.buffer.length) {
    return {
      ...input,
      changed: false,
      originalBytes: input.buffer.length,
    };
  }

  return {
    buffer: output,
    mimeType: 'image/jpeg',
    changed: true,
    originalBytes: input.buffer.length,
  };
}
