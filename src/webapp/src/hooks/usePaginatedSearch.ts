import { useState, useRef, useCallback } from 'react';
import userService from '../services/userService';
import type { User, SearchFilters, PageCacheEntry } from '../types';
import { MAX_CACHE_ENTRIES } from '../constants';

interface PaginatedSearchState {
  users: User[];
  loading: boolean;
  totalResults: number;
  error: string | null;
  lastRefreshed: Date | null;
}

interface UsePaginatedSearchReturn extends PaginatedSearchState {
  fetchPage: (searchText: string, filters: SearchFilters, page: number, size: number) => Promise<void>;
  clearCache: () => void;
}

export function usePaginatedSearch(): UsePaginatedSearchReturn {
  const [state, setState] = useState<PaginatedSearchState>({
    users: [],
    loading: false,
    totalResults: 0,
    error: null,
    lastRefreshed: null,
  });

  const pageCache = useRef<Record<string, PageCacheEntry>>({});
  const abortRef = useRef<AbortController | null>(null);

  const buildCacheKey = (searchText: string, filters: SearchFilters, size: number) =>
    JSON.stringify({ searchText, filters, pageSize: size });

  const clearCache = useCallback(() => {
    pageCache.current = {};
  }, []);

  const fetchPage = useCallback(async (
    searchText: string,
    filters: SearchFilters,
    page: number,
    size: number,
  ) => {
    const cacheKey = buildCacheKey(searchText, filters, size);
    const cached = pageCache.current[cacheKey]?.[page];
    if (cached) {
      setState(prev => ({
        ...prev,
        users: cached.users || [],
        totalResults: cached.total || 0,
        error: null,
      }));
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const data = await userService.searchUsers(
        searchText || '*',
        ['givenName', 'familyName', 'email', 'userName'],
        page,
        size,
        filters,
        { fuzziness: '0' },
        abortRef.current.signal,
      );

      const keys = Object.keys(pageCache.current);
      if (keys.length >= MAX_CACHE_ENTRIES) {
        delete pageCache.current[keys[0]];
      }
      if (!pageCache.current[cacheKey]) {
        pageCache.current[cacheKey] = {};
      }
      pageCache.current[cacheKey][page] = data;

      setState({
        users: data.users || [],
        totalResults: data.total || 0,
        loading: false,
        error: null,
        lastRefreshed: new Date(),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Search error:', err);
      setState({
        users: [],
        totalResults: 0,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastRefreshed: null,
      });
    }
  }, []);

  return { ...state, fetchPage, clearCache };
}
