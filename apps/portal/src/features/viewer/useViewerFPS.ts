'use client';

import { useEffect, useRef, useState } from 'react';

export function useViewerFPS(active: boolean): number {
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    if (!active) {
      setFps(0);
      return undefined;
    }

    let raf: number;
    const tick = () => {
      frameCount.current++;
      const now = performance.now();
      const elapsed = now - lastTime.current;
      if (elapsed >= 500) {
        setFps(Math.round((frameCount.current / elapsed) * 1000));
        frameCount.current = 0;
        lastTime.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return fps;
}
