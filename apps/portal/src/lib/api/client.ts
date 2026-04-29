import type { ZodType } from 'zod';

import { env } from '@/lib/env';

import { ApiErrorBodySchema } from './schemas';

export class ApiError extends Error {
  public readonly status: number;

  public readonly detail: string;

  public constructor(status: number, detail: string) {
    super(`API error ${String(status)}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
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
};

type NoContentRequestOptions = {
  method: HttpMethod;
  path: string;
  accessToken: string | undefined;
};

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const raw: unknown = await response.json();
    const parsed = ApiErrorBodySchema.safeParse(raw);
    if (parsed.success) {
      const { detail } = parsed.data;
      if (typeof detail === 'string') return detail;
      return JSON.stringify(detail);
    }
    return response.statusText;
  } catch {
    return response.statusText;
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
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (accessToken !== undefined) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

async function request<TResponse, TBody>(
  options: RequestOptions<TBody>,
): Promise<TResponse> {
  const headers = buildHeaders(options.accessToken);

  const init: RequestInit = {
    method: options.method,
    headers,
  };
  if (options.body !== undefined) {
    if (options.formEncoded) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = encodeFormBody(options.body as Record<string, string>);
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${options.path}`, init);

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail);
  }

  const raw: unknown = await response.json();
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return parsed.data as TResponse;
}

async function requestNoContent(options: NoContentRequestOptions): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${options.path}`, {
    method: options.method,
    headers: buildHeaders(options.accessToken),
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail);
  }
}

export const apiClient = {
  postForm: async <TResponse>(
    path: string,
    body: Record<string, string>,
    responseSchema: ZodType<TResponse>,
  ): Promise<TResponse> => request<TResponse, Record<string, string>>({
    method: 'POST',
    path,
    body,
    formEncoded: true,
    responseSchema,
    accessToken: undefined,
  }),
  get: async <TResponse>(
    path: string,
    responseSchema: ZodType<TResponse>,
    accessToken: string | undefined,
  ): Promise<TResponse> => request<TResponse, undefined>({
    method: 'GET',
    path,
    body: undefined,
    formEncoded: false,
    responseSchema,
    accessToken,
  }),
  post: async <TResponse>(
    path: string,
    body: unknown,
    responseSchema: ZodType<TResponse>,
    accessToken: string,
  ): Promise<TResponse> => request<TResponse, unknown>({
    method: 'POST',
    path,
    body,
    formEncoded: false,
    responseSchema,
    accessToken,
  }),
  patch: async <TResponse>(
    path: string,
    body: unknown,
    responseSchema: ZodType<TResponse>,
    accessToken: string,
  ): Promise<TResponse> => request<TResponse, unknown>({
    method: 'PATCH',
    path,
    body,
    formEncoded: false,
    responseSchema,
    accessToken,
  }),
  delete: async (path: string, accessToken: string): Promise<void> => requestNoContent({
    method: 'DELETE',
    path,
    accessToken,
  }),
  postMultipart: async <TResponse>(
    path: string,
    formData: FormData,
    responseSchema: ZodType<TResponse>,
    accessToken: string,
  ): Promise<TResponse> => {
    const headers = buildHeaders(accessToken);
    // Do NOT set Content-Type — the browser sets it with the multipart boundary.
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      throw new ApiError(response.status, detail);
    }
    const raw: unknown = await response.json();
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
    }
    return parsed.data as TResponse;
  },
  // Raw PUT to a presigned URL. Bypasses the JSON request helper because
  // (a) we need to send a Blob, not stringified JSON, and
  // (b) we MUST NOT attach the Authorization header — it would invalidate the
  //     presigned signature.
  putRaw: async (
    url: string,
    body: Blob,
    contentType: string,
  ): Promise<void> => {
    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': contentType },
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Upload failed: ${response.statusText}`);
    }
  },
};
