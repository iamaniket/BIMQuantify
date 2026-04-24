'use client';

import React, { useState } from 'react';
import { FileUpload } from '@bim-quantify/ui';
import type { TakeoffResult } from '@bim-quantify/ai-takeoff';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export default function TakeoffPage(): React.ReactElement {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TakeoffResult | null>(null);

  async function handleFile(file: File): Promise<void> {
    setStatus('parsing');
    setError(null);
    setResult(null);

    try {
      // 1. Parse the IFC file
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch(`${API_URL}/ifc/parse`, {
        method: 'POST',
        body: formData,
      });
      if (!parseRes.ok) throw new Error(`IFC parse failed: ${parseRes.statusText}`);
      const parseData = (await parseRes.json()) as { elements: unknown[] };

      // 2. Run AI takeoff
      setStatus('running');
      const takeoffRes = await fetch(`${API_URL}/takeoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: parseData.elements }),
      });
      if (!takeoffRes.ok) throw new Error(`Takeoff failed: ${takeoffRes.statusText}`);
      const takeoffData = (await takeoffRes.json()) as TakeoffResult;
      setResult(takeoffData);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>AI Quantity Takeoff</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Upload an IFC file to generate an AI-powered quantity takeoff.
      </p>

      <FileUpload
        accept=".ifc"
        label="Drop your IFC file here or click to browse (.ifc)"
        onFile={handleFile}
        disabled={status === 'parsing' || status === 'running'}
      />

      {status === 'parsing' && <StatusBanner>⏳ Parsing IFC file…</StatusBanner>}
      {status === 'running' && <StatusBanner>🤖 Running AI takeoff…</StatusBanner>}
      {status === 'error' && (
        <StatusBanner color="#ef4444">❌ {error}</StatusBanner>
      )}

      {result && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
            Results — {result.count} items
          </h2>
          <p style={{ color: '#6b7280', marginBottom: 16, fontSize: 14 }}>
            Model: {result.model} · Duration: {result.durationMs}ms
            {result.totalCost != null && ` · Estimated Total: $${result.totalCost.toLocaleString()}`}
          </p>
          <TakeoffResultTable items={result.items} />
        </section>
      )}
    </main>
  );
}

function StatusBanner({
  children,
  color = '#2563eb',
}: {
  children: React.ReactNode;
  color?: string;
}): React.ReactElement {
  return (
    <div
      style={{
        marginTop: 24,
        padding: '12px 20px',
        background: `${color}15`,
        border: `1px solid ${color}`,
        borderRadius: 8,
        color,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

function TakeoffResultTable({
  items,
}: {
  items: TakeoffResult['items'];
}): React.ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            {['Type', 'Name', 'Material', 'Qty', 'Unit', 'Unit Cost', 'Total', 'Confidence'].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    borderBottom: '2px solid #e5e7eb',
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.elementId} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '6px 12px' }}>{item.elementType}</td>
              <td style={{ padding: '6px 12px' }}>{item.elementName ?? '—'}</td>
              <td style={{ padding: '6px 12px' }}>{item.material}</td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>{item.quantity.toFixed(2)}</td>
              <td style={{ padding: '6px 12px' }}>{item.unit}</td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {item.unitCost != null ? `$${item.unitCost.toFixed(2)}` : '—'}
              </td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {item.totalCost != null ? `$${item.totalCost.toFixed(2)}` : '—'}
              </td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {(item.confidence * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
