export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthenticated = (message = 'You need to log in') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'FORBIDDEN', message);
export const selfAction = (message: string) => new AppError(403, 'SELF_ACTION', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const invalid = (message: string, details?: unknown, code = 'VALIDATION_ERROR') =>
  new AppError(422, code, message, details);
