import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  Select,
  Autosuggest,
  Table,
  Box,
} from '@cloudscape-design/components';
import type { SelectProps, AutosuggestProps } from '@cloudscape-design/components';
import userService from '../services/userService';
import type { User } from '../types';
import { SEARCH_FIELD_OPTIONS, USER_COLUMN_DEFINITIONS } from '../constants';

const DEBOUNCE_MS = 250;
const FIELD_WIDTH = { width: '240px' } as const;
const INPUT_WIDTH = { width: '480px' } as const;

interface SuggestionOption extends AutosuggestProps.Option {
  userData?: User;
}

function AutosuggestSearch() {
  const [selectedField, setSelectedField] = useState<SelectProps.Option>(SEARCH_FIELD_OPTIONS[0]);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionOption[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  const fetchSuggestions = useCallback(async (field: string, text: string) => {
    if (!text.trim()) {
      setSuggestions([]);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setSuggestLoading(true);
    try {
      const data = await userService.searchUsers(
        '*',
        ['givenName', 'familyName', 'email', 'userName'],
        1,
        10,
        { [field]: { value: text.trim(), mode: 'contains' } },
        { fuzziness: '0' },
        abortRef.current.signal,
      );

      setSuggestions(
        (data.users || []).map((user) => ({
          value: user.userName,
          label: `${user.givenName} ${user.familyName} (${user.userName})`,
          description: user.email,
          userData: user,
        })),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Autosuggest error:', err);
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const handleSearchChange: AutosuggestProps['onChange'] = ({ detail }) => {
    setSearchText(detail.value);
    setSelectedUser(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(selectedField.value!, detail.value);
    }, DEBOUNCE_MS);
  };

  const handleSelect: AutosuggestProps['onSelect'] = ({ detail }) => {
    setSearchText(detail.value);
    const match = suggestions.find(s => s.value === detail.value);
    if (match?.userData) {
      setSelectedUser(match.userData);
    }
  };

  const handleFieldChange: SelectProps['onChange'] = ({ detail }) => {
    setSelectedField(detail.selectedOption);
    setSearchText('');
    setSuggestions([]);
    setSelectedUser(null);
  };

  return (
    <Container>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Select a property (Username, First Name, Last Name, or Email), then start typing to see the top 10 matching users suggested as you type. Each suggestion shows the user's name, username, and email. Select a user to view their full details."
        >
          Autosuggest Users Based on Property
        </Header>

        <SpaceBetween direction="horizontal" size="m">
          <FormField label="Property">
            <div style={FIELD_WIDTH}>
              <Select
                selectedOption={selectedField}
                onChange={handleFieldChange}
                options={SEARCH_FIELD_OPTIONS}
                ariaLabel="Select property to search"
              />
            </div>
          </FormField>
          <FormField label="Search value">
            <div style={INPUT_WIDTH}>
              <Autosuggest
                value={searchText}
                onChange={handleSearchChange}
                onSelect={handleSelect}
                options={suggestions}
                placeholder={`Type to search by ${(selectedField.label ?? '').toLowerCase()}...`}
                ariaLabel="Search and select user"
                enteredTextLabel={(value) => `Use: "${value}"`}
                loadingText="Searching..."
                statusType={suggestLoading ? 'loading' : 'finished'}
                empty="No users found"
              />
            </div>
          </FormField>
        </SpaceBetween>

        {selectedUser && (
          <Table
            columnDefinitions={USER_COLUMN_DEFINITIONS}
            items={[selectedUser]}
            resizableColumns
            header={<Header>Selected User</Header>}
          />
        )}

        {!selectedUser && searchText && suggestions.length > 0 && (
          <Box color="text-body-secondary" variant="p">
            Select a user from the suggestions above to view their details.
          </Box>
        )}
      </SpaceBetween>
    </Container>
  );
}

export default AutosuggestSearch;
