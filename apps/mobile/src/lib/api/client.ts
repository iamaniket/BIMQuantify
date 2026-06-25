import type { ZodType } from 'zod';

import { env } from '@/lib/env';
import { ApiErrorBodySchema } from '@/lib/api/schemas/common';

// Platform-neutral fetch client, ported from apps/portal/src/lib/api/client.ts.
// React Native provides fetch / FormData / URLSearchParams / Blob as globals, so
// this needs no DOM. Base URL comes from the app's own env (no injection needed).

export class ApiError extends Error {
  public readonly status: number;

  public readonly detail: string;

  public readonly detailObject: Record<string, unknown> | null;

  public constructor(
    status: number,
    detail: string,
    detailObject: Record<string, unknown> | null = null,
  ) {
    super(`API error ${String(status)}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.detailObject = detailObject;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestOptions<TBody> = {
  method: HttpMethod;
  path: string;
  body: TBody | undefined;
  formEncoded: boolean;
  responseSchema: ZodType<unknown>;
  accessToken: string | undefined;
  extraHeaders?: Record<string, string>;
};

type NoContentRequestOptions = {
  method: HttpMethod;
  path: string;
  accessToken: string | undefined;
};

type ParsedErrorDetail = {
  text: string;
  object: Record<string, unknown> | null;
};

async function parseErrorDetail(response: Response): Promise<ParsedErrorDetail> {
  try {
    const raw: unknown = await response.json();
    const parsed = ApiErrorBodySchema.safeParse(raw);
    if (parsed.success) {
      const { detail } = parsed.data;
      if (typeof detail === 'string') return { text: detail, object: null };
      const object = detail !== null && typeof detail === 'object' && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : null;
      return { text: JSON.stringify(detail), object };
    }
    return { text: response.statusText, object: null };
  } catch {
    return { text: response.statusText, object: null };
  }
}

function encodeFormBody(body: Record<string, string>): string {
  const params = new URLSearchParams();
  Object.entries(body).forEach(([key, value]) => {
    params.append(key, value);
  });
  return params.toString();
}

function buildHeaders(accessToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken !== undefined) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

async function request<TResponse, TBody>(options: RequestOptions<TBody>): Promise<TResponse> {
  const headers = buildHeaders(options.accessToken);
  if (options.extraHeaders !== undefined) {
    Object.assign(headers, options.extraHeaders);
  }
  const init: RequestInit = { method: options.method, headers };
  if (options.body !== undefined) {
    if (options.formEncoded) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = encodeFormBody(options.body as Record<string, string>);
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }

  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${options.path}`, init);
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail.text, detail.object);
  }

  const raw: unknown = await response.json();
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return parsed.data as TResponse;
}

async function requestNoContent(
  options: NoContentRequestOptions,
  body?: unknown,
): Promise<void> {
  const headers = buildHeaders(options.accessToken);
  const init: RequestInit = { method: options.method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${options.path}`, init);
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail.text, detail.object);
  }
}

export type PaginatedResponse<T> = {
  data: T;
  totalCount: number | null;
};

async function requestWithMeta<TResponse, TBody>(
  options: RequestOptions<TBody>,
): Promise<PaginatedResponse<TResponse>> {
  const headers = buildHeaders(options.accessToken);
  const init: RequestInit = { method: options.method, headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${options.path}`, init);
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail.text, detail.object);
  }

  const rawCount = response.headers.get('X-Total-Count');
  // Guard NaN from a malformed header (Number('abc')) so it can't poison
  // pagination math; degrade to the explicit "unknown total" null path.
  const parsedCount = rawCount !== null ? Number(rawCount) : null;
  const totalCount = parsedCount !== null && Number.isFinite(parsedCount) ? parsedCount : null;
  const raw: unknown = await response.json();
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return { data: parsed.data as TResponse, totalCount };
}

export const apiClient = {
  postForm: async <TResponse>(
    path: string,
    body: Record<string, string>,
    responseSchema: ZodType<TResponse>,
  ): Promise<TResponse> => request<TResponse, Record<string, string>>({
    method: 'POST', path, body, formEncoded: true, responseSchema, accessToken: undefined,
  }),
  get: async <TResponse>(
    path: string,
    responseSchema: ZodType<TResponse>,
    accessToken: string | undefined,
  ): Promise<TResponse> => request<TResponse, undefined>({
    method: 'GET', path, body: undefined, formEncoded: false, responseSchema, accessToken,
  }),
  getWithMeta: async <TResponse>(
    path: string,
    responseSchema: ZodType<TResponse>,
    accessToken: string | undefined,
  ): Promise<PaginatedResponse<TResponse>> => requestWithMeta<TResponse, undefined>({
    method: 'GET', path, body: undefined, formEncoded: false, responseSchema, accessToken,
  }),
  post: async <TResponse>(
    path: string,
    body: unknown,
    responseSchema: ZodType<TResponse>,
    accessToken: string,
    extraHeaders?: Record<string, string>,
  ): Promise<TResponse> => request<TResponse, unknown>({
    method: 'POST', path, body, formEncoded: false, responseSchema, accessToken, extraHeaders,
  }),
  patch: async <TResponse>(
    path: string,
    body: unknown,
    responseSchema: ZodType<TResponse>,
    accessToken: string,
  ): Promise<TResponse> => request<TResponse, unknown>({
    method: 'PATCH', path, body, formEncoded: false, responseSchema, accessToken,
  }),
  delete: async (path: string, accessToken: string, body?: unknown): Promise<void> =>
    requestNoContent({ method: 'DELETE', path, accessToken }, body),
  postNoContent: async (path: string, accessToken: string, body?: unknown): Promise<void> =>
    requestNoContent({ method: 'POST', path, accessToken }, body),
};
