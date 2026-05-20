import type { ZodType } from 'zod';

import { env } from '@/lib/env';

import { ApiErrorBodySchema } from './schemas';

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
      const object = (detail !== null && typeof detail === 'object' && !Array.isArray(detail))
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

function parseFilenameFromDisposition(header: string | null): string | null {
  if (header === null) return null;
  const quoted = /filename="([^"]+)"/.exec(header);
  if (quoted !== null && quoted[1] !== undefined) return quoted[1];
  const bare = /filename=([^;]+)/.exec(header);
  if (bare !== null && bare[1] !== undefined) return bare[1].trim();
  return null;
}

// Save a Blob to disk via a synthetic anchor click. Only runs in the browser.
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${options.path}`, init);

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError(response.status, detail.text, detail.object);
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
  delete: async (
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<void> => requestNoContent(
    { method: 'DELETE', path, accessToken },
    body,
  ),
  patchNoContent: async (path: string, accessToken: string): Promise<void> => requestNoContent({
    method: 'PATCH',
    path,
    accessToken,
  }),
  postNoContent: async (
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<void> => requestNoContent(
    { method: 'POST', path, accessToken },
    body,
  ),
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
      throw new ApiError(response.status, detail.text, detail.object);
    }
    const raw: unknown = await response.json();
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  },
  // Authenticated GET that returns the raw response body as a Blob plus the
  // filename parsed from Content-Disposition (when present). Used for binary
  // or non-JSON downloads (CSV, PDF) that bypass Zod validation.
  getBlob: async (
    path: string,
    accessToken: string,
  ): Promise<{ blob: Blob; filename: string | null }> => {
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(accessToken),
    });
    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      throw new ApiError(response.status, detail.text, detail.object);
    }
    return {
      blob: await response.blob(),
      filename: parseFilenameFromDisposition(response.headers.get('Content-Disposition')),
    };
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
