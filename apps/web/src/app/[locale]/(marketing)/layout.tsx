import type { JSX, ReactNode } from 'react';

import { Footer } from '@/components/Footer';

type Props = {
  children: ReactNode;
};

export default function MarketingLayout({ children }: Props): JSX.Element {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
