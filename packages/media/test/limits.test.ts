import { describe, expect, it } from 'vitest';
import { fileExtension, validateUploadRequest } from '../src/core';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('fileExtension', () => {
  it('handles .tar.gz and case', () => {
    expect(fileExtension('Game.TAR.GZ')).toBe('.tar.gz');
    expect(fileExtension('a.b.zip')).toBe('.zip');
    expect(fileExtension('noext')).toBe('');
  });
});

describe('validateUploadRequest', () => {
  const ok = (kind: string, filename: string, size: number, mime: string) =>
    validateUploadRequest({ kind: kind as never, filename, size, mime });

  it('accepts valid uploads', () => {
    expect(ok('build', 'game.zip', 1 * GB, 'application/zip').ok).toBe(true);
    expect(ok('build', 'Game.AppImage', 100, 'application/octet-stream').ok).toBe(true);
    expect(ok('video', 'trailer.mp4', 300 * MB, 'video/mp4').ok).toBe(true);
    expect(ok('screenshot', 'a.png', 10 * MB, 'image/png').ok).toBe(true);
  });

  it('enforces the size limits from PLAN.md', () => {
    expect(ok('build', 'game.zip', 2 * GB, 'application/zip').ok).toBe(true);
    expect(ok('build', 'game.zip', 2 * GB + 1, 'application/zip').ok).toBe(false);
    expect(ok('video', 'a.mp4', 300 * MB + 1, 'video/mp4').ok).toBe(false);
    expect(ok('cover', 'a.png', 10 * MB + 1, 'image/png').ok).toBe(false);
    expect(ok('cover', 'a.png', 0, 'image/png').ok).toBe(false);
  });

  it('rejects wrong extensions and mismatched MIME types', () => {
    expect(ok('build', 'game.rar', 10, 'application/x-rar').ok).toBe(false);
    expect(ok('screenshot', 'a.exe', 10, 'application/octet-stream').ok).toBe(false);
    expect(ok('screenshot', 'a.png', 10, 'video/mp4').ok).toBe(false);
    expect(ok('video', 'a.mp4', 10, 'image/png').ok).toBe(false);
  });
});
