import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Folder, MessageSquare, Search } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogTitle,
  Spinner,
} from '@librechat/client';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { TSearchAllRecord } from 'librechat-data-provider';
import type { CommandPaletteGroupId, CommandPaletteItem } from './types';
import type { TranslationKeys } from '~/hooks';
import {
  CROSS_SEARCH_MIN_QUERY_LENGTH,
  useCrossEntitySearch,
} from '~/data-provider/CrossSearch/queries';
import { COMMAND_PALETTE_GROUPS, matchesCommandQuery } from './types';
import { commandPaletteOpenAtom } from './state';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const GROUP_LABEL_KEYS: Record<CommandPaletteGroupId, TranslationKeys> = {
  actions: 'com_ui_command_palette_group_actions',
  navigation: 'com_ui_command_palette_group_navigation',
  results: 'com_ui_command_palette_group_results',
};

type CommandPaletteProps = {
  items: CommandPaletteItem[];
  isLoading?: boolean;
  /** Client navigation for cross-entity search rows; the host supplies `useNavigate`. */
  onNavigate?: (href: string) => void;
};

/** One selectable row in the listbox: a host action or a cross-entity hit. */
type PaletteRow =
  | { kind: 'command'; id: string; item: CommandPaletteItem }
  | { kind: 'result'; id: string; record: TSearchAllRecord };

/**
 * Presentational command palette. The host owns the action list, so this
 * component keeps the dialog/listbox behavior and its open state only — no
 * routing, theme or chat wiring leaks in.
 */
