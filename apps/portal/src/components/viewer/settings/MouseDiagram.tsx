'use client';

import { type JSX } from 'react';

type MouseZone = {
  label: string;
  sublabel: string | undefined;
};

type Props = {
  leftButton: MouseZone;
  middleButton: MouseZone;
  rightButton: MouseZone;
  scrollWheel: string;
};

export function MouseDiagram({
  leftButton,
  middleButton,
  rightButton,
  scrollWheel,
}: Props): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Scroll label above */}
      <span className="text-caption font-medium text-foreground-secondary">
        {scrollWheel}
      </span>

      {/* Mouse body */}
      <svg
        viewBox="0 0 200 280"
        className="h-[220px] w-auto"
        role="img"
        aria-label="Mouse button assignments"
      >
        {/* Mouse outline */}
        <path
          d="M40,100 L40,200 Q40,260 100,260 Q160,260 160,200 L160,100 Q160,40 100,40 Q40,40 40,100 Z"
          fill="none"
          className="stroke-border"
          strokeWidth="2"
        />

        {/* Dividing line at top (between buttons and body) */}
        <line x1="40" y1="140" x2="160" y2="140" className="stroke-border" strokeWidth="1.5" />

        {/* Left button area */}
        <path
          d="M42,100 L42,138 L98,138 L98,42 Q42,42 42,100 Z"
          className="fill-primary-lighter stroke-primary"
          strokeWidth="1.5"
          rx="4"
        />
        {/* Left button label */}
        <text
          x="70"
          y="82"
          textAnchor="middle"
          className="fill-primary text-caption font-bold"
          fontSize="13"
        >
          L
        </text>
        <text
          x="70"
          y="98"
          textAnchor="middle"
          className="fill-foreground-secondary"
          fontSize="9"
        >
          {leftButton.label}
        </text>

        {/* Middle button / scroll wheel */}
        <rect
          x="88"
          y="55"
          width="24"
          height="50"
          rx="12"
          className="fill-info-lighter stroke-info"
          strokeWidth="1.5"
        />
        <text
          x="100"
          y="76"
          textAnchor="middle"
          className="fill-info text-caption font-bold"
          fontSize="13"
        >
          M
        </text>
        <text
          x="100"
          y="98"
          textAnchor="middle"
          className="fill-foreground-secondary"
          fontSize="9"
        >
          {middleButton.label}
        </text>

        {/* Right button area */}
        <path
          d="M158,100 L158,138 L102,138 L102,42 Q158,42 158,100 Z"
          className="fill-success-lighter stroke-success"
          strokeWidth="1.5"
          rx="4"
        />
        <text
          x="130"
          y="82"
          textAnchor="middle"
          className="fill-success text-caption font-bold"
          fontSize="13"
        >
          R
        </text>
        <text
          x="130"
          y="98"
          textAnchor="middle"
          className="fill-foreground-secondary"
          fontSize="9"
        >
          {rightButton.label}
        </text>

        {/* Body area label lines */}
        {/* Left annotation */}
        <line x1="12" y1="90" x2="38" y2="90" className="stroke-foreground-tertiary" strokeWidth="0.75" strokeDasharray="3 2" />
        {/* Right annotation */}
        <line x1="162" y1="90" x2="188" y2="90" className="stroke-foreground-tertiary" strokeWidth="0.75" strokeDasharray="3 2" />
      </svg>

      {/* Button labels below */}
      <div className="flex w-full max-w-[320px] items-start justify-between">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-caption font-medium text-foreground">Left Button</span>
          <span className="text-caption text-foreground-secondary">
            {leftButton.sublabel ?? leftButton.label}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-caption font-medium text-foreground">Middle Button</span>
          <span className="text-caption text-foreground-secondary">
            {middleButton.sublabel ?? middleButton.label}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-caption font-medium text-foreground">Right Button</span>
          <span className="text-caption text-foreground-secondary">
            {rightButton.sublabel ?? rightButton.label}
          </span>
        </div>
      </div>

      <p className="text-caption text-foreground-tertiary">
        Scroll Wheel: {scrollWheel}
      </p>
    </div>
  );
}
