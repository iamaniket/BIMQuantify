'use client';

import { Camera, Check, ChevronRight, Mail, Pencil, Shield, Trash2, UserRound, Users, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
import { PanelHeading } from '@/components/shared/PanelHeading';
import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ApiError } from '@/lib/api/client';
import {
  acceptInvitation,
  declineInvitation,
  listMyInvitations,
} from '@/lib/api/invitations';
import {
  deleteAvatar,
  getAvatarUrl,
  updateProfile,
  uploadAvatar,
} from '@/lib/api/profile';
import type { InvitationRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

function toInitials(nameOrEmail: string): string {
  const words = nameOrEmail.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}


// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function AccountHero({
  userName,
  email,
  avatarUrl,
  orgName,
  roleLabel,
  invitationCount,
}: {
  userName: string;
  email: string;
  avatarUrl: string | null;
  orgName: string;
  roleLabel: string;
  invitationCount: number;
}): JSX.Element {
  const t = useTranslations('account.hero');

  return (
    <HeroShell
      image={
        avatarUrl !== null ? (
          <img
            src={avatarUrl}
            alt={userName}
            className="h-[140px] w-[200px] rounded-[10px] object-cover shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]"
          />
        ) : (
          <HeroImage>
            <span className="text-[28px] font-extrabold text-primary-foreground">
              {toInitials(userName)}
            </span>
          </HeroImage>
        )
      }
      title={userName}
      badge={
        <Badge variant="info">
          <Shield className="mr-1 h-3 w-3" />
          {t('badge')}
        </Badge>
      }
      subtitle={
        <span className="flex items-center gap-1.5">
          <Mail className="h-3 w-3" />
          {email}
        </span>
      }
      kpis={[
        {
          label: t('org'),
          value: orgName,
          sub: t('activeOrg'),
        },
        {
          label: t('role'),
          value: roleLabel,
          sub: t('currentRole'),
        },
        {
          label: t('invitations'),
          value: String(invitationCount),
          sub: t('pending'),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Profile pane (overview tab)
// ---------------------------------------------------------------------------

function ProfilePane({
  userName,
  email,
  avatarPresignedUrl,
  avatarBusy,
  roleLabel,
  orgName,
  isActive,
  isVerified,
  memberStatus,
  seatLimit,
  seatCountUsed,
  editingName,
  nameValue,
  nameBusy,
  fileRef,
  onStartEditName,
  onNameChange,
  onSaveName,
  onCancelEditName,
  onAvatarPick,
  onAvatarRemove,
  hasAvatar,
  onSwitchTab,
}: {
  userName: string;
  email: string;
  avatarPresignedUrl: string | null;
  avatarBusy: boolean;
  roleLabel: string;
  orgName: string;
  isActive: boolean;
  isVerified: boolean;
  memberStatus: string | null;
  seatLimit: number | null;
  seatCountUsed: number;
  editingName: boolean;
  nameValue: string;
  nameBusy: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onStartEditName: () => void;
  onNameChange: (v: string) => void;
  onSaveName: () => void;
  onCancelEditName: () => void;
  onAvatarPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarRemove: () => void;
  hasAvatar: boolean;
  onSwitchTab: (tab: string) => void;
}): JSX.Element {
  const t = useTranslations('account');
  const tOverview = useTranslations('account.overview');

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Left column — personal info */}
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-primary" />
              <h3 className="text-body2 font-bold">{tOverview('personalInfo')}</h3>
            </div>
          </CardHeader>
          <CardBody className="gap-5 py-5">
            <div className="flex items-start gap-5">
              {/* Avatar */}
              <div className="relative shrink-0">
                {avatarPresignedUrl !== null ? (
                  <img
                    src={avatarPresignedUrl}
                    alt={userName}
                    className="h-[72px] w-[72px] rounded-full object-cover"
                  />
                ) : (
                  <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-primary-light text-lg font-extrabold text-primary">
                    {toInitials(userName)}
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={onAvatarPick}
                />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1 space-y-3">
                {/* Name */}
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-foreground-tertiary">
                    {t('nameLabel')}
                  </div>
                  {editingName ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={nameValue}
                        onChange={(e) => { onNameChange(e.target.value); }}
                        placeholder={t('namePlaceholder')}
                        className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-body2 text-foreground outline-none focus:border-primary"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={nameBusy}
                        onClick={onSaveName}
                        className="flex items-center gap-1"
                      >
                        <Check size={18} aria-hidden />
                        {t('saveName')}
                      </Button>
                      <Button
                        variant="border"
                        size="sm"
                        disabled={nameBusy}
                        onClick={onCancelEditName}
                      >
                        {t('cancelEdit')}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-body1 font-semibold text-foreground">{userName}</span>
                      <button
                        type="button"
                        onClick={onStartEditName}
                        className="grid h-6 w-6 place-items-center rounded text-foreground-tertiary hover:bg-background-secondary hover:text-foreground"
                        title={t('editName')}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Email */}
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-foreground-tertiary">
                    {t('emailLabel')}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-body2 text-foreground">
                    <Mail size={15} className="text-foreground-tertiary" />
                    {email}
                  </div>
                </div>
              </div>
            </div>

            {/* Avatar actions */}
            <div className="flex gap-2">
              <Button
                variant="border"
                size="sm"
                disabled={avatarBusy}
                onClick={() => { fileRef.current?.click(); }}
                className="flex items-center gap-1.5"
              >
                <Camera size={18} aria-hidden />
                {hasAvatar ? t('changePhoto') : t('uploadPhoto')}
              </Button>
              {hasAvatar && (
                <Button
                  variant="border"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={onAvatarRemove}
                  className="flex items-center gap-1.5 text-error"
                >
                  <Trash2 size={18} aria-hidden />
                  {t('removePhoto')}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Right column — account details + quick actions */}
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{tOverview('accountDetails')}</h3>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="text-body3 font-medium text-foreground-secondary">{t('roleLabel')}</div>
                <div className="text-body3 text-foreground">{roleLabel}</div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="text-body3 font-medium text-foreground-secondary">{t('orgLabel')}</div>
                <div className="text-body3 text-foreground">{orgName}</div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="text-body3 font-medium text-foreground-secondary">{tOverview('statusLabel')}</div>
                <Badge variant={isActive ? 'success' : 'warning'}>
                  {isActive ? tOverview('statusActive') : tOverview('statusInactive')}
                </Badge>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="text-body3 font-medium text-foreground-secondary">{tOverview('verificationLabel')}</div>
                <Badge variant={isVerified ? 'success' : 'warning'}>
                  {isVerified ? tOverview('verified') : tOverview('unverified')}
                </Badge>
              </div>
              {memberStatus !== null && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <div className="text-body3 font-medium text-foreground-secondary">{tOverview('memberStatusLabel')}</div>
                  <div className="text-body3 capitalize text-foreground">{memberStatus}</div>
                </div>
              )}
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="text-body3 font-medium text-foreground-secondary">{tOverview('seatsLabel')}</div>
                <div className="text-body3 text-foreground">
                  {seatLimit !== null
                    ? tOverview('seatsValue', { used: seatCountUsed, limit: seatLimit })
                    : tOverview('seatsUnlimited')}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{tOverview('quickActionsTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0.5 p-2">
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
              onClick={onStartEditName}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <Pencil className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{tOverview('editProfile')}</div>
                <div className="text-caption text-foreground-tertiary">{tOverview('editProfileSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
              onClick={() => { onSwitchTab('invitations'); }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{tOverview('viewInvitations')}</div>
                <div className="text-caption text-foreground-tertiary">{tOverview('viewInvitationsSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations pane
// ---------------------------------------------------------------------------

function InvitationsPane({
  invitations,
  invitationsLoading,
  pendingOrgId,
  invError,
  onAccept,
  onDecline,
}: {
  invitations: InvitationRead[];
  invitationsLoading: boolean;
  pendingOrgId: string | null;
  invError: string | null;
  onAccept: (orgId: string) => void;
  onDecline: (orgId: string) => void;
}): JSX.Element {
  const t = useTranslations('account');

  if (invitationsLoading) {
    return (
      <div className="py-4 text-center text-body2 text-foreground-tertiary">Loading…</div>
    );
  }

  return (
    <>
      {invitations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background-secondary/60 px-4 py-6 text-center text-body2 text-foreground-tertiary">
          {t('noInvitations')}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {invitations.map((inv) => {
            const isPending = pendingOrgId === inv.organization_id;
            const expiresAt = new Date(inv.expires_at);
            const formattedExpiry = Number.isNaN(expiresAt.getTime())
              ? inv.expires_at
              : expiresAt.toLocaleDateString();

            return (
              <li
                key={inv.organization_id}
                className="rounded-lg border border-border bg-background px-4 py-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="font-sans text-[15px] font-medium text-foreground">
                    {inv.organization_name}
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px] text-foreground-tertiary">
                    <Mail size={18} aria-hidden />
                    {inv.invited_by_email !== null
                      ? t('invitedBy', { email: inv.invited_by_email })
                      : t('invitedByUnknown')}
                  </div>
                  <div className="text-[11.5px] text-foreground-tertiary">
                    {inv.is_org_admin ? t('roleAdmin') : t('roleMember')}
                    {' · '}
                    {t('expiresOn', { date: formattedExpiry })}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => { onAccept(inv.organization_id); }}
                    className="flex items-center gap-1.5"
                  >
                    <Check size={18} aria-hidden />
                    {isPending ? t('accepting') : t('accept')}
                  </Button>
                  <Button
                    variant="border"
                    size="sm"
                    disabled={isPending}
                    onClick={() => { onDecline(inv.organization_id); }}
                    className="flex items-center gap-1.5"
                  >
                    <X size={18} aria-hidden />
                    {isPending ? t('declining') : t('decline')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorBanner message={invError} tone="soft" className="mt-2" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AccountPage(): JSX.Element {
  const t = useTranslations('account');
  const tPanel = useTranslations('account.panel');
  const { tokens, me, activeMembership, refreshMe } = useAuth();
  const accessToken = tokens?.access_token ?? null;

  const user = me?.user;
  const userName = user?.full_name?.trim() || user?.email || 'User';
  const email = user?.email ?? '—';
  const initials = toInitials(userName);
  const roleLabel = activeMembership?.is_org_admin ? t('roleAdmin') : t('roleMember');
  const orgName = activeMembership?.organization_name ?? '—';

  // --- Avatar ---
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarPresignedUrl, setAvatarPresignedUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (accessToken === null || !user?.avatar_url) return;
    void getAvatarUrl(accessToken).then(setAvatarPresignedUrl).catch(() => {});
  }, [accessToken, user?.avatar_url]);

  const onAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || accessToken === null) return;
    setAvatarBusy(true);
    try {
      await uploadAvatar(accessToken, file);
      await refreshMe();
      const url = await getAvatarUrl(accessToken);
      setAvatarPresignedUrl(url);
    } catch {
      // handled silently
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onAvatarRemove = async (): Promise<void> => {
    if (accessToken === null) return;
    setAvatarBusy(true);
    try {
      await deleteAvatar(accessToken);
      await refreshMe();
      setAvatarPresignedUrl(null);
    } catch {
      // handled silently
    } finally {
      setAvatarBusy(false);
    }
  };

  // --- Name edit ---
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameBusy, setNameBusy] = useState(false);

  const startEditName = (): void => {
    setNameValue(user?.full_name ?? '');
    setEditingName(true);
  };

  const saveName = async (): Promise<void> => {
    if (accessToken === null) return;
    setNameBusy(true);
    try {
      const trimmed = nameValue.trim();
      await updateProfile(accessToken, trimmed ? { full_name: trimmed } : {});
      await refreshMe();
      setEditingName(false);
    } catch {
      // handled silently
    } finally {
      setNameBusy(false);
    }
  };

  // --- Invitations ---
  const [invitations, setInvitations] = useState<InvitationRead[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const [invError, setInvError] = useState<string | null>(null);

  const loadInvitations = useCallback(async (): Promise<void> => {
    if (accessToken === null) return;
    setInvitationsLoading(true);
    try {
      const list = await listMyInvitations(accessToken);
      setInvitations(list);
    } catch (err) {
      setInvError(err instanceof ApiError ? err.detail : t('errors.loadFailed'));
    } finally {
      setInvitationsLoading(false);
    }
  }, [accessToken, t]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const onAccept = async (orgId: string): Promise<void> => {
    if (accessToken === null) return;
    setInvError(null);
    setPendingOrgId(orgId);
    try {
      await acceptInvitation(accessToken, orgId);
      await refreshMe();
      await loadInvitations();
      toast.success(t('acceptSuccess'));
    } catch (err) {
      setInvError(err instanceof ApiError ? err.detail : t('errors.acceptFailed'));
    } finally {
      setPendingOrgId(null);
    }
  };

  const onDecline = async (orgId: string): Promise<void> => {
    if (accessToken === null) return;
    setInvError(null);
    setPendingOrgId(orgId);
    try {
      await declineInvitation(accessToken, orgId);
      await loadInvitations();
      toast.success(t('declineSuccess'));
    } catch (err) {
      setInvError(err instanceof ApiError ? err.detail : t('errors.declineFailed'));
    } finally {
      setPendingOrgId(null);
    }
  };

  // --- Tabs ---
  const [tab, setTab] = useState('profile');

  if (me === null) {
    return (
      <PageShell
        hero={
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[140px] w-[200px] rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        }
      >
        <div className="p-5">
          <Skeleton className="h-64 w-full" />
        </div>
      </PageShell>
    );
  }

  const panelHeading = {
    profile: {
      eyebrow: tPanel('profileEyebrow'),
      title: tPanel('profileTitle'),
    },
    invitations: {
      eyebrow: tPanel('invitationsEyebrow'),
      title: tPanel('invitationsTitle', { count: invitations.length }),
    },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <PageShell
      hero={
        <AccountHero
          userName={userName}
          email={email}
          avatarUrl={avatarPresignedUrl}
          orgName={orgName}
          roleLabel={roleLabel}
          invitationCount={me.pending_invitations_count}
        />
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
          <TabsTrigger value="profile" className={TAB_TRIGGER_CLASS}>
            <UserRound className="h-4 w-4" />
            {t('tabs.profile')}
          </TabsTrigger>
          <TabsTrigger value="invitations" className={TAB_TRIGGER_CLASS}>
            <Mail className="h-4 w-4" />
            {t('tabs.invitations')}
            {invitations.length > 0 && (
              <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
                {invitations.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <PanelHeading eyebrow={panelHeading.eyebrow} title={panelHeading.title} />

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="profile" className="mt-0">
            <ProfilePane
              userName={userName}
              email={email}
              avatarPresignedUrl={avatarPresignedUrl}
              avatarBusy={avatarBusy}
              roleLabel={roleLabel}
              orgName={orgName}
              isActive={user?.is_active ?? true}
              isVerified={user?.is_verified ?? false}
              memberStatus={activeMembership?.member_status ?? null}
              seatLimit={activeMembership?.seat_limit ?? null}
              seatCountUsed={activeMembership?.seat_count_used ?? 0}
              editingName={editingName}
              nameValue={nameValue}
              nameBusy={nameBusy}
              fileRef={fileRef}
              onStartEditName={startEditName}
              onNameChange={setNameValue}
              onSaveName={() => { void saveName(); }}
              onCancelEditName={() => { setEditingName(false); }}
              onAvatarPick={(e) => { void onAvatarPick(e); }}
              onAvatarRemove={() => { void onAvatarRemove(); }}
              hasAvatar={Boolean(user?.avatar_url)}
              onSwitchTab={setTab}
            />
          </TabsContent>

          <TabsContent value="invitations" className="mt-0">
            <InvitationsPane
              invitations={invitations}
              invitationsLoading={invitationsLoading}
              pendingOrgId={pendingOrgId}
              invError={invError}
              onAccept={(orgId) => { void onAccept(orgId); }}
              onDecline={(orgId) => { void onDecline(orgId); }}
            />
          </TabsContent>
        </div>
      </Tabs>
    </PageShell>
  );
}
