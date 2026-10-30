import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TAdminProvider, TAdminProviderTestResponse } from 'librechat-data-provider';
import {
  useAdminProvidersQuery,
  useTestAdminProviderMutation,
} from '~/data-provider/Admin/Providers';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

/**
 * Admin view for custom providers — the `endpoints.custom` block in
 * `baanzon.yaml`. Lists the deployment's configured upstreams (source:
 * config), lets an admin draft new ones (Add/Edit/Delete on the draft
 * list), and probes `{baseURL}/models` live through the server so a wrong
 * key or URL shows inline without sending anything through the browser.
 * Draft edits are materialized as a YAML fragment to copy into
 * `baanzon.yaml` — the deploy file stays the single source of truth.
 */

interface DraftProvider {
  name: string;
  baseURL: string;
  /** Empty when users provide their own key (USER_PROVIDED). */
  apiKey: string;
  headerName: string;
  staticModels: string;
  modelsFetch: boolean;
  iconLabel: string;
}

const emptyDraft: DraftProvider = {
  name: '',
  baseURL: '',
  apiKey: '',
  headerName: '',
  staticModels: '',
  modelsFetch: false,
  iconLabel: '',
};

function draftToProvider(draft: DraftProvider, apiKeyPreview?: string): TAdminProvider {
  return {
    name: draft.name.trim(),
    baseURL: draft.baseURL.trim(),
    title: draft.name.trim(),
    apiKeyUserProvided: !draft.apiKey.trim(),
    apiKeyPreview: apiKeyPreview,
    provider: undefined,
    iconURL: draft.iconLabel.trim() || undefined,
    modelDisplayLabel: draft.iconLabel.trim() || undefined,
    headerName: draft.headerName.trim() || undefined,
    staticModels: draft.staticModels
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    modelsFetch: draft.modelsFetch,
  };
}

function providerToYAML(provider: TAdminProvider): string {
  const models = (provider.staticModels ?? []).map((name) => `        - name: ${name}`);
  const lines = [`    - name: ${provider.name}`, `      baseURL: ${provider.baseURL}`];
  if (provider.modelsFetch) {
    lines.push('      apiKey: ${CUSTOM_PROVIDER_API_KEY}');
    lines.push('      models:');
    if (models.length > 0) {
      lines.push('        default:');
      lines.push(...models);
    }
    lines.push('        fetch: true');
  } else {
    lines.push(`      apiKey: ${provider.apiKeyUserProvided ? 'USER_PROVIDED' : ''}`);
    lines.push('      models:');
    lines.push('        default:');
    lines.push(...models);
  }
  return lines.join('\n');
}

function TestResult({ result }: { result: TAdminProviderTestResponse | undefined }) {
  const localize = useLocalize();
  if (!result) {
    return null;
  }
  if (result.status === 'ok') {
    return (
      <p className="text-sm text-status-success" role="status">
        {`${localize('com_ui_providers_test_ok', { '0': String(result.count ?? 0) })}${result.models?.length ? `: ${result.models.join(', ')}` : ''}`}
      </p>
    );
  }
  if (result.status === 'unauthorized') {
    return (
      <p className="text-sm text-status-error" role="status">
        {result.error ?? localize('com_ui_providers_test_unauthorized')}
      </p>
    );
  }
  return (
    <p className="text-sm text-status-error" role="status">
      {result.error ?? localize('com_ui_providers_test_error')}
    </p>
  );
}

