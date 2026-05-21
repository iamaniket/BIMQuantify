'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Select } from '@bimstitch/ui';

import { Field } from '@/components/forms/Field';
import { useFormDialog } from '@/hooks/useFormDialog';
import { ApiError } from '@/lib/api/client';
import { ProjectRoleEnum, type ProjectMember, type ProjectRole } from '@/lib/api/schemas';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';

import { useAddProjectMember } from './useAddProjectMember';

const FormSchema = z.object({
  user_id: z.string().min(1),
  role: ProjectRoleEnum.default('viewer'),
});

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  user_id: '',
  role: 'viewer',
};

const ASSIGNABLE_ROLES: ProjectRole[] = [
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
];

type Props = {
  projectId: string;
  organizationId: string;
  existingMembers: ProjectMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddProjectMemberDialog({
  projectId,
  organizationId,
  existingMembers,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectAccess.addDialog');
  const tRoles = useTranslations('projectAccess.table.roles');
  const orgMembersQuery = useOrgMembers(organizationId, { status: 'active' });
  const mutation = useAddProjectMember();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  useFormDialog(open, form, mutation, EMPTY);

  const existingUserIds = useMemo(
    () => new Set(existingMembers.map((m) => m.user_id)),
    [existingMembers],
  );

  const candidates = useMemo(() => {
    const all = orgMembersQuery.data ?? [];
    return all.filter((m) => !existingUserIds.has(m.user_id));
  }, [orgMembersQuery.data, existingUserIds]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    mutation.mutate(
      { projectId, input: { user_id: values.user_id, role: values.role } },
      {
        onSuccess: () => { onOpenChange(false); },
        onError: (error) => {
          if (error instanceof ApiError) {
            if (error.detail === 'MEMBER_ALREADY_EXISTS') {
              form.setError('user_id', { message: t('errors.alreadyMember') });
              return;
            }
            if (error.detail === 'USER_NOT_IN_PROJECT_ORG') {
              form.setError('user_id', { message: t('errors.notInOrg') });
              return;
            }
          }
        },
      },
    );
  };

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending || candidates.length === 0}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="user_id" label={t('fields.user')}>
          {({ id }) => (
            <Select
              id={id}
              disabled={orgMembersQuery.isLoading || candidates.length === 0}
              {...form.register('user_id')}
            >
              <option value="">{t('placeholders.user')}</option>
              {candidates.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name === null ? m.email : `${m.full_name} (${m.email})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!orgMembersQuery.isLoading && candidates.length === 0 && (
          <p className="text-caption text-foreground-tertiary">{t('allAlreadyMembers')}</p>
        )}
        <Field form={form} name="role" label={t('fields.role')}>
          {({ id }) => (
            <Select id={id} {...form.register('role')}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{tRoles(r)}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </AppDialog>
  );
}
