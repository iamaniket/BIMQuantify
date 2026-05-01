export type PortalMessages = {
  settings: {
    pageTitle: string;
    pageSubtitle: string;
    activeTheme: string;
    activeLanguage: string;
    loadingThemePreference: string;
    selected: string;
    appearanceTitle: string;
    appearanceDescription: string;
    plannedAppearanceTitle: string;
    plannedAppearanceDescription: string;
    accountTitle: string;
    accountDescription: string;
    accountButton: string;
    roadmapTitle: string;
    roadmapDescription: string;
    languageTitle: string;
    languageDescription: string;
    languageHelper: string;
    themeOptions: {
      lightLabel: string;
      lightDescription: string;
      darkLabel: string;
      darkDescription: string;
      systemLabel: string;
      systemDescription: string;
    };
    placeholders: {
      profileDetailsTitle: string;
      profileDetailsDescription: string;
      securityTitle: string;
      securityDescription: string;
      viewerDefaultsTitle: string;
      viewerDefaultsDescription: string;
      notificationsTitle: string;
      notificationsDescription: string;
      workspaceBehaviorTitle: string;
      workspaceBehaviorDescription: string;
    };
  };
  sidebar: {
    adminConsole: string;
    settings: string;
    helpAndDocs: string;
    userSummary: string;
    userRole: string;
    signOut: string;
  };
};