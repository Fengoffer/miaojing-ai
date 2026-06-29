import fs from 'fs';
import path from 'path';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'stream';
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { fetchPublicHttpUrl } from '@/lib/remote-fetch';

export type StorageMode = 'local' | 'dual' | 'object';

type ObjectStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  prefix: string;
};

export type StorageHealthStatus = {
  ok: boolean;
  mode: StorageMode;
  requestedMode: StorageMode;
  local: {
    required: boolean;
    ok: boolean;
    path: string;
    message?: string;
  };
  object: {
    required: boolean;
    configured: boolean;
    ok: boolean;
    bucket?: string;
    endpoint?: string;
    message?: string;
  };
};

function parseStorageMode(value: string | undefined, objectConfigured: boolean): StorageMode {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'dual' || normalized === 'object') return normalized;
  return objectConfigured ? 'dual' : 'local';
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizePrefix(value: string | undefined): string {
  const normalized = path.posix.normalize((value || '').replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return '';
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\0')) {
    throw new Error('Invalid object storage prefix');
  }
  return normalized;
}

function getLocalBasePath(): string {
  return process.env.LOCAL_STORAGE_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_DIR)
    : path.join(/* turbopackIgnore: true */ process.cwd(), 'local-storage');
}

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const region = process.env.OBJECT_STORAGE_REGION?.trim() || 'auto';
  if (!bucket) return null;
  return {
    bucket,
    region,
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT?.trim() || undefined,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() || undefined,
    forcePathStyle: booleanEnv(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE, true),
    prefix: normalizePrefix(process.env.OBJECT_STORAGE_PREFIX),
  };
}

function createS3Client(config: ObjectStorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
  };
  if (config.endpoint) clientConfig.endpoint = config.endpoint;
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }
  return new S3Client(clientConfig);
}

function objectKey(config: ObjectStorageConfig, key: string): string {
  return config.prefix ? `${config.prefix}/${key}` : key;
}

