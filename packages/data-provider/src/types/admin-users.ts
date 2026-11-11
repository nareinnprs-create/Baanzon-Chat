/** A user row in the admin users list (`GET /api/admin/users`). */
export interface TAdminUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar?: string;
  role: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

/** Paginated users list (`GET /api/admin/users?limit&offset`). */
export interface TAdminUsersResponse {
  users: TAdminUser[];
  total: number;
  limit: number;
  offset: number;
}

/** Search results (`GET /api/admin/users/search?q`). Server caps the result count. */
export interface TAdminUsersSearchResponse {
  users: TAdminUser[];
  total: number;
  capped?: boolean;
}

export interface TAdminUsersListParams {
  limit?: number;
  offset?: number;
}

export interface TAdminUsersSearchParams {
  q: string;
  limit?: number;
}
