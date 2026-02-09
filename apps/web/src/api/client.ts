/**
 * API client for ChronosOps backend
 */
import { config } from '../config/env';

// Use getter to ensure runtime evaluation (not frozen at build time)
export const getApiBase = () => config.apiUrl;
export const API_BASE = getApiBase();

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: string
  ) {
    super(`API Error: ${status} ${statusText}`);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/**
 * Generic API client function with error handling
 */
export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // Get API base at runtime (not cached at module load)
  const url = `${getApiBase()}${endpoint}`;

  try {
    // Only include Content-Type header when there's a body
    const headers: Record<string, string> = {};

    // Copy existing headers
    if (options?.headers) {
      const existingHeaders = options.headers;
      if (existingHeaders instanceof Headers) {
        existingHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(existingHeaders)) {
        existingHeaders.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, existingHeaders);
      }
    }

    // Add Content-Type only if there's a body
    if (options?.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(response.status, response.statusText, body);
    }

    // Handle empty responses (e.g., 204 No Content)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network or other errors
    throw new ApiError(0, 'Network Error', String(error));
  }
}

/**
 * Helper for building query strings
 */
export function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.append(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}
