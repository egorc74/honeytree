export const MEDIA_KINDS = ['build', 'screenshot', 'video', 'cover', 'avatar'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ['uploading', 'scanning', 'processing', 'ready', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Byte-level file types we recognise by magic bytes (see magic.ts). */
export type DetectedType =
  'zip' | 'exe' | 'elf' | 'dmg' | 'gzip' | 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'webm';

interface ExtensionRule {
  /** MIME types browsers are known to send for this extension. Empty string means "unknown". */
  mimes: readonly string[];
  /** The content must look like one of these once uploaded. */
  types: readonly DetectedType[];
}

export interface KindRule {
  maxBytes: number;
  extensions: Record<string, ExtensionRule>;
}

const BINARY_MIMES = ['', 'application/octet-stream', 'binary/octet-stream'] as const;

const IMAGE_EXTENSIONS: Record<string, ExtensionRule> = {
  '.png': { mimes: ['image/png'], types: ['png'] },
  '.jpg': { mimes: ['image/jpeg'], types: ['jpeg'] },
  '.jpeg': { mimes: ['image/jpeg'], types: ['jpeg'] },
  '.webp': { mimes: ['image/webp'], types: ['webp'] },
  '.gif': { mimes: ['image/gif'], types: ['gif'] },
};

export const KIND_RULES: Record<MediaKind, KindRule> = {
  build: {
    maxBytes: 2 * GB,
    extensions: {
      '.zip': {
        mimes: ['application/zip', 'application/x-zip-compressed', ...BINARY_MIMES],
        types: ['zip'],
      },
      '.apk': {
        mimes: ['application/vnd.android.package-archive', 'application/zip', ...BINARY_MIMES],
        types: ['zip'],
      },
      '.exe': {
        mimes: [
          'application/x-msdownload',
          'application/vnd.microsoft.portable-executable',
          'application/x-dosexec',
          ...BINARY_MIMES,
        ],
        types: ['exe'],
      },
      '.dmg': {
        mimes: ['application/x-apple-diskimage', ...BINARY_MIMES],
        types: ['dmg'],
      },
      '.appimage': {
        mimes: ['application/x-executable', 'application/x-iso9660-appimage', ...BINARY_MIMES],
        types: ['elf'],
      },
      '.tar.gz': {
        mimes: ['application/gzip', 'application/x-gzip', 'application/x-tar', ...BINARY_MIMES],
        types: ['gzip'],
      },
      '.tgz': {
        mimes: ['application/gzip', 'application/x-gzip', 'application/x-tar', ...BINARY_MIMES],
        types: ['gzip'],
      },
    },
  },
  video: {
    maxBytes: 300 * MB,
    extensions: {
      '.mp4': { mimes: ['video/mp4'], types: ['mp4'] },
      '.mov': { mimes: ['video/quicktime'], types: ['mp4'] },
      '.webm': { mimes: ['video/webm'], types: ['webm'] },
    },
  },
  screenshot: { maxBytes: 10 * MB, extensions: IMAGE_EXTENSIONS },
  cover: { maxBytes: 10 * MB, extensions: IMAGE_EXTENSIONS },
  avatar: { maxBytes: 5 * MB, extensions: IMAGE_EXTENSIONS },
};

/** Per-game caps on non-rejected media. `cover` and `video` are replaced when a new one is ready. */
export const MAX_PER_GAME: Partial<Record<MediaKind, number>> = {
  screenshot: 12,
  build: 8,
};

/** At most this many unfinished uploads of one kind per game or user (abuse guard). */
export const MAX_PENDING_PER_KIND = 4;

export const IMAGE_VARIANT_SIZES = {
  thumb: { width: 320, height: 180 },
  card: { width: 640, height: 360 },
  full: { width: 1600, height: 900 },
} as const;
/** Avatars are square crops. */
export const AVATAR_VARIANT_SIZES = {
  thumb: { width: 128, height: 128 },
  card: { width: 256, height: 256 },
  full: { width: 512, height: 512 },
} as const;

export const UPLOAD_URL_TTL_SECONDS = 60 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/** Uploads stuck in `uploading` longer than this are deleted by the cleanup job. */
export const ABANDONED_UPLOAD_HOURS = 24;

/** Returns the lowercase extension of a filename, treating `.tar.gz` as one extension. */
export function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  const dot = lower.lastIndexOf('.');
  return dot === -1 ? '' : lower.slice(dot);
}

export interface UploadRequest {
  kind: MediaKind;
  filename: string;
  size: number;
  mime: string;
}

export type ValidationResult =
  { ok: true; extension: string; rule: ExtensionRule } | { ok: false; message: string };

/** Checks kind, extension, MIME type and size of an upload request (before any bytes exist). */
export function validateUploadRequest(req: UploadRequest): ValidationResult {
  const kindRule = KIND_RULES[req.kind];
  const extension = fileExtension(req.filename);
  const rule = kindRule.extensions[extension];
  if (!rule) {
    const allowed = Object.keys(kindRule.extensions).join(', ');
    return { ok: false, message: `A ${req.kind} must be one of: ${allowed}.` };
  }
  const mime = req.mime.trim().toLowerCase();
  if (!rule.mimes.includes(mime)) {
    return { ok: false, message: `The file type "${req.mime}" does not match ${extension}.` };
  }
  if (!Number.isInteger(req.size) || req.size <= 0) {
    return { ok: false, message: 'The file is empty.' };
  }
  if (req.size > kindRule.maxBytes) {
    const limit = kindRule.maxBytes / MB;
    return { ok: false, message: `A ${req.kind} can be at most ${limit} MB.` };
  }
  return { ok: true, extension, rule };
}