function encodePathname(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toWebReadableStream(body: unknown): ReadableStream<Uint8Array> {
  if (!body) return new ReadableStream<Uint8Array>();
  if (typeof (body as { transformToWebStream?: () => ReadableStream<Uint8Array> }).transformToWebStream === 'function') {
    return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }
  if (Symbol.asyncIterator in Object(body)) {
    return Readable.toWeb(Readable.from(body as AsyncIterable<Buffer | Uint8Array | string>)) as ReadableStream<Uint8Array>;
  }
  return Readable.toWeb(Readable.from([body as Buffer | Uint8Array | string])) as ReadableStream<Uint8Array>;
}

export function getRequestedStorageMode(): StorageMode {
  return parseStorageMode(process.env.STORAGE_MODE, Boolean(getObjectStorageConfig()));
}

let cachedStorageHealth: { value: StorageHealthStatus; expiresAt: number } | null = null;
const OBJECT_HEAD_TIMEOUT_MS = Number(process.env.OBJECT_STORAGE_HEAD_TIMEOUT_MS || 10_000);
const OBJECT_GET_TIMEOUT_MS = Number(process.env.OBJECT_STORAGE_GET_TIMEOUT_MS || 60_000);
const OBJECT_PUT_TIMEOUT_MS = Number(process.env.OBJECT_STORAGE_PUT_TIMEOUT_MS || 60_000);

class LocalStorage {
  private basePath: string;
  private mode: StorageMode;
  private requestedMode: StorageMode;
  private objectConfig: ObjectStorageConfig | null;
  private s3: S3Client | null;

  constructor() {
    this.basePath = getLocalBasePath();
    this.objectConfig = getObjectStorageConfig();
    this.requestedMode = parseStorageMode(process.env.STORAGE_MODE, Boolean(this.objectConfig));
    this.mode = this.objectConfig ? this.requestedMode : 'local';
    this.s3 = this.objectConfig ? createS3Client(this.objectConfig) : null;
    if (this.usesLocalStorage()) this.ensureDirectoryExists(this.basePath);
  }

  private usesLocalStorage(): boolean {
    return this.mode === 'local' || this.mode === 'dual';
  }

  private usesObjectStorage(): boolean {
    return Boolean(this.objectConfig && this.s3 && (this.mode === 'object' || this.mode === 'dual'));
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private normalizeKey(key: string): string {
    const normalized = path.posix.normalize(key.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\0')) {
      throw new Error('Invalid storage key');
    }
    return normalized;
  }

  private getLocalFilePath(key: string): string {
    const normalized = this.normalizeKey(key);
    const filePath = path.resolve(/* turbopackIgnore: true */ this.basePath, normalized);
    const basePath = path.resolve(/* turbopackIgnore: true */ this.basePath);
    if (filePath !== basePath && !filePath.startsWith(`${basePath}${path.sep}`)) {
      throw new Error('Invalid storage key');
    }
    return filePath;
  }

  private writeLocalFile(key: string, fileContent: Buffer): void {
    const filePath = this.getLocalFilePath(key);
    this.ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, fileContent);
  }

  private readLocalFile(key: string): Buffer {
    return fs.readFileSync(this.getLocalFilePath(key));
  }

  private localFileExists(key: string): boolean {
    return fs.existsSync(this.getLocalFilePath(key));
  }

  private async putObject(key: string, fileContent: Buffer, contentType: string): Promise<void> {
    if (!this.objectConfig || !this.s3) throw new Error('Object storage is not configured');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.objectConfig.bucket,
        Key: objectKey(this.objectConfig, key),
        Body: fileContent,
        ContentType: contentType,
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_PUT_TIMEOUT_MS) },
    );
  }

  private async getObject(key: string): Promise<Buffer> {
    const result = await this.getObjectResult(key);
    return streamToBuffer(result.Body);
  }

  private async getObjectResult(key: string): Promise<GetObjectCommandOutput> {
    if (!this.objectConfig || !this.s3) throw new Error('Object storage is not configured');
    return this.s3.send(
      new GetObjectCommand({
        Bucket: this.objectConfig.bucket,
        Key: objectKey(this.objectConfig, key),
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_GET_TIMEOUT_MS) },
    );
  }

  private async objectExists(key: string): Promise<boolean> {
    if (!this.objectConfig || !this.s3) return false;
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.objectConfig.bucket,
          Key: objectKey(this.objectConfig, key),
        }),
        { abortSignal: AbortSignal.timeout(OBJECT_HEAD_TIMEOUT_MS) },
      );
      return true;
    } catch {
      return false;
    }
  }

  async uploadFile({ fileContent, fileName, contentType }: {
    fileContent: Buffer;
    fileName: string;
    contentType: string;
  }): Promise<string> {
    const key = this.normalizeKey(fileName);
    if (this.usesLocalStorage()) {
      this.writeLocalFile(key, fileContent);
    }
    if (this.usesObjectStorage()) {
      if (this.mode === 'dual') {
        try {
          await this.putObject(key, fileContent, contentType);
        } catch (error) {
          console.warn('[LocalStorage] object mirror write failed:', error);
        }
      } else {
        await this.putObject(key, fileContent, contentType);
      }
    }
    if (!this.usesObjectStorage() && !this.usesLocalStorage()) {
      throw new Error('No storage backend is available');
    }
    return key;
  }

  async uploadFileLocalOnly(input: {
    fileContent: Buffer;
    fileName: string;
    contentType: string;
  }): Promise<string> {
    const { fileContent, fileName } = input;
    const key = this.normalizeKey(fileName);
    this.writeLocalFile(key, fileContent);
    return key;
  }

  async uploadFileObjectOnly({ fileContent, fileName, contentType }: {
    fileContent: Buffer;
    fileName: string;
    contentType: string;
  }): Promise<string> {
    const key = this.normalizeKey(fileName);
    if (this.objectConfig && this.s3) {
      await this.putObject(key, fileContent, contentType);
      return key;
    }
    this.writeLocalFile(key, fileContent);
    return key;
  }

  async uploadFromUrl({ url, timeout }: {
    url: string;
    timeout: number;
  }): Promise<string> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetchPublicHttpUrl(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      const fileName = `remote/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${this.getFileExtension(url)}`;
      
      return this.uploadFile({
        fileContent: Buffer.from(buffer),
        fileName,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
      });
    } catch (error) {
      console.error('[LocalStorage] uploadFromUrl error:', error);
      throw error;
    }
  }

  async generatePresignedUrl({ key }: {
    key: string;
    expireTime: number;
  }): Promise<string> {
    return `/api/local-storage/${this.normalizeKey(key)}`;
  }

  async objectFileExistsAsync(key: string): Promise<boolean> {
    return this.objectExists(this.normalizeKey(key));
  }

  generateObjectReadUrl(
    key: string,
    expiresInSeconds = 300,
    responseHeaders: { contentDisposition?: string; contentType?: string } = {},
  ): string | null {
    if (!this.objectConfig?.endpoint || !this.objectConfig.accessKeyId || !this.objectConfig.secretAccessKey) return null;
    const normalized = this.normalizeKey(key);
    const endpoint = new URL(this.objectConfig.endpoint);
    const objectPath = objectKey(this.objectConfig, normalized);
    const pathname = this.objectConfig.forcePathStyle
      ? `/${this.objectConfig.bucket}/${encodePathname(objectPath)}`
      : `/${encodePathname(objectPath)}`;
    const host = this.objectConfig.forcePathStyle
      ? endpoint.host
      : `${this.objectConfig.bucket}.${endpoint.host}`;
    const now = new Date();
    const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = iso.slice(0, 8);
    const scope = `${date}/${this.objectConfig.region}/s3/aws4_request`;
    const params: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.objectConfig.accessKeyId}/${scope}`,
      'X-Amz-Date': iso,
      'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(expiresInSeconds)))),
      'X-Amz-SignedHeaders': 'host',
    };
    if (responseHeaders.contentDisposition) {
      params['response-content-disposition'] = responseHeaders.contentDisposition;
    }
    if (responseHeaders.contentType) {
      params['response-content-type'] = responseHeaders.contentType;
    }
    const canonicalQuery = Object.keys(params)
      .sort()
      .map(param => `${encodeQueryValue(param)}=${encodeQueryValue(params[param])}`)
      .join('&');
    const canonicalRequest = [
      'GET',
      pathname,
      canonicalQuery,
      `host:${host}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      iso,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.objectConfig.secretAccessKey}`, date), this.objectConfig.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const url = new URL(endpoint.toString());
    url.host = host;
    url.pathname = pathname;
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private getFileExtension(url: string): string {
    const match = url.split('?')[0]?.match(/\.([^.]+)$/);
    return match ? match[1] : 'bin';
  }

  getFilePath(key: string): string {
    return this.getLocalFilePath(key);
  }

  fileExists(key: string): boolean {
    const normalized = this.normalizeKey(key);
    return this.usesLocalStorage() && this.localFileExists(normalized);
  }

  localFileExistsOnly(key: string): boolean {
    return this.localFileExists(this.normalizeKey(key));
  }

  async fileExistsAsync(key: string): Promise<boolean> {
    const normalized = this.normalizeKey(key);
    if (this.usesObjectStorage() && await this.objectExists(normalized)) return true;
    return this.usesLocalStorage() && this.localFileExists(normalized);
  }

  async readFileAsync(key: string): Promise<Buffer> {
    const normalized = this.normalizeKey(key);
    if (this.usesObjectStorage()) {
      try {
        return await this.getObject(normalized);
      } catch (error) {
        if (!this.usesLocalStorage()) throw error;
      }
    }
    return this.readLocalFile(normalized);
  }

  async openFileStreamAsync(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    contentLength?: number;
    contentType?: string;
  }> {
    const normalized = this.normalizeKey(key);
    if (this.usesObjectStorage()) {
      try {
        const result = await this.getObjectResult(normalized);
        return {
          body: toWebReadableStream(result.Body),
          contentLength: result.ContentLength,
          contentType: result.ContentType,
        };
      } catch (error) {
        if (!this.usesLocalStorage()) throw error;
      }
    }
    if (!this.usesLocalStorage() || !this.localFileExists(normalized)) {
      throw new Error('File not found');
    }
    const filePath = this.getLocalFilePath(normalized);
    const stat = fs.statSync(filePath);
    return {
      body: Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>,
      contentLength: stat.size,
    };
  }

  readFile(key: string): Buffer {
    const normalized = this.normalizeKey(key);
    if (this.usesLocalStorage() && this.localFileExists(normalized)) {
      return this.readLocalFile(normalized);
    }
    throw new Error('File is not available on local disk; use readFileAsync for object storage');
  }

  getKeyFromPublicUrl(url: string): string | null {
    const marker = '/api/local-storage/';
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
  }

  async copyPublicUrlToFolder(url: string, folder: string, options: { storageTarget?: 'default' | 'local' | 'object' } = {}): Promise<string> {
    const existingKey = this.getKeyFromPublicUrl(url);
    let buffer: Buffer;
    let ext = this.getFileExtension(url);

    if (existingKey && await this.fileExistsAsync(existingKey)) {
      buffer = await this.readFileAsync(existingKey);
      ext = path.extname(existingKey).replace('.', '') || ext;
    } else if (url.startsWith('http')) {
      const response = await fetchPublicHttpUrl(url);
      if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
      ext = this.getFileExtension(url);
    } else {
      return url;
    }

    const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'bin'}`;
    const uploadInput = {
      fileContent: buffer,
      fileName: key,
      contentType: 'application/octet-stream',
    };
    const savedKey = options.storageTarget === 'object'
      ? await this.uploadFileObjectOnly(uploadInput)
      : options.storageTarget === 'local'
        ? await this.uploadFileLocalOnly(uploadInput)
        : await this.uploadFile(uploadInput);
    return this.generatePresignedUrl({ key: savedKey, expireTime: 2592000 });
  }

  async getHealthStatus(): Promise<StorageHealthStatus> {
    return getStorageHealthStatus();
  }
}

