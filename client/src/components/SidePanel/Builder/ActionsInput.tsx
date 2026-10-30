import { useState, useEffect } from 'react';
import { dump, load } from 'js-yaml';
import debounce from 'lodash/debounce';
import { WandSparkles } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import {
  validateAndParseOpenAPISpec,
  openapiToFunction,
  AuthTypeEnum,
} from 'librechat-data-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  TooltipAnchor,
  useToastContext,
} from '@librechat/client';
import type {
  Action,
  FunctionTool,
  ActionMetadata,
  ValidationResult,
  AssistantsEndpoint,
} from 'librechat-data-provider';
import type { ActionAuthForm, ActionWithNullableMetadata } from '~/common';
import type { TranslationKeys } from '~/hooks';
import type { Spec } from './ActionsTable';
import ActionCallback from '~/components/SidePanel/Builder/ActionCallback';
import { ActionsTable, columns } from './ActionsTable';
import { useAssistantsMapContext } from '~/Providers';
import { useUpdateAction } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const debouncedValidation = debounce(
  (input: string, callback: (result: ValidationResult) => void) => {
    const result = validateAndParseOpenAPISpec(input);
    callback(result);
  },
  800,
);

/** A built-in schema template offered by the Examples picker. */
type ExampleSpec = {
  value: string;
  labelKey: TranslationKeys;
  spec: string;
};

/**
 * Client-local schema templates loaded into the editor on pick. They are plain
 * OpenAPI specs validated by the same `validateAndParseOpenAPISpec` path as
 * user input — the action contract itself (`ActionMetadata`) carries no
 * examples field, so nothing here is persisted on the action.
 */
