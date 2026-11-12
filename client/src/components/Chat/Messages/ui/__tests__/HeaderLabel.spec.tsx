import { render, screen } from '@testing-library/react';
import HeaderLabel, { getHeaderModelName } from '../HeaderLabel';

const startupConfig = {
  modelSpecs: {
    list: [
      {
        name: 'baanzon-intelligence',
        label: 'Baanzon Intelligence',
        preset: { endpoint: 'Opraiz', model: '@cf/zai-org/glm-5.3' },
      },
    ],
  },
};

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: startupConfig }),
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, values?: Record<string, unknown>): string => {
      const template =
        (jest.requireActual('~/locales/en/translation.json') as Record<string, string>)[key] ?? key;
      if (!values) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
        values[name] != null ? String(values[name]) : match,
      );
    },
}));

describe('getHeaderModelName', () => {
  it('prefers a real model over an agent document id', () => {
    expect(getHeaderModelName('agent_abc', 'gemma4:12b-it-qat')).toBe('gemma4:12b-it-qat');
  });

  it('returns nothing when only an agent id is available', () => {
    expect(getHeaderModelName('agent_abc')).toBeUndefined();
  });

  /* An Assistants-endpoint message keys the assistant map by `assistant.id`, so
     its `model` field holds an `asst_` id rather than a model name. */
  it('prefers a real model over an assistant document id', () => {
    expect(getHeaderModelName(undefined, 'gpt-4o', 'asst_abc')).toBe('gpt-4o');
  });

  it('returns nothing when only an assistant id is available', () => {
    expect(getHeaderModelName(undefined, undefined, 'asst_abc')).toBeUndefined();
  });
});

describe('HeaderLabel', () => {
  it('renders only the provider when there is no model to show', () => {
    render(<HeaderLabel label="Ollama" />);

    expect(screen.getByText('Ollama')).toBeVisible();
    expect(screen.queryByText('gemma4:12b-it-qat')).not.toBeInTheDocument();
  });

  it('keeps the model in the slot for a hover swap', () => {
    render(<HeaderLabel label="Ollama" hoverLabel="gemma4:12b-it-qat" />);

    expect(screen.getByText('Ollama')).toBeVisible();
    expect(screen.getByText('gemma4:12b-it-qat')).toHaveAttribute('aria-hidden', 'true');
  });

  /* A pointer swap alone would strand a sighted keyboard user, who reaches the
     row by focus. `.message-render` carries the `group` this keys off. */
  it('also swaps the model in when the message row takes keyboard focus', () => {
    render(<HeaderLabel label="Ollama" hoverLabel="gemma4:12b-it-qat" />);

    const self = 'group-focus-visible';
    const descendant = 'group-has-[:focus-visible:not(:is(input,textarea,[contenteditable]))]';

    const provider = screen.getByText('Ollama').className;
    const model = screen.getByText('gemma4:12b-it-qat').className;

    expect(provider).toContain(`${self}:opacity-0`);
    expect(provider).toContain(`${descendant}:opacity-0`);
    expect(model).toContain(`${self}:opacity-100`);
    expect(model).toContain(`${descendant}:opacity-100`);
  });

  /* Clicking a tool card inside the row leaves focus on it. `:focus-within`
     would hold the model in place with the pointer nowhere near the row. */
  it('does not key the swap off plain focus-within', () => {
    render(<HeaderLabel label="Ollama" hoverLabel="gemma4:12b-it-qat" />);

    expect(screen.getByText('Ollama').className).not.toContain('group-focus-within:');
    expect(screen.getByText('gemma4:12b-it-qat').className).not.toContain('group-focus-within:');
  });

  /* Screen readers never move the visual focus, so the model also has to reach
     assistive tech through text that is never hidden. */
  it('names the model in text that does not depend on hover', () => {
    render(<HeaderLabel label="Ollama" hoverLabel="gemma4:12b-it-qat" />);

    const announced = screen.getByText('Model: gemma4:12b-it-qat');

    expect(announced).toHaveClass('sr-only');
    expect(announced).not.toHaveAttribute('aria-hidden');
  });

  /* Raw gateway ids (`@cf/...`) must never render. A spec match swaps in the
     branded label; an unmatched id is dropped so the provider label stays. */
  it('swaps a raw gateway id for the branded spec label', () => {
    render(<HeaderLabel label="Baanzon" hoverLabel="@cf/zai-org/glm-5.3" />);

    expect(screen.getByText('Baanzon Intelligence')).toBeVisible();
    expect(screen.getByText('Model: Baanzon Intelligence')).toHaveClass('sr-only');
    expect(screen.queryByText('@cf/zai-org/glm-5.3')).not.toBeInTheDocument();
  });

  it('drops an unmatched gateway id instead of revealing it', () => {
    render(<HeaderLabel label="Baanzon" hoverLabel="@cf/unlisted/model-xyz" />);

    expect(screen.getByText('Baanzon')).toBeVisible();
    expect(screen.queryByText('@cf/unlisted/model-xyz')).not.toBeInTheDocument();
    expect(screen.queryByText(/@cf\//)).not.toBeInTheDocument();
  });

  it('keeps a plain catalog model name untouched by the spec resolution', () => {
    render(<HeaderLabel label="Ollama" hoverLabel="gemma4:12b-it-qat" />);

    expect(screen.getByText('gemma4:12b-it-qat')).toHaveAttribute('aria-hidden', 'true');
  });
});
