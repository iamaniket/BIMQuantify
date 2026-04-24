import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '48px 24px',
      }}
    >
      {/* Hero */}
      <section style={{ textAlign: 'center', marginBottom: 64 }}>
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 16 }}>
          BIMQuantify
        </h1>
        <p
          style={{
            fontSize: 20,
            color: '#4b5563',
            maxWidth: 600,
            margin: '0 auto 32px',
          }}
        >
          AI-powered quantity takeoff for BIM. Upload your{' '}
          <strong>IFC</strong> model or <strong>BCF</strong> issue file and get
          an instant, accurate material estimate.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/takeoff"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Start Takeoff
          </Link>
          <Link
            href="/bcf"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: '#fff',
              color: '#111827',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            View BCF Issues
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Features</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 20,
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
              <p style={{ color: '#6b7280', fontSize: 14 }}>{f.description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const FEATURES = [
  {
    icon: '📐',
    title: 'IFC Parsing',
    description:
      'Upload any IFC 2x3 / IFC4 file. We extract walls, slabs, beams, columns, doors, windows and more.',
  },
  {
    icon: '📋',
    title: 'BCF Issues',
    description:
      'Import BCF 2.1 zip archives to view collaboration topics, comments, and viewpoint snapshots.',
  },
  {
    icon: '🤖',
    title: 'AI Takeoff',
    description:
      'GPT-4o classifies every element, estimates quantities, and assigns unit costs automatically.',
  },
  {
    icon: '📊',
    title: 'Export',
    description:
      'Download your takeoff as CSV or Excel. Share with estimators and project managers instantly.',
  },
];
