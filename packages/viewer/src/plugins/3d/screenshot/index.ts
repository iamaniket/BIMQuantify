import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'screenshot' as const;

export interface ScreenshotPluginOptions {
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
}

export interface ScreenshotCaptureOptions {
  width?: number;
  height?: number;
  transparent?: boolean;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
}

export interface ScreenshotResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ScreenshotPluginAPI {
  capture(options?: ScreenshotCaptureOptions): ScreenshotResult;
  download(filename?: string, options?: ScreenshotCaptureOptions): void;
}

export function screenshotPlugin(
  options: ScreenshotPluginOptions = {},
): Plugin & ScreenshotPluginAPI {
  const defaultFormat = options.format ?? 'image/png';
  const defaultQuality = options.quality ?? 0.92;

  let ctxRef: ViewerContext | null = null;

  const renderFrame = (ctx: ViewerContext): void => {
    ctx.renderer.render(ctx.scene, ctx.camera);
  };

  const captureAtCanvasSize = (
    ctx: ViewerContext,
    format: string,
    quality: number,
    transparent: boolean,
  ): ScreenshotResult => {
    const savedBg = ctx.scene.background;
    const savedClearAlpha = ctx.renderer.getClearAlpha();

    if (transparent) {
      ctx.scene.background = null;
      ctx.renderer.setClearAlpha(0);
    }

    renderFrame(ctx);

    const dataUrl = ctx.canvas.toDataURL(format, quality);
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    if (transparent) {
      ctx.scene.background = savedBg;
      ctx.renderer.setClearAlpha(savedClearAlpha);
    }

    return { dataUrl, width, height };
  };

  const captureAtCustomSize = (
    ctx: ViewerContext,
    w: number,
    h: number,
    format: string,
    quality: number,
    transparent: boolean,
  ): ScreenshotResult => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    const savedBg = ctx.scene.background;
    const savedClearAlpha = ctx.renderer.getClearAlpha();
    const savedSize = new THREE.Vector2();
    ctx.renderer.getSize(savedSize);

    if (transparent) {
      ctx.scene.background = null;
      ctx.renderer.setClearAlpha(0);
    }

    ctx.renderer.setSize(w, h, false);
    ctx.renderer.setRenderTarget(rt);
    ctx.renderer.render(ctx.scene, ctx.camera);

    const pixels = new Uint8Array(w * h * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);

    ctx.renderer.setRenderTarget(null);
    ctx.renderer.setSize(savedSize.x, savedSize.y, false);

    if (transparent) {
      ctx.scene.background = savedBg;
      ctx.renderer.setClearAlpha(savedClearAlpha);
    }

    rt.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d')!;
    const imageData = ctx2d.createImageData(w, h);

    // WebGL reads bottom-to-top; flip vertically.
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      imageData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
    }
    ctx2d.putImageData(imageData, 0, 0);

    const dataUrl = canvas.toDataURL(format, quality);

    // Re-render at original size to keep the viewport correct.
    renderFrame(ctx);

    return { dataUrl, width: w, height: h };
  };

  const capture = (opts?: ScreenshotCaptureOptions): ScreenshotResult => {
    if (!ctxRef) throw new Error('Screenshot plugin not installed');

    const format = opts?.format ?? defaultFormat;
    const quality = opts?.quality ?? defaultQuality;
    const transparent = opts?.transparent ?? false;
    const customW = opts?.width;
    const customH = opts?.height;

    let result: ScreenshotResult;

    if (customW && customH) {
      result = captureAtCustomSize(ctxRef, customW, customH, format, quality, transparent);
    } else {
      result = captureAtCanvasSize(ctxRef, format, quality, transparent);
    }

    ctxRef.events.emit('screenshot:captured', { width: result.width, height: result.height });
    return result;
  };

  const download = (filename?: string, opts?: ScreenshotCaptureOptions): void => {
    const result = capture(opts);
    const ext = (opts?.format ?? defaultFormat) === 'image/jpeg' ? 'jpg' : 'png';
    const name = filename ?? `screenshot-${String(Date.now())}.${ext}`;
    const a = document.createElement('a');
    a.href = result.dataUrl;
    a.download = name;
    a.click();
  };

  const api: Plugin & ScreenshotPluginAPI = {
    name: NAME,

    capture,
    download,

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'screenshot.capture',
        (args: unknown) => capture(args as ScreenshotCaptureOptions | undefined),
        { title: 'Capture screenshot' },
      );

      ctx.commands.register(
        'screenshot.download',
        (args: unknown) => {
          const a = args as ({ filename?: string } & ScreenshotCaptureOptions) | undefined;
          download(a?.filename, a);
        },
        { title: 'Download screenshot', defaultShortcut: '5' },
      );
    },

    uninstall() {
      ctxRef = null;
    },
  };

  return api;
}
