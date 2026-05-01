'use client';

import { Check, Monitor, Moon, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type JSX } from 'react';

import {
  formatMessage,
  getLocaleLabel,
  supportedLocales,
  type Locale,
} from '@bimstitch/i18n';

import { Button, Card, CardBody, CardHeader, PageHeader } from '@bimstitch/ui';

import { useLocale } from '@/providers/LocaleProvider';

type ThemeOption = {
  value: 'light' | 'dark' | 'system';
  label: string;
  description: string;
  icon: typeof Sun;
};

type PlaceholderSetting = {
  title: string;
  description: string;
};

export default function SettingsPage(): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { locale, setLocale, messages } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted ? (theme ?? 'system') : 'system';
  const selectedLanguage = getLocaleLabel(locale);
  const themeMessages = messages.settings.themeOptions;

  const themeOptions: ThemeOption[] = [
    {
      value: 'light',
      label: themeMessages.lightLabel,
      description: themeMessages.lightDescription,
      icon: Sun,
    },
    {
      value: 'dark',
      label: themeMessages.darkLabel,
      description: themeMessages.darkDescription,
      icon: Moon,
    },
    {
      value: 'system',
      label: themeMessages.systemLabel,
      description: themeMessages.systemDescription,
      icon: Monitor,
    },
  ];

  const accountSettings: PlaceholderSetting[] = [
    {
      title: messages.settings.placeholders.profileDetailsTitle,
      description: messages.settings.placeholders.profileDetailsDescription,
    },
    {
      title: messages.settings.placeholders.securityTitle,
      description: messages.settings.placeholders.securityDescription,
    },
  ];

  const userSettings: PlaceholderSetting[] = [
    {
      title: messages.settings.placeholders.viewerDefaultsTitle,
      description: messages.settings.placeholders.viewerDefaultsDescription,
    },
    {
      title: messages.settings.placeholders.notificationsTitle,
      description: messages.settings.placeholders.notificationsDescription,
    },
    {
      title: messages.settings.placeholders.workspaceBehaviorTitle,
      description: messages.settings.placeholders.workspaceBehaviorDescription,
    },
  ];

  const activeThemeLabel = mounted
    ? selectedTheme === 'system'
      ? `${themeMessages.systemLabel} (${resolvedTheme === 'dark' ? themeMessages.darkLabel.toLowerCase() : themeMessages.lightLabel.toLowerCase()} active)`
      : selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)
    : messages.settings.loadingThemePreference;

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={messages.settings.pageTitle}
        subtitle={messages.settings.pageSubtitle}
        actions={(
          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-border bg-background px-3 py-1 text-caption font-medium text-foreground-secondary">
              {formatMessage(messages.settings.activeTheme, { theme: activeThemeLabel })}
            </div>
            <div className="rounded-full border border-border bg-background px-3 py-1 text-caption font-medium text-foreground-secondary">
              {formatMessage(messages.settings.activeLanguage, { language: selectedLanguage })}
            </div>
          </div>
        )}
        className="mb-6"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-border/80">
          <CardHeader className="gap-2 border-b border-border/80 pb-4">
            <div className="flex items-center gap-2 text-foreground">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              <h2 className="text-body1 font-semibold">{messages.settings.appearanceTitle}</h2>
            </div>
            <p className="text-body2 text-foreground-secondary">
              {messages.settings.appearanceDescription}
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
                          {messages.settings.selected}
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
              <div className="text-body2 font-semibold text-foreground">{messages.settings.plannedAppearanceTitle}</div>
              <p className="mt-1 text-body2 text-foreground-secondary">
                {messages.settings.plannedAppearanceDescription}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background-secondary/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-body2 font-semibold text-foreground">{messages.settings.languageTitle}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{messages.settings.languageDescription}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {supportedLocales.map((option) => {
                  const isActive = locale === option;
                  const label = getLocaleLabel(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => { setLocale(option); }}
                      className={`flex min-h-28 flex-col rounded-xl border p-4 text-left transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border bg-background hover:border-border-hover hover:bg-background'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-body1 font-semibold text-foreground">{label}</div>
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                            <Check className="h-3.5 w-3.5" />
                            {messages.settings.selected}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-body2 text-foreground-secondary">{messages.settings.languageHelper}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-6">
          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <div className="flex items-center gap-2 text-foreground">
                <UserRound className="h-5 w-5 text-primary" />
                <h2 className="text-body1 font-semibold">{messages.settings.accountTitle}</h2>
              </div>
              <p className="text-body2 text-foreground-secondary">
                {messages.settings.accountDescription}
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
                {messages.settings.accountButton}
              </Button>
            </CardBody>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <h2 className="text-body1 font-semibold text-foreground">{messages.settings.roadmapTitle}</h2>
              <p className="text-body2 text-foreground-secondary">
                {messages.settings.roadmapDescription}
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