const exampleSpecs: ExampleSpec[] = [
  {
    value: 'weather',
    labelKey: 'com_ui_example_weather_json',
    spec: `{
  "openapi": "3.0.0",
  "info": {
    "title": "Weather API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://api.example-weather-app.com"
    }
  ],
  "paths": {
    "/weather": {
      "get": {
        "operationId": "getCurrentWeather",
        "summary": "Get the current weather for a city",
        "parameters": [
          {
            "name": "city",
            "in": "query",
            "required": true,
            "description": "The city name",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Current weather data",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "temperature": {
                      "type": "number"
                    },
                    "conditions": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
  },
  {
    value: 'petstore',
    labelKey: 'com_ui_example_pet_store_yaml',
    spec: `openapi: 3.0.0
info:
  title: Pet Store API
  version: 1.0.0
servers:
  - url: https://api.example-petstore-app.com
paths:
  /pets:
    get:
      operationId: listPets
      summary: List all pets
      parameters:
        - name: limit
          in: query
          required: false
          description: How many pets to return
          schema:
            type: integer
      responses:
        '200':
          description: A list of pets
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        tag:
          type: string
`,
  },
  {
    value: 'blank',
    labelKey: 'com_ui_example_blank_template',
    spec: `openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
servers:
  - url: https://api.example.com
paths:
  /example:
    get:
      operationId: getExample
      summary: Describe what this operation does
      responses:
        '200':
          description: Success
`,
  },
];

/** Stable key comparison (code-unit order) so identical specs format identically. */
function compareKeys(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Stable deep key order (code-unit comparison) so identical specs format identically. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

export default function ActionsInput({
  action,
  assistant_id,
  endpoint,
  version,
  setAction,
}: {
  action?: ActionWithNullableMetadata;
  assistant_id?: string;
  endpoint: AssistantsEndpoint;
  version: number | string;
  setAction: React.Dispatch<React.SetStateAction<Action | undefined>>;
}) {
  const handleResult = (result: ValidationResult) => {
    if (!result.status) {
      setData(null);
      setFunctions(null);
    }
    setValidationResult(result);
  };

  const localize = useLocalize();
  const { showToast } = useToastContext();
  const assistantMap = useAssistantsMapContext();
  const { handleSubmit, reset } = useFormContext<ActionAuthForm>();
  const [validationResult, setValidationResult] = useState<null | ValidationResult>(null);
  const [inputValue, setInputValue] = useState('');
  const [formatError, setFormatError] = useState(false);

  const [data, setData] = useState<Spec[] | null>(null);
  const [functions, setFunctions] = useState<FunctionTool[] | null>(null);

  useEffect(() => {
    const rawSpec = action?.metadata?.raw_spec ?? '';
    if (!rawSpec) {
      return;
    }
    setInputValue(rawSpec);
    debouncedValidation(rawSpec, handleResult);
  }, [action?.metadata?.raw_spec]);

  useEffect(() => {
    if (!validationResult || !validationResult.status || !validationResult.spec) {
      return;
    }

    const { functionSignatures, requestBuilders } = openapiToFunction(validationResult.spec);
    const specs = Object.entries(requestBuilders).map(([name, props]) => {
      return {
        name,
        method: props.method,
        path: props.path,
        domain: props.domain,
      };
    });

    setData(specs);
    setValidationResult(null);
    setFunctions(functionSignatures.map((f) => f.toObjectTool()));
  }, [validationResult]);

  const updateAction = useUpdateAction({
    onSuccess(data) {
      showToast({
        message: localize('com_assistants_update_actions_success'),
        status: 'success',
      });
      reset();
      setAction(data[2]);
    },
    onError(error) {
      showToast({
        message:
          (error as Error | undefined)?.message ?? localize('com_assistants_update_actions_error'),
        status: 'error',
      });
    },
  });

  const saveAction = handleSubmit((authFormData) => {
    const currentAssistantId = assistant_id ?? '';
    if (!currentAssistantId) {
      // alert user?
      return;
    }

    if (!functions) {
      return;
    }

    if (!data) {
      return;
    }

    let { metadata } = action ?? {};
    if (!metadata) {
      metadata = {};
    }
    const action_id = action?.action_id;
    metadata.raw_spec = inputValue;
    const parsedUrl = new URL(data[0].domain);
    if (!parsedUrl.hostname) {
      // alert user?
      return;
    }
    // Send protocol + hostname for proper SSRF validation (e.g., "http://192.168.1.1")
    metadata.domain = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

    const { type, saved_auth_fields } = authFormData;

    const removeSensitiveFields = (obj: ActionMetadata) => {
      delete obj.auth;
      delete obj.api_key;
      delete obj.oauth_client_id;
      delete obj.oauth_client_secret;
    };

    if (saved_auth_fields && type === AuthTypeEnum.ServiceHttp) {
      metadata = {
        ...metadata,
        api_key: authFormData.api_key,
        auth: {
          type,
          authorization_type: authFormData.authorization_type,
          custom_auth_header: authFormData.custom_auth_header,
        },
      };
    } else if (saved_auth_fields && type === AuthTypeEnum.OAuth) {
      metadata = {
        ...metadata,
        auth: {
          type,
          authorization_url: authFormData.authorization_url,
          client_url: authFormData.client_url,
          scope: authFormData.scope,
          token_exchange_method: authFormData.token_exchange_method,
        },
        oauth_client_id: authFormData.oauth_client_id,
        oauth_client_secret: authFormData.oauth_client_secret,
      };
    } else if (saved_auth_fields) {
      removeSensitiveFields(metadata);
      metadata.auth = {
        type,
      };
    } else {
      removeSensitiveFields(metadata);
    }

    updateAction.mutate({
      action_id,
      metadata,
      functions,
      assistant_id: currentAssistantId,
      endpoint,
      version,
      model: assistantMap?.[endpoint][currentAssistantId].model ?? '',
    });
  });

  /** Single write path for the schema editor: every source (typing, example
   *  pick, format) flows through here so validation and the error border stay
   *  in sync. */
  const updateSpecValue = (newValue: string) => {
    setInputValue(newValue);
    setFormatError(false);
    if (!newValue) {
      setData(null);
      setFunctions(null);
      return setValidationResult(null);
    }
    debouncedValidation(newValue, handleResult);
  };

  const handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement> = (event) =>
    updateSpecValue(event.target.value);

  const handleExampleSelect = (value: string) => {
    const example = exampleSpecs.find((spec) => spec.value === value);
    if (example) {
      updateSpecValue(example.spec);
    }
  };

  const handleFormatSpec = () => {
    if (!inputValue.trim()) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(inputValue);
      updateSpecValue(JSON.stringify(sortKeysDeep(parsed), null, 2));
      return;
    } catch {
      // Not JSON — the editor also accepts YAML, so fall through to a YAML round-trip.
    }
    try {
      const parsed: unknown = load(inputValue);
      updateSpecValue(dump(parsed, { indent: 2, sortKeys: true, lineWidth: -1 }));
    } catch {
      setFormatError(true);
      showToast({ message: localize('com_ui_format_spec_error'), status: 'error' });
    }
  };

  const submitContext = () => {
    if (updateAction.isLoading) {
      return <Spinner className="icon-md" />;
    } else if (action?.action_id.length ?? 0) {
      return localize('com_ui_update');
    } else {
      return localize('com_ui_create');
    }
  };

  return (
    <>
      <div className="">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-4">
          <label
            htmlFor="schemaInput"
            className="text-token-text-primary whitespace-nowrap font-medium"
          >
            {localize('com_ui_schema')}
          </label>
          <Select value="" onValueChange={handleExampleSelect}>
            <SelectTrigger
              aria-label={localize('com_ui_examples')}
              className="h-8 w-[140px] rounded-lg"
            >
              <SelectValue placeholder={localize('com_ui_examples')} />
            </SelectTrigger>
            <SelectContent>
              {exampleSpecs.map((example) => (
                <SelectItem key={example.value} value={example.value}>
                  {localize(example.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className={cn(
            'mb-4 w-full overflow-hidden rounded-lg border bg-surface-primary ring-0',
            formatError
              ? 'border-border-destructive'
              : 'border-token-border-medium hover:border-border-heavy',
          )}
        >
          <div className="relative">
            <textarea
              id="schemaInput"
              value={inputValue}
              onChange={handleInputChange}
              spellCheck="false"
              placeholder={localize('com_ui_enter_openapi_schema')}
              className="text-token-text-primary block h-96 w-full bg-transparent p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-border-light"
            />
            <TooltipAnchor
              side="top"
              description={localize('com_ui_format_spec')}
              render={
                <button
                  type="button"
                  onClick={handleFormatSpec}
                  aria-label={localize('com_ui_format_spec')}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                >
                  <WandSparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden={true} />
                </button>
              }
            />
          </div>
          {validationResult && validationResult.message !== 'OpenAPI spec is valid.' && (
            <div className="border-token-border-light border-t p-2 text-text-destructive">
              {validationResult.message.split('\n').map((line: string, i: number) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      {!!data && (
        <div className="my-2">
          <div className="flex items-center">
            <label className="text-token-text-primary block font-medium">
              {localize('com_assistants_available_actions')}
            </label>
          </div>
          <ActionsTable columns={columns} data={data} />
        </div>
      )}
      <div className="relative my-1">
        <ActionCallback action_id={action?.action_id} />
        <div className="mb-1.5 flex items-center">
          <label className="text-token-text-primary block font-medium">
            {localize('com_ui_privacy_policy_url')}
          </label>
        </div>
        <div className="border-token-border-medium flex h-9 w-full rounded-lg border bg-surface-primary hover:border-border-heavy">
          <input
            type="text"
            placeholder="https://api.example-weather-app.com/privacy"
            className="flex-1 rounded-lg bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-text-secondary-alt focus:ring-1 focus:ring-border-light"
          />
        </div>
      </div>
      <div className="flex items-center justify-end">
        <button
          disabled={!functions || !functions.length}
          onClick={saveAction}
          className="mt-1 flex min-w-[100px] items-center justify-center rounded bg-surface-submit px-4 py-2 font-semibold text-text-on-status hover:bg-surface-submit-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:opacity-50"
          type="button"
        >
          {submitContext()}
        </button>
      </div>
    </>
  );
}
