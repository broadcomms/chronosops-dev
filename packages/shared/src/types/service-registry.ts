/**
 * Service Registry types for multi-service architecture
 * Enables frontend apps to discover and consume backend APIs
 */

import type { ServiceType } from './development.js';

/**
 * HTTP methods supported by API endpoints
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Represents a single API endpoint in a backend service
 */
export interface ServiceEndpoint {
  /** HTTP method */
  method: HttpMethod;
  /** URL path (e.g., /todos, /todos/:id) */
  path: string;
  /** Human-readable description */
  description: string;
  /** Request body schema (for POST/PUT/PATCH) */
  requestBody?: {
    contentType: string;
    schema: Record<string, unknown>;
    required?: boolean;
  };
  /** Response schema */
  responseSchema?: Record<string, unknown>;
  /** Path parameters (e.g., ['id'] for /todos/:id) */
  pathParams?: string[];
  /** Query parameters */
  queryParams?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
  /** Tags for grouping endpoints */
  tags?: string[];
}

/**
 * Service status options
 */
export const SERVICE_STATUS = {
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  RETIRED: 'retired',
} as const;

export type ServiceStatus = (typeof SERVICE_STATUS)[keyof typeof SERVICE_STATUS];

/**
 * Represents a registered service in the service registry
 */
export interface RegisteredService {
  /** Unique service ID */
  id: string;
  /** Development cycle that created this service */
  developmentCycleId: string;
  /** Internal service name (used in K8s) */
  name: string;
  /** Human-friendly display name */
  displayName: string;
  /** Service description */
  description?: string;
  /** Service type */
  serviceType: ServiceType;
  /** Kubernetes namespace */
  namespace: string;
  /** Full service URL (e.g., http://localhost:30123) */
  serviceUrl: string;
  /** Health check endpoint path */
  healthEndpoint?: string;
  /** OpenAPI specification (for backends) */
  apiSpec?: Record<string, unknown>;
  /** API version (e.g., "1.0.0") */
  apiVersion?: string;
  /** List of available endpoints */
  endpoints: ServiceEndpoint[];
  /** IDs of services this service depends on */
  dependsOnServices: string[];
  /** Current service status */
  status: ServiceStatus;
  /** Last successful health check timestamp */
  lastHealthCheck?: Date;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input for creating a new service in the registry
 */
export interface CreateServiceInput {
  developmentCycleId: string;
  name: string;
  displayName: string;
  description?: string;
  serviceType: ServiceType;
  namespace: string;
  serviceUrl: string;
  healthEndpoint?: string;
  apiSpec?: Record<string, unknown>;
  apiVersion?: string;
  endpoints?: ServiceEndpoint[];
  dependsOnServices?: string[];
}

/**
 * Input for updating an existing service
 */
export interface UpdateServiceInput {
  displayName?: string;
  description?: string;
  serviceUrl?: string;
  healthEndpoint?: string;
  apiSpec?: Record<string, unknown>;
  apiVersion?: string;
  endpoints?: ServiceEndpoint[];
  status?: ServiceStatus;
  lastHealthCheck?: Date;
}

/**
 * Parameters for listing services
 */
export interface ServiceRegistryListParams {
  /** Filter by service type */
  serviceType?: ServiceType;
  /** Filter by status */
  status?: ServiceStatus;
  /** Filter by namespace */
  namespace?: string;
  /** Pagination limit */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Simplified service info for frontend service picker
 */
export interface ServiceSummary {
  id: string;
  name: string;
  displayName: string;
  serviceType: ServiceType;
  serviceUrl: string;
  status: ServiceStatus;
  /** Count of available endpoints */
  endpointCount: number;
  /** Preview of endpoint paths */
  endpointPreviews: string[];
}

/**
 * Result of extracting API spec from a service
 */
export interface ApiSpecExtractionResult {
  success: boolean;
  /** Extracted OpenAPI specification */
  spec?: Record<string, unknown>;
  /** Extracted endpoints */
  endpoints?: ServiceEndpoint[];
  /** Error message if extraction failed */
  error?: string;
  /** Method used for extraction */
  method?: 'openapi' | 'swagger' | 'inferred';
}
