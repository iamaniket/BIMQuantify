"use client";

import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useEffect } from "react";

export default function SelectTenantPage() {
  const { me, switchOrganization } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!me) return;
    if (me.memberships.length === 1) {
      // Only one tenant, auto-select and redirect
      if (me.active_organization_id !== me.memberships[0].organization_id) {
        switchOrganization(me.memberships[0].organization_id).then(() => {
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
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="mb-4 text-xl font-bold">Select your organization</h2>
      <ul className="w-80 space-y-2">
        {me.memberships.map((m) => (
          <li key={m.organization_id}>
            <button
              className={`w-full rounded border px-4 py-2 text-left hover:bg-gray-100 ${me.active_organization_id === m.organization_id ? "bg-gray-50 font-semibold" : ""}`}
              onClick={async () => {
                await switchOrganization(m.organization_id);
                router.replace("/projects");
              }}
            >
              {m.organization_name}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
