'use client';

import { MapPin } from 'lucide-react';
import { useCallback, type JSX } from 'react';

import type { PageDimensions } from '@bimstitch/viewer';
import type { Attachment } from '@/lib/api/schemas';

export type PdfPin = {
  attachmentId: string;
  x: number;
  y: number;
  attachment: Attachment;
};

type PdfAnnotationLayerProps = {
  pins: PdfPin[];
  dims: PageDimensions;
  pinMode: boolean;
  onPinClick: (attachmentId: string) => void;
  onPinPlace: (point: { x: number; y: number }) => void;
};

export function PdfAnnotationLayer({
  pins,
  dims,
  pinMode,
  onPinClick,
  onPinPlace,
}: PdfAnnotationLayerProps): JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!pinMode) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      onPinPlace({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    },
    [pinMode, onPinPlace],
  );

  return (
    <div
      onClick={handleClick}
      style={{
        width: dims.width,
        height: dims.height,
        position: 'relative',
        pointerEvents: pinMode || pins.length > 0 ? 'auto' : 'none',
        cursor: pinMode ? 'crosshair' : 'default',
      }}
    >
      {pins.map((pin) => (
        <button
          key={pin.attachmentId}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPinClick(pin.attachmentId);
          }}
          style={{
            position: 'absolute',
            left: `${pin.x * 100}%`,
            top: `${pin.y * 100}%`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'auto',
          }}
          className="group cursor-pointer border-none bg-transparent p-0"
          title={pin.attachment.original_filename}
        >
          <MapPin className="h-6 w-6 fill-primary stroke-white drop-shadow-md transition-transform group-hover:scale-125" />
        </button>
      ))}
    </div>
  );
}
