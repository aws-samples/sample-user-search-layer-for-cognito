import { useState, useRef, useEffect } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  Table,
  Pagination,
  Box,
  CollectionPreferences,
  PropertyFilter,
  Button,
} from '@cloudscape-design/components';
import type { PropertyFilterProps, CollectionPreferencesProps, PaginationProps } from '@cloudscape-design/components';
import type { SearchFilters } from '../types';
import { PAGE_SIZE_OPTIONS, USER_COLUMN_DEFINITIONS } from '../constants';
import { usePaginatedSearch } from '../hooks/usePaginatedSearch';

const DEBOUNCE_MS = 300;

const FILTERING_PROPERTIES: PropertyFilterProps.FilteringProperty[] = [
  { key: 'userName', propertyLabel: 'Username', groupValuesLabel: 'Username values', operators: [':'], defaultOperator: ':' },
  { key: 'givenName', propertyLabel: 'First Name', groupValuesLabel: 'First Name values', operators: [':'], defaultOperator: ':' },
  { key: 'familyName', propertyLabel: 'Last Name', groupValuesLabel: 'Last Name values', operators: [':'], defaultOperator: ':' },
  { key: 'email', propertyLabel: 'Email', groupValuesLabel: 'Email values', operators: [':'], defaultOperator: ':' },
  { key: 'groups', propertyLabel: 'Groups', groupValuesLabel: 'Groups values', operators: [':'], defaultOperator: ':' },
  { key: 'appClientLogins.clientId', propertyLabel: 'App Client ID', groupValuesLabel: 'App Client ID values', operators: [':'], defaultOperator: ':' },
];

function buildSearchFilters(query: PropertyFilterProps.Query): SearchFilters {
  const filters: SearchFilters = {};
  for (const token of query.tokens) {
    if (token.propertyKey) {
      filters[token.propertyKey] = { value: token.value, mode: token.operator === '=' ? 'exact' : 'contains' };
    }
  }
  return filters;
}

function MultiPropertySearch() {
  const [query, setQuery] = useState<PropertyFilterProps.Query>({ tokens: [], operation: 'and' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshDisabled, setRefreshDisabled] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { users, loading, totalResults, error, lastRefreshed, fetchPage, clearCache } = usePaginatedSearch();

  useEffect(() => {
    fetchPage('*', {}, 1, pageSize);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueryChange: PropertyFilterProps['onChange'] = ({ detail }) => {
    // Deduplicate: keep only the latest filter per property key
    const seen = new Set<string>();
    const deduped: PropertyFilterProps.Token[] = [];
    for (let i = detail.tokens.length - 1; i >= 0; i--) {
      const token = detail.tokens[i];
      const key = token.propertyKey ?? '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      deduped.unshift(token);
    }
    const sanitized = { ...detail, tokens: deduped };

    setQuery(sanitized);
    setCurrentPage(1);
    clearCache();

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchPage('*', buildSearchFilters(sanitized), 1, pageSize);
    }, DEBOUNCE_MS);
  };

  const handlePageSizeChange: CollectionPreferencesProps['onConfirm'] = ({ detail }) => {
    const newSize = detail.pageSize!;
    setPageSize(newSize);
    setCurrentPage(1);
    clearCache();
    fetchPage('*', buildSearchFilters(query), 1, newSize);
  };

  const handlePageChange: PaginationProps['onChange'] = ({ detail }) => {
    setCurrentPage(detail.currentPageIndex);
    fetchPage('*', buildSearchFilters(query), detail.currentPageIndex, pageSize);
  };

  const handleRefresh = () => {
    if (refreshDisabled) return;
    setRefreshDisabled(true);
    clearCache();
    fetchPage('*', buildSearchFilters(query), currentPage, pageSize);
    setTimeout(() => setRefreshDisabled(false), 1000);
  };

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const hasTokens = query.tokens.length > 0;

  return (
    <Container>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Select one or more properties to search on, then type values to filter users across multiple fields simultaneously. This demonstrates multi-field wildcard search against OpenSearch with server-side pagination."
        >
          Multi-Property User Search
        </Header>

        <PropertyFilter
          query={query}
          onChange={handleQueryChange}
          filteringProperties={FILTERING_PROPERTIES}
          filteringPlaceholder="Search users by property"
          filteringAriaLabel="Filter users"
          hideOperations
          disableFreeTextFiltering
          countText={hasTokens && totalResults > 0 ? `${totalResults} match${totalResults === 1 ? '' : 'es'}` : undefined}
          i18nStrings={{
            groupPropertiesText: 'Properties',
            groupValuesText: 'Values',
            operatorsText: 'Operators',
            operationAndText: 'and',
            operationOrText: 'or',
            operatorContainsText: 'Contains',
            operatorDoesNotContainText: 'Does not contain',
            operatorEqualsText: 'Equals',
            operatorDoesNotEqualText: 'Does not equal',
            editTokenHeader: 'Edit filter',
            propertyText: 'Property',
            operatorText: 'Operator',
            valueText: 'Value',
            cancelActionText: 'Cancel',
            applyActionText: 'Apply',
            clearFiltersText: 'Clear filters',
            allPropertiesLabel: 'All properties',
            enteredTextLabel: (text: string) => `Use: "${text}"`,
            tokenLimitShowMore: 'Show more',
            tokenLimitShowFewer: 'Show fewer',
          }}
        />

        {error && (
          <Box color="text-status-error" variant="p">
            <b>Error:</b> {error}
          </Box>
        )}

        <Table
          columnDefinitions={USER_COLUMN_DEFINITIONS}
          items={users}
          loading={loading}
          loadingText="Searching users..."
          resizableColumns
          empty={
            <Box textAlign="center" color="inherit">
              <b>No users found</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                Enter a search term or apply property filters to find users.
              </Box>
            </Box>
          }
          header={
            <Header
              counter={totalResults > 0 ? `(${totalResults} total)` : undefined}
              actions={
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh results"
                  onClick={handleRefresh}
                  disabled={refreshDisabled || loading}
                />
              }
              description={lastRefreshed ? `Last refreshed: ${lastRefreshed.toLocaleTimeString()}` : undefined}
            >
              Users
            </Header>
          }
          pagination={
            totalResults > pageSize ? (
              <Pagination
                currentPageIndex={currentPage}
                pagesCount={totalPages}
                onChange={handlePageChange}
              />
            ) : null
          }
          preferences={
            <CollectionPreferences
              title="Preferences"
              confirmLabel="Confirm"
              cancelLabel="Cancel"
              preferences={{ pageSize }}
              pageSizePreference={{
                title: 'Page size',
                options: PAGE_SIZE_OPTIONS,
              }}
              onConfirm={handlePageSizeChange}
            />
          }
        />
      </SpaceBetween>
    </Container>
  );
}

export default MultiPropertySearch;
