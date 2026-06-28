"use client";

import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { Button, Card, CardBody, CardHeader } from "@bimdossier/ui";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function SelectTenantPage() {
  const { me, switchOrganization } = useAuth();
  const router = useRouter();
  const t = useTranslations("auth.login");

  useEffect(() => {
    if (!me) return;
    if (me.memberships.length === 1) {
      const membership = me.memberships[0];
      if (membership === undefined) return;
      // Only one tenant, auto-select and redirect
      if (me.active_organization_id !== membership.organization_id) {
        void switchOrganization(membership.organization_id).then(() => {
          router.replace("/projects");
        });
      } else {
        router.replace("/projects");
      }
    }
  }, [me, router, switchOrganization]);

  if (!me || me.memberships.length <= 1) {
    return null; // handled by effect
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md rounded-2xl">
        <CardHeader className="space-y-1">
          <h2 className="text-xl font-bold">{t("organizationStep.title")}</h2>
          <p className="text-sm text-foreground-secondary">{t("organizationStep.subtitle")}</p>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2">
            {me.memberships.map((membership) => (
              <li key={membership.organization_id}>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="w-full justify-between"
                  onClick={async () => {
                    await switchOrganization(membership.organization_id);
                    router.replace("/projects");
                  }}
                >
                  <span>{membership.organization_name}</span>
                  {me.active_organization_id === membership.organization_id ? (
                    <span className="text-xs text-foreground-secondary">{t("organizationStep.active")}</span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </main>
  );
}
