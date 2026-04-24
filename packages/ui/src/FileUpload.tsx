'use client';

import React, { useCallback, useState } from 'react';

export interface FileUploadProps {
  accept?: string;
  label?: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * Drag-and-drop / click file uploader.
 */
export function FileUpload({
  accept = '*',
  label = 'Drop a file here or click to browse',
  onFile,
  disabled = false,
}: FileUploadProps): React.ReactElement {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      style={{
        border: `2px dashed ${dragging ? '#2563eb' : '#d1d5db'}`,
        borderRadius: 8,
        padding: 32,
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.2s',
      }}
    >
      <label style={{ cursor: 'pointer' }}>
        <input
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          disabled={disabled}
          onChange={handleChange}
        />
        {label}
      </label>
    </div>
  );
}