export async function getStorageHealthStatus(): Promise<StorageHealthStatus> {
  const now = Date.now();
  if (cachedStorageHealth && cachedStorageHealth.expiresAt > now) {
    return cachedStorageHealth.value;
  }
  const objectConfig = getObjectStorageConfig();
  const requestedMode = parseStorageMode(process.env.STORAGE_MODE, Boolean(objectConfig));
  const mode = objectConfig ? requestedMode : 'local';
  const localRequired = mode === 'local' || mode === 'dual';
  const objectRequired = requestedMode === 'object' || requestedMode === 'dual';
  const localPath = getLocalBasePath();
  const local = {
    required: localRequired,
    ok: !localRequired,
    path: localPath,
    message: undefined as string | undefined,
  };
  const object = {
    required: objectRequired,
    configured: Boolean(objectConfig),
    ok: !objectRequired,
    bucket: objectConfig?.bucket,
    endpoint: objectConfig?.endpoint,
    message: undefined as string | undefined,
  };

  if (localRequired) {
    try {
      fs.mkdirSync(localPath, { recursive: true });
      fs.accessSync(localPath, fs.constants.R_OK | fs.constants.W_OK);
      local.ok = true;
    } catch (error) {
      local.ok = false;
      local.message = error instanceof Error ? error.message : 'local storage check failed';
    }
  }

  if (objectRequired) {
    if (!objectConfig) {
      object.ok = false;
      object.message = 'object storage is required but OBJECT_STORAGE_BUCKET is not configured';
    } else {
      try {
        const s3 = createS3Client(objectConfig);
        await s3.send(
          new HeadBucketCommand({ Bucket: objectConfig.bucket }),
          { abortSignal: AbortSignal.timeout(6000) },
        );
        object.ok = true;
      } catch (error) {
        object.ok = false;
        object.message = error instanceof Error ? error.message : 'object storage check failed';
      }
    }
  }

  const status = {
    ok: local.ok && object.ok,
    mode,
    requestedMode,
    local,
    object,
  };
  cachedStorageHealth = { value: status, expiresAt: now + 30_000 };
  return status;
}

export const localStorage = new LocalStorage();
export default LocalStorage;
