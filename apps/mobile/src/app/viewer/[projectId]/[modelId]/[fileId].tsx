import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
} from 'react-native-webview/lib/WebViewTypes';

import {
  hostMessageToInjectedJs,
  parseClientMessage,
  type HostMessage,
} from '@/features/viewer/embedBridge';
import { resolveEmbedSource } from '@/features/viewer/embedSource';
import { useViewerBundle } from '@/features/viewer/queries';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

/**
 * Phase C: the embedded 3D viewer. A react-native-webview hosts the
 * apps/viewer-embed bundle; native fetches the (token-gated) viewer bundle and
 * pushes the presigned URLs down the bridge, so the WebView stays stateless and
 * tokenless. Pin taps and placed points come back up as bridge messages —
 * wired to the (Phase D) finding flows where the TODOs are.
 */
export default function ViewerScreen() {
  const { tokens } = useAuth();
  const { projectId, modelId, fileId } = useLocalSearchParams<{
    projectId: string;
    modelId: string;
    fileId: string;
  }>();

  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [webCrashed, setWebCrashed] = useState(false);
  // loadModel is sent exactly once, after both the web bridge and the bundle
  // are ready (whichever order they arrive in).
  const sentLoadRef = useRef(false);

  const bundleQuery = useViewerBundle(projectId ?? '', modelId ?? '', fileId ?? '');
  const embedSource = resolveEmbedSource();

  const send = useCallback((msg: HostMessage): void => {
    webRef.current?.injectJavaScript(hostMessageToInjectedJs(msg));
  }, []);

  useEffect(() => {
    if (!webReady || sentLoadRef.current) return;
    const bundle = bundleQuery.data;
    if (!bundle) return; // still loading, errored, or non-IFC
    send({ type: 'loadModel', bundle });
    sentLoadRef.current = true;
  }, [webReady, bundleQuery.data, send]);

  const onMessage = useCallback((e: WebViewMessageEvent): void => {
    const msg = parseClientMessage(e.nativeEvent.data);
    if (msg === null) return;
    switch (msg.type) {
      case 'ready':
        setWebReady(true);
        break;
      case 'modelLoaded':
        setModelLoaded(true);
        break;
      case 'error':
        setViewerError(msg.message);
        break;
      case 'pinTapped':
        // TODO(Phase D): open the finding detail for msg.entityId.
        break;
      case 'pointPicked':
        // TODO(Phase D): open the new-finding form anchored at msg.point.
        break;
      case 'log':
        if (__DEV__) {
          const tag = `[viewer-embed:${msg.level}]`;
          const text = msg.args.join(' ');
          if (msg.level === 'error') console.error(tag, text);
          else if (msg.level === 'warn') console.warn(tag, text);
          else console.log(tag, text);
        }
        break;
      case 'sceneReady':
      case 'progress':
        break;
    }
  }, []);

  const handleReload = useCallback(() => {
    setWebReady(false);
    setModelLoaded(false);
    setViewerError(null);
    setWebCrashed(false);
    sentLoadRef.current = false;
    webRef.current?.reload();
  }, []);

  const onWebViewError = useCallback((e: WebViewErrorEvent) => {
    setViewerError(e.nativeEvent.description ?? 'WebView failed to load');
  }, []);

  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    setViewerError(`Embed load failed: HTTP ${String(e.nativeEvent.statusCode)}`);
  }, []);

  const onRenderProcessGone = useCallback(() => {
    setWebCrashed(true);
  }, []);

  const onContentProcessDidTerminate = useCallback(() => {
    setWebCrashed(true);
  }, []);

  if (tokens === null) return <Redirect href="/login" />;
  if (projectId === undefined || modelId === undefined || fileId === undefined) {
    return <Redirect href="/projects" />;
  }

  const showLoading =
    embedSource !== null &&
    viewerError === null &&
    bundleQuery.data !== null &&
    !bundleQuery.isError &&
    (bundleQuery.isLoading || !modelLoaded);

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Viewer',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.onPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
        }}
      />

      {embedSource === null ? (
        <View style={styles.centered}>
          <Text style={styles.title}>Viewer not configured</Text>
          <Text style={styles.muted}>
            Set EXPO_PUBLIC_VIEWER_EMBED_URL to a served build of apps/viewer-embed
            to load the 3D model here.
          </Text>
        </View>
      ) : (
        <>
          <WebView
            ref={webRef}
            source={embedSource}
            onMessage={onMessage}
            onError={onWebViewError}
            onHttpError={onHttpError}
            onRenderProcessGone={onRenderProcessGone}
            onContentProcessDidTerminate={onContentProcessDidTerminate}
            originWhitelist={['*']}
            androidLayerType="hardware"
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            style={styles.web}
          />

          {webCrashed ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>Renderer crashed</Text>
              <Text style={styles.muted}>
                The 3D viewer ran out of memory or was terminated by the OS.
              </Text>
              <TouchableOpacity style={styles.reloadBtn} onPress={handleReload}>
                <Text style={styles.reloadText}>Tap to reload</Text>
              </TouchableOpacity>
            </View>
          ) : bundleQuery.isError ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>Couldn't load the model</Text>
              <Text style={styles.muted}>{bundleQuery.error.message}</Text>
            </View>
          ) : bundleQuery.data === null && !bundleQuery.isLoading ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>Not viewable</Text>
              <Text style={styles.muted}>This file has no 3D model to display.</Text>
            </View>
          ) : viewerError !== null ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>Viewer error</Text>
              <Text style={styles.muted}>{viewerError}</Text>
              <TouchableOpacity style={styles.reloadBtn} onPress={handleReload}>
                <Text style={styles.reloadText}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : showLoading ? (
            <View style={styles.overlay} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>
                {bundleQuery.isLoading ? 'Loading model…' : 'Rendering…'}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  web: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  reloadBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  reloadText: { color: colors.onPrimary, fontWeight: '600', fontSize: 14 },
});
