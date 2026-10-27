import { FormProvider, useForm } from 'react-hook-form';
import { EModelEndpoint } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Action, AssistantsEndpoint } from 'librechat-data-provider';
import type { ActionAuthForm } from '~/common';
import ActionsInput from '../ActionsInput';

/**
 * Radix opens its listbox in a portal from a pointer sequence jsdom does not
 * reproduce, so the Select family is swapped for a native `<select>` — the same
 * trade `Tenant/TenantSwitcher.spec.tsx` makes. The toast hook is stubbed so
 * failure paths are asserted on the call itself.
 */
const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  const { Children, isValidElement } = jest.requireActual('react');

  /** The trigger is the only child carrying the accessible name. */
  const isTrigger = (child) => isValidElement(child) && child.props?.['aria-label'] != null;

  return {
    ...actual,
    Select: ({ children, value, onValueChange }) => {
      const trigger = Children.toArray(children).find(isTrigger);
      const props = (isValidElement(trigger) ? trigger.props : {}) ?? {};
      return (
        <select
          aria-label={props['aria-label']}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {/** Mirrors the Radix "no selection" state — a controlled value of ''
           *  has no matching option without this slot, and the DOM would keep
           *  the last pick instead of returning to the placeholder. */}
          {value === '' ? <option value="" /> : null}
          {Children.map(children, (child) => (isTrigger(child) ? null : child))}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
    useToastContext: () => ({ showToast: mockShowToast }),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

/** The OAuth callback form needs clipboard/app-context wiring this unit spec
 *  does not exercise. */
jest.mock('~/components/SidePanel/Builder/ActionCallback', () => () => null);

jest.mock('~/data-provider', () => ({
  useUpdateAction: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/Providers', () => ({
  useAssistantsMapContext: () => ({}),
}));

function renderActionsInput(props: { action?: Action; setAction?: jest.Mock } = {}) {
  const setAction = props.setAction ?? jest.fn();

  function Harness() {
    const methods = useForm<ActionAuthForm>();
    return (
      <FormProvider {...methods}>
        <ActionsInput
          action={props.action}
          endpoint={EModelEndpoint.assistants as AssistantsEndpoint}
          version={1}
          setAction={setAction}
        />
      </FormProvider>
    );
  }

  render(<Harness />);
  const textarea = screen.getByRole('textbox', { name: 'com_ui_schema' });
  const examplesPicker = screen.getByRole('combobox', { name: 'com_ui_examples' });
  const formatButton = screen.getByRole('button', { name: 'com_ui_format_spec' });
  return { examplesPicker, formatButton, setAction, textarea };
}

describe('ActionsInput examples & format', () => {
  beforeEach(() => {
    /** The spec validation debounce (800ms) is inert here — these tests only
     *  assert synchronous editor behavior. */
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('offers the built-in examples and a format affordance', () => {
    const { examplesPicker, formatButton } = renderActionsInput();

    expect(examplesPicker).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'com_ui_example_weather_json' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'com_ui_example_pet_store_yaml' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'com_ui_example_blank_template' }),
    ).toBeInTheDocument();
    expect(formatButton).toBeInTheDocument();
  });

  it('loads a built-in example into the schema editor', () => {
    const { examplesPicker, textarea } = renderActionsInput();

    fireEvent.change(examplesPicker, { target: { value: 'weather' } });

    const spec = (textarea as HTMLTextAreaElement).value;
    expect(spec).toContain('"openapi"');
    expect(spec).toContain('api.example-weather-app.com');
    /** The picker resets so the same example can be re-applied after edits. */
    expect(examplesPicker).toHaveValue('');
  });

  it('formats JSON with a stable key order and 2-space indent', () => {
    const { formatButton, textarea } = renderActionsInput();

    fireEvent.change(textarea, { target: { value: '{"b":1,"a":{"d":2,"c":[3,1]}}' } });
    fireEvent.click(formatButton);

    expect(textarea).toHaveValue(
      '{\n  "a": {\n    "c": [\n      3,\n      1\n    ],\n    "d": 2\n  },\n  "b": 1\n}',
    );
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('formats YAML through a normalized round-trip', () => {
    const { formatButton, textarea } = renderActionsInput();

    fireEvent.change(textarea, { target: { value: 'b: 2\na: 1\n' } });
    fireEvent.click(formatButton);

    expect(textarea).toHaveValue('a: 1\nb: 2\n');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('flags invalid schema with an error toast and error border, leaving the input intact', () => {
    const { formatButton, textarea } = renderActionsInput();
    const invalid = 'key: [unclosed';

    fireEvent.change(textarea, { target: { value: invalid } });
    fireEvent.click(formatButton);

    expect(textarea).toHaveValue(invalid);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_format_spec_error',
      status: 'error',
    });
    const borderedContainer = textarea.closest('.overflow-hidden');
    expect(borderedContainer).toHaveClass('border-border-destructive');
    expect(borderedContainer).not.toHaveClass('hover:border-border-heavy');
    /** The error border clears as soon as the schema is edited again. */
    fireEvent.change(textarea, { target: { value: 'openapi: 3.0.0' } });
    expect(borderedContainer).not.toHaveClass('border-border-destructive');
  });
});
