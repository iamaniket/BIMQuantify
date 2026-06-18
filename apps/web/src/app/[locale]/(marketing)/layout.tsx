import type { JSX, ReactNode } from 'react';

import { Footer } from '@/components/Footer';
import { MarketingHeader } from '@/components/MarketingHeader';

type Props = {
  children: ReactNode;
};

export default function MarketingLayout({ children }: Props): JSX.Element {
  return (
    <>
      <MarketingHeader />
      {children}
      <Footer />
    </>
  );
}
