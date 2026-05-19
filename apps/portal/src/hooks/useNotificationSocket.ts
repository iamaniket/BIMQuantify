'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { env } from '@/lib/env';
import {
  notificationsKey,
  unreadCountKey,
} from '@/features/notifications/queryKeys';

const MAX_RECONNECT_DELAY = 30_000;

export function useNotificationSocket(accessToken: string | null): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(false);
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: notificationsKey }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: unreadCountKey }).catch(() => undefined);
  }, [qc]);

  useEffect(() => {
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
      const ws = new WebSocket(`${wsUrl}/ws/notifications?token=${token}`);
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
  }, [accessToken, invalidate]);
}
