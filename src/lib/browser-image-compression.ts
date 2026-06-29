'use client';

export type BrowserCompressedImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  compressed: boolean;
};

type CompressionOptions = {
  maxDimension?: number;
  maxBytes?: number;
  initialQuality?: number;
  minQuality?: number;
};

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_MAX_BYTES = 1536 * 1024;
const DEFAULT_INITIAL_QUALITY = 0.92;
const DEFAULT_MIN_QUALITY = 0.68;

function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl.length;
  const base64 = dataUrl.slice(commaIndex + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片压缩失败'));
    }, type, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取压缩图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function loadImageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fallback below handles browsers/formats that createImageBitmap cannot decode.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = objectUrl;
  });

  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => URL.revokeObjectURL(objectUrl),
  };
}

function jpegName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') + '.jpg';
}

export async function compressImageFileForUpload(
  file: File,
  options: CompressionOptions = {},
): Promise<BrowserCompressedImage> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const initialQuality = options.initialQuality ?? DEFAULT_INITIAL_QUALITY;
  const minQuality = options.minQuality ?? DEFAULT_MIN_QUALITY;

  if (!file.type.startsWith('image/')) {
    throw new Error('请上传图片文件');
  }

  let sourceInfo: Awaited<ReturnType<typeof loadImageSource>> | null = null;
  try {
    sourceInfo = await loadImageSource(file);
    const scale = Math.min(1, maxDimension / Math.max(sourceInfo.width, sourceInfo.height));

    if (file.size <= maxBytes && scale >= 1 && /^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      const dataUrl = await fileToDataUrl(file);
      return {
        dataUrl,
        name: file.name,
        width: sourceInfo.width,
        height: sourceInfo.height,
        originalBytes: file.size,
        compressedBytes: dataUrlByteLength(dataUrl),
        compressed: false,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceInfo.width * scale));
    canvas.height = Math.max(1, Math.round(sourceInfo.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持图片压缩');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceInfo.source, 0, 0, canvas.width, canvas.height);

    let bestBlob: Blob | null = null;
    for (let quality = initialQuality; quality >= minQuality; quality -= 0.04) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', Math.max(minQuality, quality));
      bestBlob = blob;
      if (blob.size <= maxBytes) break;
    }

    if (!bestBlob) throw new Error('图片压缩失败');

    const dataUrl = await blobToDataUrl(bestBlob);
    return {
      dataUrl,
      name: jpegName(file.name),
      width: canvas.width,
      height: canvas.height,
      originalBytes: file.size,
      compressedBytes: dataUrlByteLength(dataUrl),
      compressed: bestBlob.size < file.size || scale < 1 || file.type !== 'image/jpeg',
    };
  } finally {
    sourceInfo?.close();
  }
}
