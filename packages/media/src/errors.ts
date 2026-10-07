export class MediaError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export const notFound = (what = 'Upload') =>
  new MediaError('UPLOAD_NOT_FOUND', 404, `${what} not found.`);
export const forbidden = (message = 'You do not have access to this.') =>
  new MediaError('FORBIDDEN', 403, message);
export const unauthenticated = () =>
  new MediaError('UNAUTHENTICATED', 401, 'You need to log in to do that.');
