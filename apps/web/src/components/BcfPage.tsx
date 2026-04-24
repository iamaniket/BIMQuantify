'use client';

import React, { useState } from 'react';
import { FileUpload, BcfIssueList } from '@bim-quantify/ui';
import type { BcfParseResult, BcfTopic } from '@bim-quantify/bcf-parser';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export default function BcfPage(): React.ReactElement {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BcfParseResult | null>(null);
  const [selected, setSelected] = useState<BcfTopic | null>(null);

  async function handleFile(file: File): Promise<void> {
    setStatus('parsing');
    setError(null);
    setResult(null);
    setSelected(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/bcf/parse`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`BCF parse failed: ${res.statusText}`);
      const data = (await res.json()) as BcfParseResult;
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>BCF Issue Viewer</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Upload a BCF 2.1 zip archive to view collaboration issues and viewpoints.
      </p>

      <FileUpload
        accept=".bcfzip,.bcf,.zip"
        label="Drop your BCF zip file here or click to browse"
        onFile={handleFile}
        disabled={status === 'parsing'}
      />

      {status === 'parsing' && (
        <p style={{ marginTop: 16, color: '#2563eb' }}>⏳ Parsing BCF file…</p>
      )}
      {status === 'error' && (
        <p style={{ marginTop: 16, color: '#ef4444' }}>❌ {error}</p>
      )}

      {result && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.count} Issue{result.count !== 1 ? 's' : ''} — BCF v{result.version}
          </h2>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
            Parsed in {result.durationMs}ms
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 24 }}>
            <BcfIssueList topics={result.topics} onSelect={setSelected} />

            {selected && (
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <button
                  onClick={() => setSelected(null)}
                  style={{
                    float: 'right',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 18,
                  }}
                >
                  ×
                </button>
                <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{selected.title}</h3>
                {selected.description && (
                  <p style={{ color: '#4b5563', marginBottom: 12, fontSize: 14 }}>
                    {selected.description}
                  </p>
                )}
                <dl style={{ fontSize: 13, lineHeight: 2 }}>
                  <dt style={{ fontWeight: 600 }}>Status</dt>
                  <dd>{selected.topicStatus}</dd>
                  <dt style={{ fontWeight: 600 }}>Type</dt>
                  <dd>{selected.topicType}</dd>
                  <dt style={{ fontWeight: 600 }}>Author</dt>
                  <dd>{selected.creationAuthor}</dd>
                  {selected.assignedTo && (
                    <>
                      <dt style={{ fontWeight: 600 }}>Assigned To</dt>
                      <dd>{selected.assignedTo}</dd>
                    </>
                  )}
                  {selected.comments.length > 0 && (
                    <>
                      <dt style={{ fontWeight: 600 }}>Comments ({selected.comments.length})</dt>
                      <dd>
                        {selected.comments.map((c) => (
                          <div key={c.guid} style={{ marginBottom: 8 }}>
                            <strong>{c.author}</strong>: {c.comment}
                          </div>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
