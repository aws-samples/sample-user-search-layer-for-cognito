import { useState, useEffect } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  Table,
  Pagination,
  Box,
  CollectionPreferences,
  Select,
  Input,
  FormField,
  Button,
} from '@cloudscape-design/components';
import type {
  SelectProps,
  CollectionPreferencesProps,
  PaginationProps,
  InputProps,
} from '@cloudscape-design/components';
import type { SearchFilters } from '../types';
import { PAGE_SIZE_OPTIONS, ALL_FIELD_OPTIONS, USER_COLUMN_DEFINITIONS } from '../constants';
import { usePaginatedSearch } from '../hooks/usePaginatedSearch';

const FIELD_WIDTH = { width: '240px' } as const;
const INPUT_WIDTH = { width: '480px' } as const;

function buildFilters(field: string, text: string): SearchFilters {
  if (!text.trim()) return {};
  return { [field]: { value: text.trim(), mode: 'contains' } };
}

function SinglePropertySearch() {
  const [selectedField, setSelectedField] = useState<SelectProps.Option>(ALL_FIELD_OPTIONS[0]);
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshDisabled, setRefreshDisabled] = useState(false);

  const { users, loading, totalResults, error, lastRefreshed, fetchPage, clearCache } = usePaginatedSearch();

  useEffect(() => {
    fetchPage('*', {}, 1, pageSize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    setCurrentPage(1);
    clearCache();
    fetchPage('*', buildFilters(selectedField.value!, searchText), 1, pageSize);
  };

  const handleFieldChange: SelectProps['onChange'] = ({ detail }) => {
    setSelectedField(detail.selectedOption);
    setCurrentPage(1);
    clearCache();
    fetchPage('*', buildFilters(detail.selectedOption.value!, searchText), 1, pageSize);
  };

  const handlePageChange: PaginationProps['onChange'] = ({ detail }) => {
    setCurrentPage(detail.currentPageIndex);
    fetchPage('*', buildFilters(selectedField.value!, searchText), detail.currentPageIndex, pageSize);
  };

  const handlePageSizeChange: CollectionPreferencesProps['onConfirm'] = ({ detail }) => {
    const newSize = detail.pageSize!;
    setPageSize(newSize);
    setCurrentPage(1);
    clearCache();
    fetchPage('*', buildFilters(selectedField.value!, searchText), 1, newSize);
  };

  const handleRefresh = () => {
    if (refreshDisabled) return;
    setRefreshDisabled(true);
    clearCache();
    fetchPage('*', buildFilters(selectedField.value!, searchText), currentPage, pageSize);
    setTimeout(() => setRefreshDisabled(false), 1000);
  };

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

  return (
    <Container>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Select a property to search on, then type a value to filter users by that single field. This demonstrates single-field wildcard search against OpenSearch with server-side pagination."
        >
          Single Property User Search
        </Header>

        <SpaceBetween direction="horizontal" size="m">
          <FormField label="Property">
            <div style={FIELD_WIDTH}>
              <Select
                selectedOption={selectedField}
                onChange={handleFieldChange}
                options={ALL_FIELD_OPTIONS}
                ariaLabel="Select property to search"
              />
            </div>
          </FormField>
          <FormField label="Search value">
            <SpaceBetween direction="horizontal" size="xs">
              <div style={INPUT_WIDTH}>
                <Input
                  value={searchText}
                  onChange={({ detail }) => setSearchText(detail.value)}
                  placeholder={`Search by ${(selectedField.label ?? '').toLowerCase()}...`}
                  onKeyDown={({ detail }: { detail: InputProps.KeyDetail }) => {
                    if (detail.key === 'Enter') handleSearch();
                  }}
                  ariaLabel="Search value"
                />
              </div>
              <Button onClick={handleSearch}>Search</Button>
            </SpaceBetween>
          </FormField>
        </SpaceBetween>

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
                Enter a search term to find users.
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
              User Attributes
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

export default SinglePropertySearch;
