export interface MediaLike {
  id: string;
  gameId?: string | null;
  kind: string;
  originalName: string;
  mime: string;
  sizeBytes: number | bigint | string;
  status: string;
  variants?: unknown;
  sortOrder?: number;
  createdAt: Date | string;
}

interface StoredVariant {
  key?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface MediaVariantDto {
  url: string;
  width: number;
  height: number;
  durationSec?: number;
}

export interface MediaDto {
  id: string;
  gameId: string | null;
  kind: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  status: string;
  rejectReason: string | null;
  sortOrder: number;
  variants: Record<string, MediaVariantDto>;
  createdAt: string;
}

/**
 * The public JSON shape of a media row. Accepts both the camelCase rows this package
 * produces and Prisma's camelCase model objects. Variants are stored as storage keys and
 * turned into absolute URLs here, so the public host can change without a data migration.
 */
export function serializeMedia(
  m: MediaLike,
  publicBaseUrl: string = process.env.S3_PUBLIC_BASE_URL ?? '',
): MediaDto {
  const base = publicBaseUrl.replace(/\/$/, '');
  const stored = (m.variants && typeof m.variants === 'object' ? m.variants : {}) as Record<
    string,
    unknown
  >;
  const variants: Record<string, MediaVariantDto> = {};
  for (const [name, value] of Object.entries(stored)) {
    const v = value as StoredVariant;
    if (v && typeof v === 'object' && typeof v.key === 'string') {
      variants[name] = {
        url: `${base}/${v.key}`,
        width: v.width ?? 0,
        height: v.height ?? 0,
        ...(v.durationSec !== undefined ? { durationSec: v.durationSec } : {}),
      };
    }
  }
  return {
    id: m.id,
    gameId: m.gameId ?? null,
    kind: m.kind,
    originalName: m.originalName,
    mime: m.mime,
    sizeBytes: Number(m.sizeBytes),
    status: m.status,
    rejectReason: typeof stored.rejectReason === 'string' ? stored.rejectReason : null,
    sortOrder: m.sortOrder ?? 0,
    variants,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}
