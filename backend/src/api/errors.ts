import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = (message: string) => new HttpError(403, 'forbidden', message);
export const unauthorized = (message: string) => new HttpError(401, 'unauthorized', message);

/** zod parse that turns validation failures into a 400 with the issue list. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}
