export interface AppClientLogin {
  clientId: string;
  lastLogin: string;
}

export interface User {
  userName: string;
  givenName: string;
  familyName: string;
  email: string;
  groups?: string[];
  appClientLogins?: AppClientLogin[];
  lastUpdatedTimestamp?: string;
  lastLoginTimestamp?: string;
}

export interface SearchResponse {
  users: User[];
  total: number;
  took: number;
}

export interface FilterValue {
  value: string;
  mode: string;
}

export interface SearchFilters {
  [key: string]: FilterValue;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface PageCacheEntry {
  [page: number]: { users: User[]; total: number };
}
