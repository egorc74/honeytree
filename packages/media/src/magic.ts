import type { DetectedType } from './limits';

/** How many bytes from the start of a file `detectType` needs. */
export const HEAD_BYTES = 4096;
/** How many bytes from the end of a file `detectType` needs (for .dmg trailers). */
export const TAIL_BYTES = 512;

const startsWith = (buf: Uint8Array, bytes: readonly number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...buf.subarray(start, end));

/**
 * Identifies a file from its first bytes (and last bytes for UDIF disk images).
 * Returns every plausible type, because for example an APK is also a ZIP.
 */
export function detectTypes(head: Uint8Array, tail?: Uint8Array): DetectedType[] {
  const found: DetectedType[] = [];
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    found.push('zip');
  }
  if (startsWith(head, [0x4d, 0x5a])) found.push('exe'); // "MZ"
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) found.push('elf'); // "\x7fELF"
  if (startsWith(head, [0x1f, 0x8b])) found.push('gzip');
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) found.push('png');
  if (startsWith(head, [0xff, 0xd8, 0xff])) found.push('jpeg');
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') found.push('webp');
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') found.push('gif');
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) found.push('webm'); // EBML header
  // ISO base media: a 4-byte box size, then a known top-level box name.
  const box = ascii(head, 4, 8);
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].includes(box)) found.push('mp4');
  // UDIF (.dmg): a 512-byte "koly" trailer at the very end.
  if (tail && tail.length >= 4) {
    const trailerStart = tail.length >= TAIL_BYTES ? tail.length - TAIL_BYTES : 0;
    if (ascii(tail, trailerStart, trailerStart + 4) === 'koly') found.push('dmg');
  }
  return found;
}

/** True when the content looks like one of the allowed types. */
export function matchesAny(
  allowed: readonly DetectedType[],
  head: Uint8Array,
  tail?: Uint8Array,
): boolean {
  const detected = detectTypes(head, tail);
  return allowed.some((t) => detected.includes(t));
}
