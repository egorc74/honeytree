import { describe, expect, it } from 'vitest';
import { detectTypes } from '../src/core';

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(64).fill(0)]);
const text = (s: string, offset = 0) =>
  Uint8Array.from([...new Array(offset).fill(0), ...Buffer.from(s), ...new Array(64).fill(0)]);

describe('detectTypes', () => {
  it('recognises common signatures', () => {
    expect(detectTypes(bytes(0x50, 0x4b, 0x03, 0x04))).toContain('zip');
    expect(detectTypes(bytes(0x4d, 0x5a))).toContain('exe');
    expect(detectTypes(bytes(0x7f, 0x45, 0x4c, 0x46))).toContain('elf');
    expect(detectTypes(bytes(0x1f, 0x8b))).toContain('gzip');
    expect(detectTypes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toContain('png');
    expect(detectTypes(bytes(0xff, 0xd8, 0xff, 0xe0))).toContain('jpeg');
    expect(detectTypes(text('GIF89a'))).toContain('gif');
    expect(detectTypes(bytes(0x1a, 0x45, 0xdf, 0xa3))).toContain('webm');
  });

  it('recognises webp only with both RIFF and WEBP markers', () => {
    const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
    expect(detectTypes(webp)).toContain('webp');
    const wav = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVEfmt ')]);
    expect(detectTypes(wav)).not.toContain('webp');
  });

  it('recognises mp4 / mov by their top-level box', () => {
    expect(detectTypes(text('ftypisom', 4))).toContain('mp4');
    expect(detectTypes(text('moov', 4))).toContain('mp4');
  });

  it('recognises UDIF disk images by the trailer', () => {
    const tail = new Uint8Array(512);
    tail.set(Buffer.from('koly'), 0);
    expect(detectTypes(bytes(0), tail)).toContain('dmg');
    expect(detectTypes(bytes(0), new Uint8Array(512))).not.toContain('dmg');
  });

  it('does not mistake text for anything', () => {
    expect(detectTypes(text('hello world'))).toEqual([]);
  });
});
