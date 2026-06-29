'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { env } from '@/lib/env';
import {
  notificationsKey,
  unreadCountKey,
} from '@/features/notifications/queryKeys';
import { isProjectActivityQueryKey } from '@/features/projects/queryKeys';

const MAX_RECONNECT_DELAY = 30_000;

export function useNotificationSocket(
  accessToken: string | null,
  opts?: { free?: boolean },
): void {
  const free = opts?.free ?? false;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(false);
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: notificationsKey }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: unreadCountKey }).catch(() => undefined);
    // Server-side completions (e.g. model conversion → job_succeeded/job_failed)
    // arrive over this socket; refresh the mounted project-activity feed too so
    // it reflects the new audit row without a reload.
    qc.invalidateQueries({
      predicate: (q) => isProjectActivityQueryKey(q.queryKey),
    }).catch(() => undefined);
  }, [qc]);

  useEffect(() => {
    // E2E: keep the notifications WebSocket closed. Its unbounded reconnect
    // loop keeps the post-login dashboard page perpetually active, which stalls
    // Playwright --ui screencast/trace finalization and surfaces as a spurious
    // 120s test timeout (e.g. multitenant A1+). No e2e test asserts on live
    // notifications; the HTTP /notifications endpoints still work. Opt back in
    // per-case by not setting NEXT_PUBLIC_E2E for that run.
    if (env.NEXT_PUBLIC_E2E === '1') {
      return undefined;
    }
    if (accessToken === null) {
      shouldReconnect.current = false;
      reconnectAttempt.current = 0;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return undefined;
    }
    const token: string = accessToken;
    shouldReconnect.current = true;

    function openSocket(): void {
      if (!shouldReconnect.current) {
        return;
      }
      const httpUrl = env.NEXT_PUBLIC_API_URL;
      const wsUrl = httpUrl.replace(/^http/, 'ws');
      // Pass the access token via the Sec-WebSocket-Protocol handshake
      // (['bearer', <token>]), NOT the URL query string — a token in the URL is
      // logged by proxies, the uvicorn access log, and browser history (M-ws).
      // The server reads the token off the subprotocol and echoes 'bearer'.
      // Free (org-less) users use the per-user free channel; paid use the org one.
      const path = free ? '/ws/free-notifications' : '/ws/notifications';
      const ws = new WebSocket(`${wsUrl}${path}`, ['bearer', token]);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        reconnectAttempt.current = 0;
      });

      ws.addEventListener('message', () => {
        invalidate();
      });

      ws.addEventListener('close', () => {
        if (!shouldReconnect.current) {
          return;
        }
        const delay = Math.min(
          1000 * 2 ** reconnectAttempt.current,
          MAX_RECONNECT_DELAY,
        );
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(openSocket, delay);
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    }

    openSocket();

    return () => {
      shouldReconnect.current = false;
      reconnectAttempt.current = 0;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [accessToken, invalidate, free]);
}
