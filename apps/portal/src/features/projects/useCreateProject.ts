'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { ApiError } from '@/lib/api/client';
import { invitePooledProjectMember } from '@/lib/api/pooledProjects';
import { addProjectMember, inviteToProject } from '@/lib/api/projectMembers';
import { createProject, uploadProjectThumbnail } from '@/lib/api/projects';
import type {
  Project, ProjectCreateInput, ProjectRole,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

/** An existing org user to add as a member once the project exists. `label`
 * is for failure messaging only — it's stripped before the API call. */
export type PendingProjectMember = { user_id: string; role: ProjectRole; label: string };

/** A not-yet-registered person to invite by email once the project exists. */
export type PendingProjectInvite = {
  email: string;
  full_name: string | null;
  role: ProjectRole;
};

type ProjectCreatePayload = ProjectCreateInput & {
  thumbnailFile: File | undefined;
  members?: PendingProjectMember[];
  invites?: PendingProjectInvite[];
};

/** A team add/invite that failed after the project was already created. The
 * project still exists, so we surface these rather than rolling back. */
type ProjectTeamFailure = { label: string; reason: string };

type ProjectCreateResult = {
  project: Project;
  failures: ProjectTeamFailure[];
};

function reasonOf(error: unknown): string {
  // Prefer the server-localized message (already in the request's language);
  // fall back to the bare detail code, then to the raw error string.
  if (error instanceof ApiError) return error.localizedMessage ?? error.detail;
  return String(error);
}

export function useCreateProject(): UseMutationResult<
  ProjectCreateResult,
  Error,
  ProjectCreatePayload
> {
  // Free-aware: a free (org-less) user creates a pooled `free_project`. Free
  // projects support up to 3 invited members (by email) + a cover image, but no
  // existing-org-member adds, so `members` is ignored; `invites` + `thumbnailFile`
  // are applied best-effort after creation.
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: async (accessToken, {
      thumbnailFile, members = [], invites = [], ...input
    }) => {
      if (isPooled) {
        let created = await createProject(accessToken, input, true);
        const failures: ProjectTeamFailure[] = [];
        const inviteResults = await Promise.allSettled(
          invites.map((inv) =>
            invitePooledProjectMember(accessToken, created.id, {
              email: inv.email,
              role: inv.role,
            }),
          ),
        );
        inviteResults.forEach((r, i) => {
          if (r.status === 'rejected') {
            failures.push({ label: invites[i]?.email ?? '', reason: reasonOf(r.reason) });
          }
        });
        if (thumbnailFile !== undefined) {
          created = await uploadProjectThumbnail(accessToken, created.id, thumbnailFile, true);
        }
        return { project: created, failures };
      }
      const created = await createProject(accessToken, input);
      const failures: ProjectTeamFailure[] = [];

      // Add org members + email invites after creation (invites create
      // accounts / send emails, so they can't be part of the atomic create).
      // The creator is seeded as owner, so they're authorized for both.
      // allSettled: one bad row (duplicate, etc.) must not abort the rest —
      // the project already exists and team is editable on the access page.
      const memberResults = await Promise.allSettled(
        members.map((m) => addProjectMember(accessToken, created.id, {
          user_id: m.user_id,
          role: m.role,
        })),
      );
      memberResults.forEach((r, i) => {
        if (r.status === 'rejected') {
          failures.push({ label: members[i]?.label ?? '', reason: reasonOf(r.reason) });
        }
      });

      const inviteResults = await Promise.allSettled(
        invites.map((inv) => inviteToProject(accessToken, created.id, {
          email: inv.email,
          role: inv.role,
          full_name: inv.full_name,
        })),
      );
      inviteResults.forEach((r, i) => {
        if (r.status === 'rejected') {
          failures.push({ label: invites[i]?.email ?? '', reason: reasonOf(r.reason) });
        }
      });

      let project = created;
      if (thumbnailFile !== undefined) {
        project = await uploadProjectThumbnail(accessToken, created.id, thumbnailFile);
      }

      return { project, failures };
    },
    invalidateKeys: [projectsKey],
    onSuccess: ({ project }) => {
      track(PORTAL_EVENTS.PROJECT_CREATED, {
        project_id: project.id,
        country: project.country,
      });
    },
  });
}
