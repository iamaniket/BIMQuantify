import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { Ionicons } from '@expo/vector-icons';

import { useT } from '@/i18n';
import {
  hostMessageToInjectedJs,
  parseClientMessage,
  type EmbedMarker2D,
  type HostMessage,
} from '@/features/viewer/embedBridge';
import { resolveEmbedSource } from '@/features/viewer/embedSource';
import { usePinForOffline } from '@/features/viewer/offline/usePinForOffline';
import { usePdfPagesUrl, useViewerBundle } from '@/features/viewer/queries';
import { useProjectFindings } from '@/features/findings/queries';
import type { EmbedViewerBundle } from '@/lib/api/viewerBundle';
import { useNetworkStatus } from '@/lib/offline/networkStatus';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

/**
 * The embedded 3D viewer. A react-native-webview hosts the apps/viewer-embed
 * bundle; native fetches the (token-gated) viewer bundle and pushes the presigned
 * URLs down the bridge, so the WebView stays stateless and tokenless. Pin taps
 * open the finding detail; placed points open the create form pre-anchored (see
 * onMessage).
 */
export default function ViewerScreen() {
  const router = useRouter();
  const { t } = useT();
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
  // loadModel/loadPdf is sent exactly once, after both the web bridge and the
  // bundle are ready (whichever order they arrive in).
  const sentLoadRef = useRef(false);

  const bundleQuery = useViewerBundle(projectId ?? '', modelId ?? '', fileId ?? '');
  // PDF documents (no IFC fragments): a 2D-only page-image viewer. Separate
  // query so the IFC bundle path above is untouched.
  const pdfPagesQuery = usePdfPagesUrl(projectId ?? '', modelId ?? '', fileId ?? '');
  const pdfPagesUrl = pdfPagesQuery.data ?? null;
  const embedSource = resolveEmbedSource();
  const online = useNetworkStatus();
  const pin = usePinForOffline(projectId ?? '', modelId ?? '', fileId ?? '');
  // Prefer the live (presigned) bundle online; fall back to the pinned local
  // file:// manifest when offline. Online viewing is unchanged.
  const effectiveBundle: EmbedViewerBundle | null =
    !online && pin.localBundle !== null ? pin.localBundle : (bundleQuery.data ?? null);

  // PDF (2D) finding pins for this file: PDF-anchored findings only (model
  // findings are 3D-anchored — projecting those onto the plan is a fast-follow).
  const findingsQuery = useProjectFindings(projectId ?? '');
  const markers2D = useMemo<EmbedMarker2D[]>(() => {
    const all = findingsQuery.data ?? [];
    return all
      .filter(
        (f) =>
          f.linked_file_id === fileId &&
          f.linked_file_type === 'pdf' &&
          f.anchor_page != null &&
          f.anchor_x != null &&
          f.anchor_y != null,
      )
      .map((f) => ({
        id: f.id,
        type: 'finding' as const,
        page: f.anchor_page as number,
        x: f.anchor_x as number,
        y: f.anchor_y as number,
        label: f.title,
        entityId: f.id,
        status: f.status,
      }));
  }, [findingsQuery.data, fileId]);

  const send = useCallback((msg: HostMessage): void => {
    webRef.current?.injectJavaScript(hostMessageToInjectedJs(msg));
  }, []);

  useEffect(() => {
    if (!webReady || sentLoadRef.current) return;
    const bundle = effectiveBundle;
    if (bundle) {
      // 2D-only v1: the embed renders the model's floor plan (no 3D / view mode).
      send({ type: 'loadModel', bundle });
      sentLoadRef.current = true;
      return;
    }
    // No IFC bundle, but the file is a rasterized PDF → 2D-only document viewer.
    if (pdfPagesUrl !== null) {
      send({ type: 'loadPdf', pdfPagesUrl });
      sentLoadRef.current = true;
    }
  }, [webReady, effectiveBundle, pdfPagesUrl, send]);

  // Push the file's 2D finding pins once the viewer has loaded, and on changes.
  useEffect(() => {
    if (!modelLoaded) return;
    send({ type: 'syncMarkers2D', markers: markers2D });
  }, [modelLoaded, markers2D, send]);

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
        router.push({
          pathname: '/projects/[projectId]/findings/[findingId]',
          params: { projectId: projectId!, findingId: msg.entityId },
        });
        break;
      case 'pointPicked':
        router.push({
          pathname: '/projects/[projectId]/findings/create',
          params: {
            projectId: projectId!,
            modelId: modelId!,
            fileId: fileId!,
            fileType: 'ifc',
            anchorX: String(msg.point.x),
            anchorY: String(msg.point.y),
            anchorZ: String(msg.point.z),
          },
        });
        break;
      case 'findingPlaced':
        // 2D PDF pin placed → open the create form pre-anchored to the page.
        router.push({
          pathname: '/projects/[projectId]/findings/create',
          params: {
            projectId: projectId!,
            modelId: modelId!,
            fileId: fileId!,
            fileType: 'pdf',
            anchorPage: String(msg.page),
            anchorX: String(msg.x),
            anchorY: String(msg.y),
          },
        });
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
  }, [router, projectId, modelId, fileId]);

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

  // Offline with a pin still loads (from local files); only treat the bundle as
  // errored when there's no effective bundle at all.
  const bundleError = bundleQuery.isError && effectiveBundle === null;
  const showLoading =
    embedSource !== null &&
    viewerError === null &&
    !bundleError &&
    (bundleQuery.isLoading ||
      pdfPagesQuery.isLoading ||
      (effectiveBundle !== null && !modelLoaded) ||
      (pdfPagesUrl !== null && !modelLoaded));

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('viewer.title'),
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.onPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          headerRight: effectiveBundle
            ? () => (
                <View style={styles.headerActions}>
                  <PinToggle
                    pinned={pin.pinned}
                    busy={pin.busy}
                    canPin={online && bundleQuery.data != null}
                    onPin={() => {
                      if (bundleQuery.data != null) void pin.pin(bundleQuery.data);
                    }}
                    onUnpin={() => { void pin.unpin(); }}
                  />
                </View>
              )
            : undefined,
        }}
      />

      {embedSource === null ? (
        <View style={styles.centered}>
          <Text style={styles.title}>{t('viewer.notConfigured')}</Text>
          <Text style={styles.muted}>{t('viewer.notConfiguredBody')}</Text>
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
              <Text style={styles.title}>{t('viewer.rendererCrashed')}</Text>
              <Text style={styles.muted}>{t('viewer.rendererCrashedBody')}</Text>
              <TouchableOpacity style={styles.reloadBtn} onPress={handleReload}>
                <Text style={styles.reloadText}>{t('viewer.tapReload')}</Text>
              </TouchableOpacity>
            </View>
          ) : bundleError ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>{t('viewer.loadFailed')}</Text>
              <Text style={styles.muted}>
                {online
                  ? (bundleQuery.error?.message ?? t('viewer.loadFailedOnline'))
                  : t('viewer.loadFailedOffline')}
              </Text>
            </View>
          ) : effectiveBundle === null &&
            pdfPagesUrl === null &&
            !bundleQuery.isLoading &&
            !pdfPagesQuery.isLoading ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>{t('viewer.notViewable')}</Text>
              <Text style={styles.muted}>{t('viewer.notViewableBody')}</Text>
            </View>
          ) : viewerError !== null ? (
            <View style={styles.overlay}>
              <Text style={styles.title}>{t('viewer.error')}</Text>
              <Text style={styles.muted}>{viewerError}</Text>
              <TouchableOpacity style={styles.reloadBtn} onPress={handleReload}>
                <Text style={styles.reloadText}>{t('viewer.tapRetry')}</Text>
              </TouchableOpacity>
            </View>
          ) : showLoading ? (
            <View style={styles.overlay} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>
                {bundleQuery.isLoading ? t('viewer.loadingModel') : t('viewer.rendering')}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Header control: download the model for offline use, or remove the download. */
function PinToggle({
  pinned,
  busy,
  canPin,
  onPin,
  onUnpin,
}: {
  pinned: boolean;
  busy: boolean;
  canPin: boolean;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const { t } = useT();
  if (busy) {
    return <ActivityIndicator color={colors.onPrimary} size="small" style={styles.pinBtn} />;
  }
  if (pinned) {
    return (
      <TouchableOpacity style={styles.pinBtn} onPress={onUnpin} accessibilityLabel={t('viewer.removeOffline')}>
        <Ionicons name="checkmark-circle" size={22} color={colors.onPrimary} />
      </TouchableOpacity>
    );
  }
  if (!canPin) return null;
  return (
    <TouchableOpacity style={styles.pinBtn} onPress={onPin} accessibilityLabel={t('viewer.saveOffline')}>
      <Ionicons name="cloud-download-outline" size={22} color={colors.onPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinBtn: { padding: 4, minWidth: 28, alignItems: 'center' },
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