function ProviderRow({
  name,
  baseURL,
  badge,
  labels,
  onTest,
  onEdit,
  onDelete,
  children,
}: {
  name: string;
  baseURL?: string;
  badge?: string;
  labels?: { test?: string; edit?: string; delete?: string };
  onTest?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  const localize = useLocalize();
  return (
    <li className="rounded-lg border border-border-light bg-surface-secondary p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-text-primary">{name}</span>
            {badge && (
              <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
                {badge}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-text-secondary">{baseURL}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {labels?.test && <Button size="sm" variant="outline" onClick={onTest}>{labels.test}</Button>}
          {labels?.edit && <Button size="sm" variant="outline" onClick={onEdit}>{labels.edit}</Button>}
          {labels?.delete && <Button size="sm" variant="outline" onClick={onDelete}>{labels.delete}</Button>}
        </div>
      </div>
      {children}
    </li>
  );
}

export default function ProvidersManagement() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();
  const [isOpen, setIsOpen] = useState(false);

  const [drafts, setDrafts] = useState<TAdminProvider[]>([]);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftProvider>(emptyDraft);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [testPayload, setTestPayload] = useState<DraftProvider | null>(null);
  const [testKey, setTestKey] = useState('');

  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading } = useAdminProvidersQuery(isAdmin && isOpen);
  const testProvider = useTestAdminProviderMutation();

  const configuredProviders = useMemo(() => data?.providers ?? [], [data]);
  const generatedYAML = useMemo(() => {
    const blocks = drafts.map((provider) => providerToYAML(provider));
    if (blocks.length === 0) {
      return '';
    }
    return `endpoints:\n  custom:\n${blocks.join('\n')}`;
  }, [drafts]);

  const openAdd = () => {
    setEditingDraftIndex(null);
    setDraft(emptyDraft);
    setIsFormOpen(true);
  };

  const openEdit = (index: number) => {
    const provider = drafts[index];
    if (!provider) {
      return;
    }
    setEditingDraftIndex(index);
    setDraft({
      name: provider.name,
      baseURL: provider.baseURL ?? '',
      apiKey: '',
      headerName: provider.headerName ?? '',
      staticModels: (provider.staticModels ?? []).join(', '),
      modelsFetch: provider.modelsFetch,
      iconLabel: provider.modelDisplayLabel ?? '',
    });
    setIsFormOpen(true);
  };

  const saveDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.baseURL.trim()) {
      return;
    }
    const provider = draftToProvider(draft, drafts[editingDraftIndex ?? -1]?.apiKeyPreview);
    setDrafts((previous) => {
      if (editingDraftIndex != null) {
        const next = [...previous];
        next[editingDraftIndex] = provider;
        return next;
      }
      return [...previous, provider];
    });
    setIsFormOpen(false);
    setEditingDraftIndex(null);
  };

  const runTest = () => {
    if (!testPayload) {
      return;
    }
    if (!testKey.trim()) {
      showToast({ message: String(localize('com_ui_providers_test_key_required')), status: 'error' });
      return;
    }
    testProvider.mutate(
      {
        baseURL: testPayload.baseURL,
        apiKey: testKey,
        headerName: testPayload.headerName || undefined,
        skipCache: true,
      },
      {
        onSuccess: () => {
          showToast({ message: String(localize('com_ui_providers_test_complete')), status: 'success' });
        },
        onError: (error) => {
          showToast({
            message: error instanceof Error ? error.message : String(localize('com_ui_providers_test_error')),
            status: 'error',
          });
        },
      },
    );
  };

  /** Feature-local UI state only; the component renders for admins. */
  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="w-full"
      >
        {localize('com_ui_providers')}
      </Button>
      <OGDialog open={isOpen} onOpenChange={setIsOpen}>
        <OGDialogTemplate
          title={localize('com_ui_providers')}
          showCloseButton={true}
          className="w-11/12 max-w-2xl"
          main={
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-text-primary">
                  {localize('com_ui_providers_list_title')}
                </Label>
                <Button size="sm" variant="outline" onClick={openAdd}>
                  + {localize('com_ui_providers_add')}
                </Button>
              </div>
              {isLoading ? (
                <div className="flex grow items-center justify-center p-4">
                  <Spinner className="size-6" />
                </div>
              ) : configuredProviders.length === 0 && drafts.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_providers_empty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {configuredProviders.map((provider) => (
                    <ProviderRow
                      key={`configured-${provider.name}`}
                      name={provider.name}
                      baseURL={provider.baseURL}
                      badge={provider.apiKeyUserProvided
                        ? localize('com_ui_providers_byo_key')
                        : localize('com_ui_providers_deployed_key')}
                      labels={{
                        test: localize('com_ui_providers_test'),
                      }}
                      onTest={() => {
                        testProvider.reset();
                        setTestPayload({
                          name: provider.name,
                          baseURL: provider.baseURL ?? '',
                          apiKey: '',
                          headerName: provider.headerName ?? '',
                          staticModels: '',
                          modelsFetch: provider.modelsFetch,
                          iconLabel: '',
                        });
                        setTestKey('');
                      }}
                    />
                  ))}
                  {drafts.map((provider, index) => (
                    <ProviderRow
                      key={`draft-${index}-${provider.name}`}
                      name={provider.name}
                      baseURL={provider.baseURL}
                      badge={localize('com_ui_providers_draft_badge')}
                      labels={{
                        test: localize('com_ui_providers_test'),
                        edit: localize('com_ui_providers_edit'),
                        delete: localize('com_ui_providers_delete'),
                      }}
                      onTest={() => {
                        testProvider.reset();
                        setTestPayload({
                          name: provider.name,
                          baseURL: provider.baseURL ?? '',
                          apiKey: '',
                          headerName: provider.headerName ?? '',
                          staticModels: '',
                          modelsFetch: provider.modelsFetch,
                          iconLabel: '',
                        });
                        setTestKey('');
                      }}
                      onEdit={() => openEdit(index)}
                      onDelete={() => {
                        setDrafts((previous) => previous.filter((_, i) => i !== index));
                      }}
                    />
                  ))}
                </ul>
              )}
              {generatedYAML && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-text-primary">
                    {localize('com_ui_providers_yaml_title')}
                  </Label>
                  <pre className="max-h-48 overflow-auto rounded-lg border border-border-light bg-surface-secondary p-3 text-xs text-text-primary">
                    {generatedYAML}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(generatedYAML);
                      showToast({
                        message: localize('com_ui_providers_copied'),
                        status: 'success',
                      });
                    }}
                  >
                    {localize('com_ui_providers_copy')}
                  </Button>
                </div>
              )}
            </div>
          }
          buttons={null}
        />
      </OGDialog>

      {/* Add/Edit draft form */}
      <OGDialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <OGDialogTemplate
          title={
            editingDraftIndex != null
              ? localize('com_ui_providers_edit')
              : localize('com_ui_providers_add')
          }
          showCloseButton={true}
          className="w-11/12 max-w-lg"
          main={
            <form
              id="provider-draft-form"
              onSubmit={saveDraft}
              className="flex flex-col gap-4"
            >
              <div className="space-y-2">
                <Label htmlFor="provider-name">{localize('com_ui_providers_name')}</Label>
                <Input
                  id="provider-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-base-url">{localize('com_ui_providers_base_url')}</Label>
                <Input
                  id="provider-base-url"
                  type="url"
                  value={draft.baseURL}
                  onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
                  placeholder="https://api.example.com/v1"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-api-key">{localize('com_ui_providers_api_key')}</Label>
                <Input
                  id="provider-api-key"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                />
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_providers_key_byo')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-header-name">
                  {localize('com_ui_providers_header_name')}{' '}
                  <span className="font-normal text-text-secondary">
                    {localize('com_ui_optional')}
                  </span>
                </Label>
                <Input
                  id="provider-header-name"
                  value={draft.headerName}
                  onChange={(event) => setDraft({ ...draft, headerName: event.target.value })}
                  placeholder="Authorization"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-models">
                  {localize('com_ui_providers_models')}{' '}
                  <span className="font-normal text-text-secondary">
                    {localize('com_ui_providers_models_hint')}
                  </span>
                </Label>
                <Input
                  id="provider-models"
                  value={draft.staticModels}
                  onChange={(event) => setDraft({ ...draft, staticModels: event.target.value })}
                  placeholder="gpt-4o-mini, llama-3.1-70b"
                />
              </div>
              <div className="space-y-2">
                <Label>{localize('com_ui_providers_model_discovery')}</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={draft.modelsFetch ? 'outline' : 'submit'}
                    type="button"
                    aria-pressed={!draft.modelsFetch}
                    onClick={() => setDraft({ ...draft, modelsFetch: false })}
                  >
                    {localize('com_ui_providers_models_static')}
                  </Button>
                  <Button
                    size="sm"
                    variant={draft.modelsFetch ? 'submit' : 'outline'}
                    type="button"
                    aria-pressed={draft.modelsFetch}
                    onClick={() => setDraft({ ...draft, modelsFetch: true })}
                  >
                    {localize('com_ui_providers_models_fetch_alt')}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-icon-label">
                  {localize('com_ui_providers_icon_label')}{' '}
                  <span className="font-normal text-text-secondary">
                    {localize('com_ui_optional')}
                  </span>
                </Label>
                <Input
                  id="provider-icon-label"
                  value={draft.iconLabel}
                  onChange={(event) => setDraft({ ...draft, iconLabel: event.target.value })}
                />
              </div>
            </form>
          }
          buttons={
            <Button
              type="submit"
              form="provider-draft-form"
              variant="submit"
              disabled={!draft.name.trim() || !draft.baseURL.trim()}
            >
              {editingDraftIndex != null
                ? localize('com_ui_providers_edit')
                : localize('com_ui_providers_add')}
            </Button>
          }
        />
      </OGDialog>

      {/* Live probe dialog */}
      <OGDialog open={testPayload != null} onOpenChange={(open) => !open && setTestPayload(null)}>
        <OGDialogTemplate
          title={localize('com_ui_providers_test')}
          showCloseButton={true}
          className="w-11/12 max-w-md"
          main={
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">{testPayload?.baseURL}</p>
              <div className="space-y-2">
                <Label htmlFor="provider-test-key">{localize('com_ui_providers_api_key')}</Label>
                <Input
                  id="provider-test-key"
                  type="password"
                  value={testKey}
                  onChange={(event) => setTestKey(event.target.value)}
                  autoFocus
                />
              </div>
              <TestResult result={testProvider.data} />
            </div>
          }
          buttons={
            <Button
              variant="outline"
              onClick={runTest}
              disabled={testProvider.isLoading || !testKey.trim()}
            >
              {testProvider.isLoading ? <Spinner className="size-4" /> : localize('com_ui_providers_test')}
            </Button>
          }
        />
      </OGDialog>
    </>
  );
}




