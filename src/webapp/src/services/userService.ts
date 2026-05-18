import { fetchAuthSession } from 'aws-amplify/auth';
import type { SearchResponse, SearchFilters } from '../types';

class UserService {
  async getAuthToken(): Promise<string> {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error('No authentication token available');
    }

    return token;
  }

  async makeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken();
    const apiEndpoint = import.meta.env.VITE_API_ENDPOINT;

    const baseUrl = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const response = await fetch(`${baseUrl}${normalizedPath}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async searchUsers(
    searchText: string,
    fields: string[] = ['givenName', 'familyName', 'email', 'userName'],
    page: number = 1,
    size: number = 10,
    filters: SearchFilters = {},
    searchOptions: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    const requestBody = {
      search: {
        text: searchText.trim(),
        fields,
        ...searchOptions,
      },
      filters,
      pagination: {
        size,
        page: page - 1,
      },
    };

    return this.makeRequest<SearchResponse>('/users/search', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      signal,
    });
  }
}

export default new UserService();
