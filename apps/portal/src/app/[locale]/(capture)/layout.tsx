import { setRequestLocale } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function CaptureLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