export default function CommandPalette({
  items,
  isLoading = false,
  onNavigate,
}: CommandPaletteProps) {
  const localize = useLocalize();
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  /** Component-local react-query over the shipped hook; the hook gates the
   *  request at two characters, and the gate below keeps a stale cached
   *  response from rendering for a shorter query. */
  const crossSearch = useCrossEntitySearch(query);
  const searchActive = query.trim().length >= CROSS_SEARCH_MIN_QUERY_LENGTH;
  const resultRecords = useMemo(
    () => (searchActive ? (crossSearch.data?.results ?? []) : []),
    [crossSearch.data, searchActive],
  );
  const searchFetching = searchActive && crossSearch.isFetching;
  const searchEmpty =
    searchActive &&
    !crossSearch.isFetching &&
    crossSearch.data != null &&
    resultRecords.length === 0;

  const filtered = useMemo(
    () =>
      items.filter((item) => matchesCommandQuery(localize(item.labelKey), item.keywords, query)),
    [items, localize, query],
  );

  const groups = useMemo(
    () =>
      COMMAND_PALETTE_GROUPS.map((group) => ({
        group,
        items: filtered.filter((item) => item.group === group),
      })).filter((entry) => entry.items.length > 0),
    [filtered],
  );

  const rows = useMemo<PaletteRow[]>(
    () => [
      ...filtered.map((item): PaletteRow => ({ kind: 'command', id: item.id, item })),
      ...resultRecords.map(
        (record): PaletteRow => ({ kind: 'result', id: `${record.type}-${record.id}`, record }),
      ),
    ],
    [filtered, resultRecords],
  );

  const safeIndex = rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);
  const activeRow = safeIndex >= 0 ? rows[safeIndex] : undefined;
  const activeOptionId = activeRow != null ? `${baseId}-option-${activeRow.id}` : undefined;

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, rows, open]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          /** Remember what had focus so closing can hand it back — the palette
           *  has no trigger element for the dialog primitive to restore to. */
          openerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  const runRow = useCallback(
    (row: PaletteRow) => {
      setOpen(false);
      if (row.kind === 'command') {
        row.item.run();
      } else {
        onNavigate?.(row.record.href);
      }
    },
    [onNavigate, setOpen],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      switch (event.key) {
        case 'ArrowDown': {
          if (rows.length === 0) return;
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % rows.length);
          break;
        }
        case 'ArrowUp': {
          if (rows.length === 0) return;
          event.preventDefault();
          setActiveIndex((index) => (index - 1 + rows.length) % rows.length);
          break;
        }
        case 'Home': {
          if (rows.length === 0) return;
          event.preventDefault();
          setActiveIndex(0);
          break;
        }
        case 'End': {
          if (rows.length === 0) return;
          event.preventDefault();
          setActiveIndex(rows.length - 1);
          break;
        }
        case 'Enter': {
          if (activeRow == null) return;
          event.preventDefault();
          runRow(activeRow);
          break;
        }
        case 'Escape': {
          /** The dialog primitive defers Escape to an open combobox so a popup can
           *  dismiss itself first, so the input owns the key: clear the query, or
           *  close the palette when there is nothing left to clear. */
          event.preventDefault();
          event.stopPropagation();
          if (query !== '') {
            setQuery('');
            setActiveIndex(0);
          } else {
            setOpen(false);
          }
          break;
        }
        default:
          break;
      }
    },
    [activeRow, rows, query, runRow, setOpen],
  );

  const showNoResults =
    query.trim() !== '' &&
    !searchFetching &&
    !searchEmpty &&
    filtered.length === 0 &&
    resultRecords.length === 0;
  const showEmpty = query.trim() === '' && items.length === 0;

  let resultsContent: ReactNode = null;
  if (isLoading) {
    resultsContent = (
      <div
        role="status"
        className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-text-secondary"
      >
        <Spinner className="h-4 w-4" />
        {localize('com_ui_loading')}
      </div>
    );
  } else if (filtered.length > 0 || resultRecords.length > 0 || searchFetching || searchEmpty) {
    resultsContent = (
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={localize('com_ui_command_palette_title')}
        className="max-h-[320px] overflow-y-auto p-2"
      >
        {groups.map((entry) => (
          <Fragment key={entry.group}>
            <li
              role="presentation"
              className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            >
              {localize(GROUP_LABEL_KEYS[entry.group])}
            </li>
            {entry.items.map((item) => {
              /** Commands occupy `rows` in `filtered` order before any results. */
              const index = filtered.indexOf(item);
              const isActive = index === safeIndex;
              return (
                <li
                  key={item.id}
                  id={`${baseId}-option-${item.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => runRow({ kind: 'command', id: item.id, item })}
                  className={cn(
                    'cursor-pointer rounded-lg px-3 py-2 text-sm text-text-primary',
                    isActive ? 'bg-surface-hover' : 'bg-transparent',
                  )}
                >
                  {localize(item.labelKey)}
                </li>
              );
            })}
          </Fragment>
        ))}
        {searchActive && (resultRecords.length > 0 || searchFetching || searchEmpty) && (
          <Fragment key="results">
            <li
              role="presentation"
              className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            >
              {localize('com_ui_command_palette_group_results')}
            </li>
            {resultRecords.map((record) => {
              const id = `${record.type}-${record.id}`;
              /** Results sit after every command row. */
              const index = filtered.length + resultRecords.indexOf(record);
              const isActive = index === safeIndex;
              const ResultIcon = record.type === 'project' ? Folder : MessageSquare;
              return (
                <li
                  key={id}
                  id={`${baseId}-option-${id}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => runRow({ kind: 'result', id, record })}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-primary',
                    isActive ? 'bg-surface-hover' : 'bg-transparent',
                  )}
                >
                  <ResultIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="truncate">
                    {record.title?.trim() || localize('com_ui_command_palette_untitled')}
                  </span>
                </li>
              );
            })}
            {searchFetching && (
              <li
                role="presentation"
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-tertiary"
              >
                <Spinner className="h-3 w-3" aria-hidden="true" />
                {localize('com_ui_command_palette_searching')}
              </li>
            )}
            {searchEmpty && (
              <li role="presentation" className="px-3 py-2 text-sm text-text-tertiary">
                {localize('com_ui_command_palette_search_empty')}
              </li>
            )}
          </Fragment>
        )}
      </ul>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogContent
        showCloseButton={false}
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault();
          openerRef.current?.focus?.();
        }}
      >
        <OGDialogTitle className="sr-only">
          {localize('com_ui_command_palette_title')}
        </OGDialogTitle>
        <OGDialogDescription className="sr-only">
          {localize('com_ui_command_palette_description')}
        </OGDialogDescription>

        <div className="flex items-center gap-3 border-b border-border-light px-4">
          <Search className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label={localize('com_ui_command_palette_placeholder')}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={localize('com_ui_command_palette_placeholder')}
            className="h-12 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>

        {resultsContent}

        {!isLoading && (showNoResults || showEmpty) && (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            {showNoResults
              ? localize('com_ui_command_palette_no_results')
              : localize('com_ui_command_palette_empty')}
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
