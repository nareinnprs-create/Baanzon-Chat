import { useMemo, useState, type ReactNode } from 'react';
import { Button, Input, Label, Spinner } from '@librechat/client';
import type { TAdminUser } from 'librechat-data-provider';
import { useAdminUsersQuery, useAdminUsersSearchQuery } from '~/data-provider/Admin/Users';
import { useLocalize } from '~/hooks';

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function UserRow({ user }: { user: TAdminUser }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {user.name || user.username || user.email}
          </span>
          <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
            {user.role}
          </span>
        </div>
        <p className="truncate text-xs text-text-secondary">
          {`${user.email} · ${formatDate(user.createdAt)}`}
        </p>
      </div>
    </li>
  );
}

/**
 * Admin view of every account (`GET /api/admin/users`, offset-paged) with
 * server-side search (`GET /api/admin/users/search?q`). Role management lives
 * with the roles backend; this page is read-only by design for now.
 */
export default function UsersManagement() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const trimmed = search.trim();
  const listQuery = useAdminUsersQuery(
    trimmed.length >= 2 ? undefined : { limit: PAGE_SIZE, offset },
  );
  const searchQuery = useAdminUsersSearchQuery(trimmed);

  const { users, total } = useMemo(() => {
    if (trimmed.length >= 2) {
      const data = searchQuery.data;
      return { users: data?.users ?? [], total: data?.total ?? 0, offset: 0 };
    }
    const data = listQuery.data;
    return { users: data?.users ?? [], total: data?.total ?? 0, offset: data?.offset ?? 0 };
  }, [trimmed, searchQuery.data, listQuery.data]);

  const isLoading = trimmed.length >= 2 ? searchQuery.isLoading : listQuery.isLoading;
  const error = trimmed.length >= 2 ? searchQuery.error : listQuery.error;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex justify-center py-4" role="status">
        <Spinner aria-label={localize('com_ui_admin_users')} />
      </div>
    );
  } else if (users.length === 0) {
    body = (
      <p className="rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-secondary">
        {localize('com_ui_admin_users_empty')}
      </p>
    );
  } else {
    body = (
      <>
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </ul>
        {trimmed.length < 2 && total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-text-secondary">
              {`${offset + 1}–${Math.min(offset + users.length, total)} / ${total}`}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {localize('com_ui_prev')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {localize('com_ui_next')}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Label id="admin-users-label">{localize('com_ui_admin_users')}</Label>
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        placeholder={localize('com_ui_admin_users_search')}
        aria-labelledby="admin-users-label"
        className="w-full"
      />
      {error != null && (
        <p className="text-sm text-red-500" role="alert">
          {localize('com_ui_admin_users_error')}
        </p>
      )}
      {body}
    </div>
  );
}
