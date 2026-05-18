'use client';

import type { JSX } from 'react';

import { BorgingsplanSection } from './BorgingsplanSection';
import { RiskAssessmentSection } from './RiskAssessmentSection';

type Props = {
  projectId: string;
  country: string;
};

export function BorgingsplanTab({ projectId, country }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <RiskAssessmentSection projectId={projectId} country={country} />
      <BorgingsplanSection projectId={projectId} country={country} />
    </div>
  );
}
