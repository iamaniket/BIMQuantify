'use client';

import {
  Camera,
  Check,
  Mail,
  Pencil,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';

import { Button, Card, CardBody, CardHeader, PageHeader } from '@bimstitch/ui';

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

export default function AccountPage(): JSX.Element {
  const t = useTranslations('account');
  const { tokens, me, activeMembership, refreshMe } = useAuth();
  const accessToken = tokens?.access_token ?? null;

  const user = me?.user;
  const userName = user?.full_name?.trim() || user?.email || 'User';
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
    } catch (err) {
      setInvError(err instanceof ApiError ? err.detail : t('errors.declineFailed'));
    } finally {
      setPendingOrgId(null);
    }
  };

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={undefined}
        className="mb-6"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        {/* Profile card */}
        <Card className="border-border/80">
          <CardHeader className="gap-2 border-b border-border/80 pb-4">
            <div className="flex items-center gap-2 text-foreground">
              <UserRound className="h-5 w-5 text-primary" />
              <h2 className="text-body1 font-semibold">{t('profileTitle')}</h2>
            </div>
          </CardHeader>
          <CardBody className="gap-5 py-5">
            {/* Avatar + name row */}
            <div className="flex items-start gap-5">
              {/* Avatar */}
              <div className="relative shrink-0">
                {avatarPresignedUrl ? (
                  <img
                    src={avatarPresignedUrl}
                    alt={userName}
                    className="h-[72px] w-[72px] rounded-full object-cover"
                  />
                ) : (
                  <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-primary-light text-lg font-extrabold text-primary">
                    {initials}
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { void onAvatarPick(e); }}
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
                        onChange={(e) => { setNameValue(e.target.value); }}
                        placeholder={t('namePlaceholder')}
                        className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-body2 text-foreground outline-none focus:border-primary"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={nameBusy}
                        onClick={() => { void saveName(); }}
                        className="flex items-center gap-1"
                      >
                        <Check size={14} aria-hidden />
                        {t('saveName')}
                      </Button>
                      <Button
                        variant="border"
                        size="sm"
                        disabled={nameBusy}
                        onClick={() => { setEditingName(false); }}
                      >
                        {t('cancelEdit')}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-body1 font-semibold text-foreground">{userName}</span>
                      <button
                        type="button"
                        onClick={startEditName}
                        className="grid h-6 w-6 place-items-center rounded text-foreground-tertiary hover:bg-background-secondary hover:text-foreground"
                        title={t('editName')}
                      >
                        <Pencil size={13} />
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
                    <Mail size={13} className="text-foreground-tertiary" />
                    {user?.email ?? '—'}
                  </div>
                </div>

                {/* Role + Org */}
                <div className="flex gap-6">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-foreground-tertiary">
                      {t('roleLabel')}
                    </div>
                    <div className="mt-0.5 text-body2 text-foreground">{roleLabel}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-foreground-tertiary">
                      {t('orgLabel')}
                    </div>
                    <div className="mt-0.5 text-body2 text-foreground">{orgName}</div>
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
                <Camera size={14} aria-hidden />
                {user?.avatar_url ? t('changePhoto') : t('uploadPhoto')}
              </Button>
              {user?.avatar_url ? (
                <Button
                  variant="border"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={() => { void onAvatarRemove(); }}
                  className="flex items-center gap-1.5 text-error"
                >
                  <Trash2 size={14} aria-hidden />
                  {t('removePhoto')}
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* Invitations card */}
        <Card className="border-border/80">
          <CardHeader className="gap-2 border-b border-border/80 pb-4">
            <h2 className="text-body1 font-semibold text-foreground">{t('invitationsTitle')}</h2>
          </CardHeader>
          <CardBody className="gap-3 py-5">
            {invitationsLoading ? (
              <div className="py-4 text-center text-body2 text-foreground-tertiary">Loading…</div>
            ) : invitations.length === 0 ? (
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
                        <div className="font-display text-[15px] font-medium text-foreground">
                          {inv.organization_name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] text-foreground-tertiary">
                          <Mail size={12} aria-hidden />
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
                          onClick={() => { void onAccept(inv.organization_id); }}
                          className="flex items-center gap-1.5"
                        >
                          <Check size={14} aria-hidden />
                          {isPending ? t('accepting') : t('accept')}
                        </Button>
                        <Button
                          variant="border"
                          size="sm"
                          disabled={isPending}
                          onClick={() => { void onDecline(inv.organization_id); }}
                          className="flex items-center gap-1.5"
                        >
                          <X size={14} aria-hidden />
                          {isPending ? t('declining') : t('decline')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {invError !== null && (
              <div
                role="alert"
                className="mt-2 rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
              >
                {invError}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
