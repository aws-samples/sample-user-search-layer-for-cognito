import type { CollectionPreferencesProps } from '@cloudscape-design/components';
import type { User, FieldOption } from './types';

export const MAX_CACHE_ENTRIES = 50;

export const PAGE_SIZE_OPTIONS: CollectionPreferencesProps.PageSizeOption[] = [
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
];

export const SEARCH_FIELD_OPTIONS: FieldOption[] = [
  { value: 'userName', label: 'Username' },
  { value: 'givenName', label: 'First Name' },
  { value: 'familyName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
];

export const ALL_FIELD_OPTIONS: FieldOption[] = [
  ...SEARCH_FIELD_OPTIONS,
  { value: 'groups', label: 'Groups' },
  { value: 'appClientLogins.clientId', label: 'App Client ID' },
];

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { timeZoneName: 'short' });

export const USER_COLUMN_DEFINITIONS = [
  { id: 'userName', header: 'Username', cell: (item: User) => item.userName || '-' },
  { id: 'givenName', header: 'First Name', cell: (item: User) => item.givenName || '-' },
  { id: 'familyName', header: 'Last Name', cell: (item: User) => item.familyName || '-' },
  { id: 'email', header: 'Email', cell: (item: User) => item.email || '-' },
  { id: 'groups', header: 'Groups', cell: (item: User) => (item.groups || []).join(', ') || '-' },
  {
    id: 'appClientLogins',
    header: 'App Client Logins',
    cell: (item: User) => {
      const logins = item.appClientLogins;
      if (!logins || logins.length === 0) return '-';
      return logins
        .map((l) => `${l.clientId}: ${formatDateTime(l.lastLogin)}`)
        .join(' | ');
    },
  },
  {
    id: 'lastUpdatedTimestamp',
    header: 'Last Updated',
    cell: (item: User) => item.lastUpdatedTimestamp ? formatDateTime(item.lastUpdatedTimestamp) : '-',
  },
  {
    id: 'lastLoginTimestamp',
    header: 'Last Login',
    cell: (item: User) => item.lastLoginTimestamp ? formatDateTime(item.lastLoginTimestamp) : '-',
  },
];
