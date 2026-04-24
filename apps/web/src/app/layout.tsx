import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BIMQuantify — AI-based BIM Takeoff',
  description:
    'Upload IFC and BCF files to generate AI-powered quantity takeoffs instantly.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
