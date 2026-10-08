import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { TraceEvent } from '../types/agent';

export interface UseSSEOptions {
  url: string;
  onEvent: (event: TraceEvent) => void;
  onError?: (error: Error) => void;
}

export interface SSEConnectOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
}

export function useSSE({ url, onEvent, onError }: UseSSEOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);

  // Keep callbacks in refs so the handlers always see the latest version
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const disconnect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setConnected(false);
    setStreaming(false);
  }, []);

  const connect = useCallback(
    (options?: SSEConnectOptions) => {
      disconnect();

      const method = options?.method ?? 'GET';
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const headers: Record<string, string> = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers ?? {}),
      };

      const body =
        method === 'POST' && options?.body !== undefined
          ? JSON.stringify(options.body)
          : undefined;

      fetchEventSource(url, {
        method,
        headers,
        body,
        signal: ctrl.signal,
        openWhenHidden: true,

        async onopen(response) {
          if (response.ok) {
            setConnected(true);
            setStreaming(true);
          } else {
            onErrorRef.current?.(new Error(`SSE request failed: ${response.status}`));
            disconnect();
            throw new Error(`SSE request failed: ${response.status}`);
          }
        },

        onmessage(msg) {
          const eventName = msg.event || 'message';
          const raw = msg.data;
          if (!raw?.trim()) {
            return;
          }
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            payload = { raw };
          }
          onEventRef.current({ event: eventName, data: payload });
        },

        onclose() {
          setStreaming(false);
          setConnected(false);
        },

        onerror(err) {
          onErrorRef.current?.(err instanceof Error ? err : new Error('SSE connection error'));
          setConnected(false);
          setStreaming(false);
          // Don't retry — throw to stop reconnecting
          throw err;
        },
      });
    },
    [disconnect, url],
  );

  useEffect(() => () => disconnect(), [disconnect]);

  return useMemo(
    () => ({
      connected,
      streaming,
      connect,
      disconnect,
    }),
    [connected, streaming, connect, disconnect],
  );
}

export default useSSE;
