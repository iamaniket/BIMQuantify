import Link from 'next/link';
import type { JSX } from 'react';

export default function WelcomePage(): JSX.Element {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
      <h1 className="text-4xl font-semibold">Welcome to BIMQuantify</h1>
      <p className="text-lg text-gray-600">
        AI-based BIM takeoff for IFC and BCF workflows.
      </p>
      <Link
        href="/login"
        className="rounded bg-black px-4 py-2 text-white"
      >
        Sign in
      </Link>
    </main>
  );
}
