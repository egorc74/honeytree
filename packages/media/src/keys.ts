import { fileExtension } from './limits';

/** Private bucket key of the file exactly as the user uploaded it. */
export const originalKey = (mediaId: string, filename: string) =>
  `uploads/${mediaId}/original${fileExtension(filename)}`;

/** Prefix of everything the pipeline derived from a media item in the public bucket. */
export const variantPrefix = (mediaId: string) => `media/${mediaId}/`;

export const variantKey = (mediaId: string, name: string) => `${variantPrefix(mediaId)}${name}`;
