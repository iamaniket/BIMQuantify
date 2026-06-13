'use client';

import { LayoutGrid, Plus, Table2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Skeleton, TabsContent } from '@bimstitch/ui';

import { PageTableContent, TableToolbar } from '@/components/shared/PageTable';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { Link } from '@/i18n/navigation';

import { FindingTemplatesHero } from '@/features/findingTemplates/FindingTemplatesHero';
import { FindingTemplatesOverview } from '@/features/findingTemplates/FindingTemplatesOverview';
import { FindingTemplatesTable } from '@/features/findingTemplates/FindingTemplatesTable';
import { TemplateBuilderDialog } from '@/features/findingTemplates/TemplateBuilderDialog';
import { useDeleteFindingTemplate } from '@/features/findingTemplates/useDeleteFindingTemplate';
import { useFindingTemplates } from '@/features/findingTemplates/useFindingTemplates';
import { useSetDefaultFindingTemplate } from '@/features/findingTemplates/useSetDefaultFindingTemplate';
import type { FindingTemplate } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

export default function TemplatesPage(): JSX.Element {
  const t = useTranslations('findingTemplates');
  const { activeMembership, me } = useAuth();
  const canManage =
    activeMembership?.is_org_admin === true || me?.user.is_superuser === true;

  const [tab, setTab] = useState('overview');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<FindingTemplate | null>(null);

  const templatesQuery = useFindingTemplates();
  const templates = templatesQuery.data ?? [];
  const deleteMutation = useDeleteFindingTemplate();
  const setDefaultMutation = useSetDefaultFindingTemplate();

  const openCreate = (): void => {
    setEditing(null);
    setBuilderOpen(true);
  };
  const openEdit = (tpl: FindingTemplate): void => {
    setEditing(tpl);
    setBuilderOpen(true);
  };
  const handleDelete = (tpl: FindingTemplate): void => {
    deleteMutation.mutate(tpl.id, {
      onSuccess: () => { toast.success(t('list.removeSuccess', { name: tpl.name })); },
    });
  };
  const handleSetDefault = (tpl: FindingTemplate): void => {
    setDefaultMutation.mutate(tpl.id, {
      onSuccess: () => { toast.success(t('list.setDefaultSuccess', { name: tpl.name })); },
    });
  };

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    templates: {
      eyebrow: t('panel.templatesEyebrow'),
      title: t('panel.templatesTitle', { count: templates.length }),
    },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<FindingTemplatesHero />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'templates',
          label: t('tabs.templates'),
          icon: <Table2 className="h-4 w-4" />,
          badge: (
            <Badge variant="primary" size="md" bordered={false}>
              {templates.length}
            </Badge>
          ),
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      toolbar={
        tab === 'templates' && canManage ? (
          <TableToolbar
            actions={
              <div className="flex items-center gap-2">
                <Link
                  href="/templates/reports"
                  className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 font-sans text-body3 text-foreground-secondary transition-colors hover:bg-background-hover"
                >
                  {t('reportTemplatesLink')}
                </Link>
                <Button size="md" className="whitespace-nowrap" onClick={openCreate}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('list.newButton')}
                </Button>
              </div>
            }
          >
            <></>
          </TableToolbar>
        ) : undefined
      }
      afterTabs={
        canManage ? (
          <TemplateBuilderDialog
            open={builderOpen}
            onOpenChange={setBuilderOpen}
            template={editing}
          />
        ) : undefined
      }
    >
      <TabsContent value="overview" className="mt-0">
        {templatesQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <FindingTemplatesOverview templates={templates} />
        )}
      </TabsContent>

      <TabsContent value="templates" className="mt-0">
        <PageTableContent
          isLoading={templatesQuery.isLoading}
          isError={false}
          errorMessage=""
          countLabel={t('panel.showing', { count: templates.length })}
        >
          <FindingTemplatesTable
            templates={templates}
            canManage={canManage}
            onEdit={openEdit}
            onSetDefault={handleSetDefault}
            onDelete={handleDelete}
          />
        </PageTableContent>
      </TabsContent>
    </TabbedPageShell>
  );
}
