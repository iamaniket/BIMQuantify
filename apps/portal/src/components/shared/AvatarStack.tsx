import type { JSX } from 'react';

import { toInitials } from './UserAvatar';

type Member = {
  id: string;
  name: string;
  isLead?: boolean;
};

type Props = {
  members: Member[];
  max?: number;
};

export function AvatarStack({ members, max = 4 }: Props): JSX.Element | null {
  if (members.length === 0) return null;

  const visible = members.slice(0, max);
  const remaining = Math.max(members.length - visible.length, 0);

  return (
    <div className="flex shrink-0 -space-x-2">
      {visible.map((member) => (
        <span
          key={member.id}
          title={member.name}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 text-[9px] font-semibold ${
            member.isLead
              ? 'border-amber-300 bg-amber-100 text-amber-900 shadow-sm shadow-amber-700/15'
              : 'border-white bg-primary-light text-primary'
          }`}
        >
          {toInitials(member.name)}
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary-light text-[9px] font-semibold text-primary">
          +{remaining}
        </span>
      )}
    </div>
  );
}
