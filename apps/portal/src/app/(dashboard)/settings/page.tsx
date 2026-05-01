'use client';

import { Check, Monitor, Moon, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type JSX } from 'react';

import { Button, Card, CardBody, CardHeader, PageHeader } from '@bimstitch/ui';

type ThemeOption = {
  value: 'light' | 'dark' | 'system';
  label: string;
  description: string;
  icon: typeof Sun;
};

const themeOptions: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright workspace with higher contrast for daytime use.',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Reduced glare for focused review sessions and low-light work.',
    icon: Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your operating system appearance automatically.',
    icon: Monitor,
  },
];

type PlaceholderSetting = {
  title: string;
  description: string;
};

const accountSettings: PlaceholderSetting[] = [
  {
    title: 'Profile details',
    description: 'Name, role, and contact preferences will be managed here.',
  },
  {
    title: 'Security',
    description: 'Password, sessions, and sign-in protections are planned for this area.',
  },
];

const userSettings: PlaceholderSetting[] = [
  {
    title: 'Viewer defaults',
    description: 'Default camera behavior, overlays, and inspection preferences will live here.',
  },
  {
    title: 'Notifications',
    description: 'Email and in-app alerts for project activity are reserved for a later milestone.',
  },
  {
    title: 'Workspace behavior',
    description: 'Search, dashboard density, and startup preferences will be grouped here.',
  },
];

export default function SettingsPage(): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted ? (theme ?? 'system') : 'system';
  const activeThemeLabel = mounted
    ? selectedTheme === 'system'
      ? `System (${resolvedTheme === 'dark' ? 'dark' : 'light'} active)`
      : selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)
    : 'Loading theme preference';

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Settings"
        subtitle="Manage appearance now and keep a dedicated place for personal preferences as the portal grows."
        actions={(
          <div className="rounded-full border border-border bg-background px-3 py-1 text-caption font-medium text-foreground-secondary">
            Active theme: {activeThemeLabel}
          </div>
        )}
        className="mb-6"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-border/80">
          <CardHeader className="gap-2 border-b border-border/80 pb-4">
            <div className="flex items-center gap-2 text-foreground">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              <h2 className="text-body1 font-semibold">Appearance</h2>
            </div>
            <p className="text-body2 text-foreground-secondary">
              The sidebar no longer owns theme switching. Appearance is managed here so more preferences can be added without crowding navigation.
            </p>
          </CardHeader>
          <CardBody className="gap-4 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              {themeOptions.map(({ value, label, description, icon: Icon }) => {
                const isActive = mounted && selectedTheme === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setTheme(value); }}
                    className={`flex min-h-36 flex-col rounded-xl border p-4 text-left transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-background hover:border-border-hover hover:bg-background-secondary'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-background-secondary text-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                          <Check className="h-3.5 w-3.5" />
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="mt-5 space-y-2">
                      <div className="text-body1 font-semibold text-foreground">{label}</div>
                      <p className="text-body2 text-foreground-secondary">{description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-dashed border-border bg-background-secondary/60 p-4">
              <div className="text-body2 font-semibold text-foreground">Planned appearance settings</div>
              <p className="mt-1 text-body2 text-foreground-secondary">
                Accent choices, compact density, motion preferences, and viewer-specific display defaults can be added here without changing the sidebar again.
              </p>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-6">
          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <div className="flex items-center gap-2 text-foreground">
                <UserRound className="h-5 w-5 text-primary" />
                <h2 className="text-body1 font-semibold">Account</h2>
              </div>
              <p className="text-body2 text-foreground-secondary">
                Personal account controls will be grouped here instead of spreading them across the sidebar and modal flows.
              </p>
            </CardHeader>
            <CardBody className="gap-3 py-5">
              {accountSettings.map(({ title, description }) => (
                <div key={title} className="rounded-xl border border-border bg-background-secondary/60 p-4">
                  <div className="text-body2 font-semibold text-foreground">{title}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{description}</p>
                </div>
              ))}
              <Button type="button" variant="border" className="self-start" disabled>
                User profile editing planned
              </Button>
            </CardBody>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <h2 className="text-body1 font-semibold text-foreground">User Settings Roadmap</h2>
              <p className="text-body2 text-foreground-secondary">
                This section reserves a stable place for the settings users will expect next.
              </p>
            </CardHeader>
            <CardBody className="gap-3 py-5">
              {userSettings.map(({ title, description }) => (
                <div key={title} className="rounded-xl border border-border bg-background p-4">
                  <div className="text-body2 font-semibold text-foreground">{title}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{description}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </main>
  );
}