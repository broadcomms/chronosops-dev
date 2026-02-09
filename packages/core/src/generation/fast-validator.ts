/**
 * FastValidator - Instant pattern validation before TypeScript compilation
 * 
 * This validator catches common errors in <100ms using regex patterns.
 * It runs BEFORE the expensive TypeScript compiler, providing instant feedback.
 * 
 * Target: Catch 95% of pattern-based errors before compilation
 */

import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'FastValidator' });

// =============================================================================
// TYPES
// =============================================================================

export interface FastValidationResult {
  valid: boolean;
  errors: FastValidationError[];
  warnings: FastValidationWarning[];
  /** @deprecated Use hasFixableErrors instead - fixable was true only when ALL errors were fixable */
  fixable: boolean;
  /** True if at least one error can be auto-fixed */
  hasFixableErrors: boolean;
  /** List of error codes that can be auto-fixed */
  fixableErrorCodes: string[];
  suggestedFixes: Map<string, string>;
}

export interface FastValidationError {
  code: string;
  message: string;
  line?: number;
  column?: number;
  pattern: string;
  fix: string;
}

export interface FastValidationWarning {
  code: string;
  message: string;
  suggestion: string;
}

// =============================================================================
// PATTERN DEFINITIONS
// =============================================================================

/**
 * Banned patterns that ALWAYS indicate errors
 * These are checked first and cause immediate validation failure
 */
const BANNED_PATTERNS = [
  {
    regex: /req\.body\s+as\s+[A-Z]/g,
    code: 'REQ_BODY_AS_CAST',
    message: 'Using "as" cast on req.body bypasses validation',
    fix: 'Use Schema.parse(req.body) with try/catch instead',
    severity: 'error' as const,
  },
  {
    regex: /<[A-Z][a-zA-Z]*(?:Input|Request|Body|Data)?>req\.body/g,
    code: 'REQ_BODY_ANGLE_CAST',
    message: 'Using angle bracket cast on req.body bypasses validation',
    fix: 'Use Schema.parse(req.body) with try/catch instead',
    severity: 'error' as const,
  },
  {
    regex: /from\s+['"]uuid['"]/g,
    code: 'UUID_PACKAGE_IMPORT',
    message: 'Importing uuid package requires npm install',
    fix: "Use import { randomUUID } from 'crypto' instead (built-in)",
    severity: 'error' as const,
  },
  {
    regex: /express\.Request/g,
    code: 'EXPRESS_NAMESPACE_REQUEST',
    message: 'Using express.Request instead of imported type',
    fix: "Import { Request } from 'express' and use Request directly",
    severity: 'error' as const,
  },
  {
    regex: /express\.Response/g,
    code: 'EXPRESS_NAMESPACE_RESPONSE',
    message: 'Using express.Response instead of imported type',
    fix: "Import { Response } from 'express' and use Response directly",
    severity: 'error' as const,
  },
  {
    regex: /const\s+\{[^}]+\}\s*=\s*req\.body(?!\s*;)/g,
    code: 'DESTRUCTURE_UNVALIDATED_BODY',
    message: 'Destructuring req.body without validation',
    fix: 'Validate with Schema.parse(req.body) first, then destructure the result',
    severity: 'error' as const,
  },
  {
    // Matches patterns like: findById(req.params.id) or storage.get(req.params.id)
    // where req.params.id is passed directly to a function without type assertion
    // Note: \b word boundary prevents backtracking from matching partial param names
    regex: /\(\s*req\.params\.\w+\b\s*\)(?!\s*as\s+string)/g,
    code: 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION',
    message: 'Using req.params directly without type assertion (type is string | string[])',
    fix: 'Cast to string: (req.params.id as string) or use String(req.params.id)',
    severity: 'error' as const,
  },
  {
    // Matches: const id = req.params.id without type assertion
    // Note: \b word boundary prevents backtracking from matching partial param names
    regex: /const\s+\w+\s*=\s*req\.params\.\w+\b(?!\s*as\s+string)/g,
    code: 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST',
    message: 'Assigning req.params value without type assertion (type is string | string[])',
    fix: 'Add type assertion: const id = req.params.id as string',
    severity: 'error' as const,
  },
  {
    // Matches: parseInt(req.query.page, 10) or Number(req.query.limit) without String() wrapper
    // req.query values have type string | string[] | ParsedQs | undefined
    // Passing directly to parseInt/Number causes TS2345: string | string[] not assignable to string
    regex: /(?:parseInt|Number)\s*\(\s*req\.query\.\w+\s*(?:,|\))/g,
    code: 'REQ_QUERY_DIRECT_PARSE',
    message: 'Using req.query directly in parseInt/Number - type is string | string[] | undefined',
    fix: 'Wrap with String(): parseInt(String(req.query.page || "1"), 10)',
    severity: 'error' as const,
  },
  {
    // Matches: someFunction(req.query.param) where query param is passed directly to a function
    // This catches cases like: storage.get(req.query.id) or filter(req.query.name)
    // Excludes: String(req.query.x), parseInt(String(req.query.x)) which are already wrapped
    regex: /(?<!String\s*\()\(\s*req\.query\.\w+\s*\)(?!\s*(?:as|\.toString))/g,
    code: 'REQ_QUERY_WITHOUT_STRING_WRAPPER',
    message: 'Using req.query directly as function argument - type is string | string[] | undefined',
    fix: 'Wrap with String(): someFunction(String(req.query.param || ""))',
    severity: 'error' as const,
  },
  {
    // Matches: const x = req.query.x without String() or type handling
    // Excludes assignments that already use String() wrapper
    regex: /const\s+\w+\s*=\s*req\.query\.\w+\b(?!\s*(?:as\s+string|\?\?|\.toString|\|\|))/g,
    code: 'REQ_QUERY_ASSIGNMENT_WITHOUT_STRING',
    message: 'Assigning req.query value without String() wrapper (type is string | string[] | undefined)',
    fix: 'Wrap with String(): const page = String(req.query.page || "1")',
    severity: 'error' as const,
  },
  // =========================================================================
  // POSTGRESQL TIMESTAMP SAFETY (auto-fixable)
  // =========================================================================
  {
    // Detects .createdAt.toISOString() or .updatedAt.toISOString() without optional chaining
    // PostgreSQL returns Date objects which can be undefined if column is nullable
    // This causes "TypeError: Cannot read properties of undefined (reading 'toISOString')"
    // The fix is to use optional chaining: .createdAt?.toISOString() ?? new Date().toISOString()
    regex: /\b\w+\.(?:createdAt|updatedAt)\.toISOString\(\)/g,
    code: 'POSTGRES_TIMESTAMP_NULL_CHECK',
    message: 'Calling .toISOString() on timestamp field without null check (PostgreSQL can return undefined)',
    fix: 'Use optional chaining: .createdAt?.toISOString() ?? new Date().toISOString()',
    severity: 'error' as const,
  },
  {
    // Detects db.select() or db.insert() etc. without await
    // Drizzle queries are async and MUST be awaited
    // Missing await causes "Promise { <pending> }" to be returned instead of data
    regex: /(?<!await\s+)(?<!return\s+)db\.(?:select|insert|update|delete)\s*\(\s*\)/g,
    code: 'POSTGRES_MISSING_AWAIT',
    message: 'Drizzle query without await (will return Promise instead of data)',
    fix: 'Add await: const result = await db.select()...',
    severity: 'warning' as const,
  },
  {
    // Detects JSON.parse on potentially nullable column without null check
    // PostgreSQL can return null for JSON/JSONB columns
    // This causes "SyntaxError: Unexpected token 'u'" when parsing undefined
    regex: /JSON\.parse\s*\(\s*\w+\.(?!.*\?\s*\?\s*['"`{])\w+\s*\)/g,
    code: 'POSTGRES_JSON_PARSE_NO_NULL_CHECK',
    message: 'JSON.parse on column without null check (PostgreSQL can return null)',
    fix: 'Add null check: JSON.parse(item.data ?? "{}")',
    severity: 'warning' as const,
  },
  // =========================================================================
  // UNUSED IMPORT DETECTION (auto-fixable)
  // =========================================================================
  {
    // Detects NextFunction import when it's not used in the code
    // This is a common issue because prompts include NextFunction in examples
    // but generated middleware often doesn't use it
    regex: /import\s*\{[^}]*\bNextFunction\b[^}]*\}\s*from\s*['"]express['"]/g,
    code: 'UNUSED_NEXTFUNCTION_IMPORT',
    message: 'NextFunction imported but likely unused (check if any middleware uses next parameter)',
    fix: 'Remove NextFunction from import if not used in any (req, res, next) => ... handlers',
    severity: 'warning' as const, // Warning so it doesn't block, but can be auto-fixed
  },
];

/**
 * Required patterns that MUST be present in all generated code
 */
const REQUIRED_PATTERNS = [
  {
    regex: /import\s+(?:express\s*,\s*)?\{\s*(?:[^}]*\b)?Request\b(?:[^}]*)?\}\s*from\s+['"]express['"]/,
    code: 'MISSING_REQUEST_TYPE_IMPORT',
    message: 'Request type not imported from express',
    fix: "Add: import express, { Request, Response } from 'express'",
  },
  {
    regex: /import\s+(?:express\s*,\s*)?\{\s*(?:[^}]*\b)?Response\b(?:[^}]*)?\}\s*from\s+['"]express['"]/,
    code: 'MISSING_RESPONSE_TYPE_IMPORT',
    message: 'Response type not imported from express',
    fix: "Add: import express, { Request, Response } from 'express'",
  },
  {
    regex: /import\s+\{\s*z\s*\}\s*from\s+['"]zod['"]/,
    code: 'MISSING_ZOD_IMPORT',
    message: 'Zod not imported',
    fix: "Add: import { z } from 'zod'",
  },
  {
    regex: /import\s+\{\s*randomUUID\s*\}\s*from\s+['"]crypto['"]/,
    code: 'MISSING_CRYPTO_IMPORT',
    message: 'randomUUID not imported from crypto',
    fix: "Add: import { randomUUID } from 'crypto'",
  },
];

/**
 * Endpoint patterns that must exist
 */
const REQUIRED_ENDPOINTS = [
  {
    regex: /app\.get\s*\(\s*['"]\/health['"]/,
    code: 'MISSING_HEALTH_ENDPOINT',
    message: 'Health endpoint not defined',
    fix: "Add: app.get('/health', (_req, res) => res.json({ status: 'ok' }))",
  },
  {
    // NOTE: Previous regex was too permissive - it passed if API_INFO existed ANYWHERE in the code
    // even if it wasn't used in an actual root route handler. Now we only check for:
    // 1. app.get('/') - explicit root route
    // 2. app.get('/', ...) patterns
    regex: /app\.get\s*\(\s*['"]\/['"](?:\s*,|\s*\))/,
    code: 'MISSING_ROOT_ENDPOINT',
    message: 'Root endpoint (/) not defined - should return API metadata',
    fix: "Add: app.get('/', (_req, res) => res.json({ name: '...', version: '1.0.0', docs: '/docs' }))",
  },
  {
    regex: /app\.get\s*\(\s*['"]\/docs['"]/,
    code: 'MISSING_DOCS_ENDPOINT',
    message: 'Documentation endpoint (/docs) not defined - should serve Swagger UI',
    fix: "Add: app.get('/docs', (_req, res) => res.send(swaggerHtml))",
  },
  {
    regex: /app\.get\s*\(\s*['"]\/openapi\.json['"]/,
    code: 'MISSING_OPENAPI_ENDPOINT',
    message: 'OpenAPI spec endpoint (/openapi.json) not defined',
    fix: "Add: app.get('/openapi.json', (_req, res) => res.json(openApiSpec))",
  },
];

/**
 * Find matching closing brace using proper brace counting
 * Handles nested braces correctly (unlike simple regex)
 */
function findMatchingBraceInSection(content: string, startIndex: number): number {
  let braceCount = 1;
  let i = startIndex;
  let inString = false;
  let stringChar = '';

  while (i < content.length && braceCount > 0) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';

    // Handle escape sequences in strings
    if (inString && prevChar === '\\') {
      i++;
      continue;
    }

    // Handle string boundaries
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      i++;
      continue;
    }
    if (inString && char === stringChar) {
      inString = false;
      stringChar = '';
      i++;
      continue;
    }

    // Skip if in string
    if (inString) {
      i++;
      continue;
    }

    // Count braces (only outside strings)
    if (char === '{') braceCount++;
    else if (char === '}') braceCount--;

    i++;
  }

  return braceCount === 0 ? i - 1 : -1;
}

/**
 * Parse OpenAPI paths section to find ALL methods for each path
 * Uses proper brace matching to handle nested objects correctly
 */
function parseOpenApiPaths(pathsContent: string): Set<string> {
  const specPaths = new Set<string>();

  // Find each path entry: '/users': { ... }
  const pathEntryRegex = /['"]([^'"]+)['"]\s*:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pathEntryRegex.exec(pathsContent)) !== null) {
    const path = match[1];
    if (!path) continue;

    const startIndex = match.index + match[0].length;

    // Find matching closing brace using proper brace counting
    const endIndex = findMatchingBraceInSection(pathsContent, startIndex);
    if (endIndex === -1) continue;

    // Extract the path object content
    const pathContent = pathsContent.substring(startIndex - 1, endIndex + 1);

    // Find ALL methods in this path object
    const methods = ['get', 'post', 'put', 'patch', 'delete'];
    for (const method of methods) {
      // Look for method: { pattern (method as a key in the object)
      const methodRegex = new RegExp(`['"]?${method}['"]?\\s*:\\s*\\{`);
      if (methodRegex.test(pathContent)) {
        specPaths.add(`${method}:${path}`);
      }
    }
  }

  return specPaths;
}

/**
 * Check if OpenAPI spec is incomplete (missing routes that exist as handlers)
 * Returns missing paths that should be added to the OpenAPI spec
 */
function detectIncompleteOpenApiSpec(code: string): { hasMissingPaths: boolean; missingPaths: string[] } {
  // Extract all route handlers from code
  const routePattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
  const actualRoutes: Set<string> = new Set();
  let routeMatch: RegExpExecArray | null;

  while ((routeMatch = routePattern.exec(code)) !== null) {
    const method = (routeMatch[1] ?? 'get').toLowerCase();
    const path = routeMatch[2] ?? '/';

    // Skip infrastructure endpoints
    if (['/openapi.json', '/docs', '/health', '/healthz', '/health/live', '/health/ready', '/readyz', '/metrics', '/'].includes(path)) {
      continue;
    }

    // Normalize Express-style params (:id) to OpenAPI-style ({id})
    // so they match the paths parsed from the openApiSpec object
    const openApiPath = path.replace(/:([\w]+)/g, '{$1}');
    actualRoutes.add(`${method}:${openApiPath}`);
  }

  // Find the paths section in openApiSpec using proper brace matching
  const pathsStartMatch = code.match(/const\s+openApiSpec\s*=\s*\{[\s\S]*?paths:\s*\{/);
  if (!pathsStartMatch || pathsStartMatch.index === undefined) {
    return { hasMissingPaths: false, missingPaths: [] }; // No openApiSpec, MISSING_OPENAPI_ENDPOINT will handle it
  }

  // Find the end of the paths section using brace matching
  const pathsStartIndex = pathsStartMatch.index + pathsStartMatch[0].length;
  const pathsEndIndex = findMatchingBraceInSection(code, pathsStartIndex);

  if (pathsEndIndex === -1) {
    return { hasMissingPaths: false, missingPaths: [] }; // Malformed paths section
  }

  // Extract the paths content
  const pathsContent = code.substring(pathsStartIndex - 1, pathsEndIndex + 1);

  // Parse paths to find ALL methods (not just the first one per path)
  const specPaths = parseOpenApiPaths(pathsContent);

  // Find routes that exist as handlers but missing from OpenAPI spec
  const missingPaths: string[] = [];
  for (const route of actualRoutes) {
    if (!specPaths.has(route)) {
      missingPaths.push(route);
    }
  }

  return { hasMissingPaths: missingPaths.length > 0, missingPaths };
}

/**
 * Route-specific patterns that must be present when POST/PUT routes exist
 */
const ROUTE_VALIDATION_PATTERNS = [
  {
    check: (code: string) => {
      const hasPost = /app\.post\s*\(/.test(code);
      const hasPut = /app\.put\s*\(/.test(code);
      const hasPatch = /app\.patch\s*\(/.test(code);
      
      if (!hasPost && !hasPut && !hasPatch) return true; // No body routes, skip
      
      // Must have Schema.parse(req.body) for body routes
      return /\w+Schema\.parse\s*\(\s*req\.body\s*\)/.test(code);
    },
    code: 'MISSING_SCHEMA_PARSE',
    message: 'POST/PUT/PATCH route without Schema.parse(req.body)',
    fix: 'Add: const input = CreateSchema.parse(req.body) in try/catch',
  },
  {
    check: (code: string) => {
      const hasPost = /app\.post\s*\(/.test(code);
      const hasPut = /app\.put\s*\(/.test(code);
      const hasPatch = /app\.patch\s*\(/.test(code);
      
      if (!hasPost && !hasPut && !hasPatch) return true;
      
      // Must have ZodError handling
      return /error\s+instanceof\s+z\.ZodError/.test(code) || 
             /instanceof\s+z\.ZodError/.test(code);
    },
    code: 'MISSING_ZOD_ERROR_HANDLING',
    message: 'POST/PUT/PATCH route without ZodError handling',
    fix: 'Add: if (error instanceof z.ZodError) { res.status(400).json(...) }',
  },
  {
    check: (code: string) => {
      const hasPost = /app\.post\s*\(/.test(code);
      const hasPut = /app\.put\s*\(/.test(code);
      const hasPatch = /app\.patch\s*\(/.test(code);
      
      if (!hasPost && !hasPut && !hasPatch) return true;
      
      // Must have try/catch around body parsing
      return /try\s*\{[\s\S]*?Schema\.parse\s*\(\s*req\.body\s*\)[\s\S]*?\}\s*catch/.test(code);
    },
    code: 'MISSING_TRY_CATCH',
    message: 'Schema.parse not wrapped in try/catch',
    fix: 'Wrap Schema.parse(req.body) in try { ... } catch (error) { ... }',
  },
];

/**
 * List endpoint detection - if there's a POST for a resource, there should be a GET list
 * EXCLUDES: auth actions (login, logout, register, signup, signin, signout, verify, validate, refresh, reset)
 */
const LIST_ENDPOINT_PATTERN = {
  check: (code: string) => {
    // Auth/action endpoints that should NOT have list endpoints
    const AUTH_ACTIONS = new Set([
      'login', 'logout', 'register', 'signup', 'signin', 'signout',
      'verify', 'validate', 'refresh', 'reset', 'forgot', 'confirm',
      'auth', 'authenticate', 'token', 'session', 'password'
    ]);

    // Find POST routes to resources
    const postMatches = code.match(/app\.post\s*\(\s*['"]\/([a-z]+)['"]/g);
    if (!postMatches) return true;

    for (const postMatch of postMatches) {
      const resourceMatch = postMatch.match(/['"]\/([a-z]+)['"]/);
      if (resourceMatch && resourceMatch[1]) {
        const resource = resourceMatch[1];
        // Skip auth action endpoints - they don't need list endpoints
        if (AUTH_ACTIONS.has(resource)) {
          continue;
        }
        // Check if GET /resource exists (list all)
        const listPattern = new RegExp(`app\\.get\\s*\\(\\s*['"]\\/${resource}['"]`);
        if (!listPattern.test(code)) {
          return false;
        }
      }
    }
    return true;
  },
  code: 'MISSING_LIST_ENDPOINT',
  message: 'POST endpoint exists but GET list endpoint missing (excludes auth actions)',
  fix: "Add GET /<resources> endpoint that returns Array.from(storage.values())",
};

/**
 * OpenAPI completeness check - validates that OpenAPI spec has requestBody for POST/PUT
 * This catches the issue where Swagger UI shows "No parameters" for POST endpoints
 */
const OPENAPI_COMPLETENESS_PATTERNS = [
  {
    check: (code: string) => {
      // Only check if the code has an openApiSpec definition
      if (!/const\s+openApiSpec\s*=/.test(code)) return true;

      // Auth/action endpoints that don't need requestBody
      const AUTH_ACTIONS = new Set([
        'login', 'logout', 'register', 'signup', 'signin', 'signout',
        'verify', 'validate', 'refresh', 'reset', 'forgot', 'confirm',
        'auth', 'authenticate', 'token', 'session', 'password'
      ]);

      // Find all POST routes defined in Express
      const postRouteMatches = code.match(/app\.post\s*\(\s*['"]\/([a-z]+)['"]/g);
      if (!postRouteMatches) return true;

      for (const postMatch of postRouteMatches) {
        const resourceMatch = postMatch.match(/['"]\/([a-z]+)['"]/);
        if (resourceMatch && resourceMatch[1]) {
          const resource = resourceMatch[1];
          // Skip auth action endpoints
          if (AUTH_ACTIONS.has(resource)) continue;

          // Check if this POST path in openApiSpec has requestBody
          // Look for pattern like: '/<resource>': { ... post: { ... requestBody: { ... } ... } ... }
          // We need to check if requestBody exists in the post object for this path
          const pathPattern = new RegExp(`['"]\\/${resource}['"]\\s*:\\s*\\{[^}]*post\\s*:\\s*\\{[^}]*requestBody\\s*:`);
          if (!pathPattern.test(code)) {
            // Maybe the openApiSpec has paths differently, do a simpler check
            // Check if requestBody appears after 'post:' and before the next closing brace
            const hasRequestBodyForResource = new RegExp(
              `paths[\\s\\S]*?['"]\\/${resource}['"][\\s\\S]*?post\\s*:\\s*\\{[\\s\\S]*?requestBody\\s*:`
            ).test(code);

            if (!hasRequestBodyForResource) {
              return false;
            }
          }
        }
      }
      return true;
    },
    code: 'OPENAPI_MISSING_POST_REQUESTBODY',
    message: 'POST endpoint defined but openApiSpec missing requestBody (Swagger shows "No parameters")',
    fix: "Add requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateX' } } } } to POST paths in openApiSpec",
  },
  {
    check: (code: string) => {
      // Only check if the code has an openApiSpec definition
      if (!/const\s+openApiSpec\s*=/.test(code)) return true;

      // Find all PUT routes defined in Express
      const putRouteMatches = code.match(/app\.put\s*\(\s*['"]\/([a-z]+)/g);
      if (!putRouteMatches) return true;

      for (const putMatch of putRouteMatches) {
        const resourceMatch = putMatch.match(/['"]\/([a-z]+)/);
        if (resourceMatch && resourceMatch[1]) {
          const resource = resourceMatch[1];

          // Check if this PUT path in openApiSpec has requestBody
          const hasRequestBodyForResource = new RegExp(
            `paths[\\s\\S]*?['"]\\/${resource}[\\s\\S]*?put\\s*:\\s*\\{[\\s\\S]*?requestBody\\s*:`
          ).test(code);

          if (!hasRequestBodyForResource) {
            return false;
          }
        }
      }
      return true;
    },
    code: 'OPENAPI_MISSING_PUT_REQUESTBODY',
    message: 'PUT endpoint defined but openApiSpec missing requestBody (Swagger shows "No parameters")',
    fix: "Add requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateX' } } } } to PUT paths in openApiSpec",
  },
  {
    check: (code: string) => {
      // Only check if the code has an openApiSpec definition
      if (!/const\s+openApiSpec\s*=/.test(code)) return true;

      // Auth/action endpoints that don't need Create/Update schemas
      const AUTH_ACTIONS = new Set([
        'login', 'logout', 'register', 'signup', 'signin', 'signout',
        'verify', 'validate', 'refresh', 'reset', 'forgot', 'confirm',
        'auth', 'authenticate', 'token', 'session', 'password'
      ]);

      // Find all POST routes to resources
      const postRouteMatches = code.match(/app\.post\s*\(\s*['"]\/([a-z]+)['"]/g);
      if (!postRouteMatches) return true;

      for (const postMatch of postRouteMatches) {
        const resourceMatch = postMatch.match(/['"]\/([a-z]+)['"]/);
        if (resourceMatch && resourceMatch[1]) {
          const resource = resourceMatch[1];
          // Skip auth action endpoints
          if (AUTH_ACTIONS.has(resource)) continue;

          // Capitalize resource name: users -> User, tasks -> Task
          const singularResource = resource.endsWith('s') ? resource.slice(0, -1) : resource;
          const capitalizedResource = singularResource.charAt(0).toUpperCase() + singularResource.slice(1);

          // Check if components.schemas has Create<Resource> schema
          const createSchemaPattern = new RegExp(`components[\\s\\S]*?schemas[\\s\\S]*?Create${capitalizedResource}\\s*:`);
          if (!createSchemaPattern.test(code)) {
            return false;
          }
        }
      }
      return true;
    },
    code: 'OPENAPI_MISSING_CREATE_SCHEMA',
    message: 'POST endpoint exists but openApiSpec.components.schemas missing CreateX schema',
    fix: "Add CreateX schema to openApiSpec.components.schemas with the input properties for creation",
  },
  {
    check: (code: string) => {
      // Only check if the code has an openApiSpec definition
      if (!/const\s+openApiSpec\s*=/.test(code)) return true;

      // Check if any endpoint in openApiSpec has a responses property
      // Look for patterns like: get: { summary: ..., responses: { ... } }
      // If we find endpoints WITHOUT responses, fail validation

      // Find all HTTP method definitions in openApiSpec
      const methodMatches = code.match(/(get|post|put|patch|delete)\s*:\s*\{[^}]*\}/g);
      if (!methodMatches) return true;

      // Check if ALL methods have a responses property
      for (const method of methodMatches) {
        // Skip if this method has responses
        if (/responses\s*:/.test(method)) continue;

        // If method doesn't have responses, fail validation
        // But only if it looks like an endpoint definition (has summary or parameters)
        if (/summary\s*:|parameters\s*:/.test(method)) {
          return false;
        }
      }
      return true;
    },
    code: 'OPENAPI_MISSING_RESPONSE_SCHEMA',
    message: 'OpenAPI endpoint missing responses property - Swagger UI will not display response data',
    fix: "Add responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } } } } to each endpoint",
  },
];

/**
 * Export patterns that must exist
 */
const REQUIRED_EXPORTS = [
  {
    regex: /export\s+\{\s*app\s*\}|export\s+const\s+app\s*=/,
    code: 'MISSING_APP_EXPORT',
    message: "'app' not exported",
    fix: "Add: export { app } or export const app = express()",
  },
  {
    // NOTE: Matches both "export function start" and "export async function start"
    regex: /export\s+(?:async\s+)?function\s+start\s*\(/,
    code: 'MISSING_START_EXPORT',
    message: "'start()' function not exported",
    fix: "Add: export function start(): void { app.listen(PORT, ...) }",
  },
];

// =============================================================================
// FAST VALIDATOR CLASS
// =============================================================================

export type StorageMode = 'memory' | 'sqlite' | 'postgres';

export interface FastValidatorOptions {
  /** Storage mode to determine which patterns to apply */
  storageMode?: StorageMode;
}

export class FastValidator {
  private options: FastValidatorOptions;

  constructor(options: FastValidatorOptions = {}) {
    this.options = options;
  }

  /**
   * Set the storage mode for subsequent validations
   */
  setStorageMode(storageMode: StorageMode): void {
    this.options.storageMode = storageMode;
  }

  /**
   * Validate code against all patterns
   * Returns in <100ms for typical code
   * @param code The code to validate
   * @param storageMode Optional storage mode override for this validation
   */
  validate(code: string, storageMode?: StorageMode): FastValidationResult {
    const startTime = performance.now();
    const errors: FastValidationError[] = [];
    const warnings: FastValidationWarning[] = [];
    const suggestedFixes = new Map<string, string>();

    // Determine which postgres patterns to skip based on storageMode
    // Use the passed storageMode if provided, otherwise fall back to instance option
    const effectiveStorageMode = storageMode ?? this.options.storageMode;
    const isPostgresMode = effectiveStorageMode === 'postgres';
    const skipPostgresPatterns = !isPostgresMode;

    // Check banned patterns (highest priority)
    for (const pattern of BANNED_PATTERNS) {
      // Skip postgres-specific patterns when not in postgres mode
      if (skipPostgresPatterns && pattern.code.startsWith('POSTGRES_')) {
        continue;
      }
      
      const matches = code.match(pattern.regex);
      if (matches) {
        for (const match of matches) {
          const lineInfo = this.findLineNumber(code, match);
          errors.push({
            code: pattern.code,
            message: pattern.message,
            line: lineInfo.line,
            column: lineInfo.column,
            pattern: match,
            fix: pattern.fix,
          });
          suggestedFixes.set(pattern.code, pattern.fix);
        }
      }
      // Reset regex state
      pattern.regex.lastIndex = 0;
    }

    // Check required patterns ONLY when they are actually needed
    // This prevents injecting imports into files that don't use the features
    const hasExpressRoutes = /app\.(get|post|put|patch|delete)\s*\(/.test(code);
    // Only check for z import if code uses z.* directly (z.object, z.string, z.ZodError, z.infer, etc.)
    // Do NOT trigger on Schema.parse() - the schema might be imported from another file that already imports z
    const usesZodSchema = /\bz\.\w+/.test(code);
    const usesRandomUUID = /randomUUID\s*\(/.test(code);
    
    for (const pattern of REQUIRED_PATTERNS) {
      let shouldCheck = false;
      
      // Only check for Express imports if the file has Express routes
      if (pattern.code === 'MISSING_REQUEST_TYPE_IMPORT' || pattern.code === 'MISSING_RESPONSE_TYPE_IMPORT') {
        shouldCheck = hasExpressRoutes;
      }
      // Only check for Zod import if the file uses Zod schemas
      else if (pattern.code === 'MISSING_ZOD_IMPORT') {
        shouldCheck = usesZodSchema;
      }
      // Only check for crypto import if the file uses randomUUID
      else if (pattern.code === 'MISSING_CRYPTO_IMPORT') {
        shouldCheck = usesRandomUUID;
      }
      // For other patterns, check unconditionally (original behavior)
      else {
        shouldCheck = true;
      }
      
      if (shouldCheck && !pattern.regex.test(code)) {
        errors.push({
          code: pattern.code,
          message: pattern.message,
          pattern: '',
          fix: pattern.fix,
        });
        suggestedFixes.set(pattern.code, pattern.fix);
      }
    }

    // Check for UNUSED Zod import (imported but not used)
    // This is the opposite of MISSING_ZOD_IMPORT - catches when z is imported but never used
    const hasZodImport = /import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/.test(code);
    // Check for ANY usage of z. - including z.object(), z.ZodError, z.infer, instanceof z.ZodError, etc.
    const usesZodZ = /\bz\.\w+/.test(code);
    if (hasZodImport && !usesZodZ) {
      // Find the line number of the import
      const importMatch = code.match(/import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/);
      const lineInfo = importMatch ? this.findLineNumber(code, importMatch[0]) : { line: 1, column: 1 };
      errors.push({
        code: 'UNUSED_ZOD_IMPORT',
        message: "'z' is imported from 'zod' but never used (no z.object(), z.ZodError, z.infer, etc.)",
        line: lineInfo.line,
        column: lineInfo.column,
        pattern: importMatch?.[0] ?? '',
        fix: "Remove: import { z } from 'zod'; - or use z.object(), z.string() etc. to define schemas",
      });
      suggestedFixes.set('UNUSED_ZOD_IMPORT', "Remove unused z import");
    }

    // Check for UNUSED Express types import (Request/Response imported but not used in type annotations)
    // This catches when Request/Response are imported but route handlers use (req, res) without types
    // NOTE: Uses flexible patterns to match Request/Response even when other types (like NextFunction) are imported
    // e.g., matches: import express, { Request, Response, NextFunction } from 'express'
    const hasExpressTypesImport =
      /import\s+express\s*,\s*\{[^}]*\bRequest\b[^}]*\bResponse\b[^}]*\}\s+from\s+['"]express['"]/.test(code) ||
      /import\s+express\s*,\s*\{[^}]*\bResponse\b[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(code) ||
      /import\s+\{[^}]*\bRequest\b[^}]*\bResponse\b[^}]*\}\s+from\s+['"]express['"]/.test(code) ||
      /import\s+\{[^}]*\bResponse\b[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(code);
    // Check if Request or Response are used in type annotations (: Request, : Response)
    const usesRequestType = /:\s*Request\b/.test(code);
    const usesResponseType = /:\s*Response\b/.test(code);

    if (hasExpressTypesImport && !usesRequestType && !usesResponseType) {
      // Use flexible pattern to match import (may include NextFunction and other types)
      const expressImportMatch = code.match(/import\s+express\s*,\s*\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/) ||
                                  code.match(/import\s+\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/);
      const lineInfo = expressImportMatch ? this.findLineNumber(code, expressImportMatch[0]) : { line: 1, column: 1 };
      errors.push({
        code: 'UNUSED_EXPRESS_TYPES_IMPORT',
        message: "'Request', 'Response', and/or 'NextFunction' are imported but not used in type annotations",
        line: lineInfo.line,
        column: lineInfo.column,
        pattern: expressImportMatch?.[0] ?? '',
        fix: "Remove unused types from import: import express from 'express'",
      });
      suggestedFixes.set('UNUSED_EXPRESS_TYPES_IMPORT', "Remove unused Request, Response, NextFunction from express import");
    }

    // Check required endpoints (only for files that have Express routes)
    if (hasExpressRoutes) {
      for (const pattern of REQUIRED_ENDPOINTS) {
        if (!pattern.regex.test(code)) {
          errors.push({
            code: pattern.code,
            message: pattern.message,
            pattern: '',
            fix: pattern.fix,
          });
          suggestedFixes.set(pattern.code, pattern.fix);
        }
      }
    }

    // Check route validation patterns (only for files with Express routes)
    if (hasExpressRoutes) {
      for (const pattern of ROUTE_VALIDATION_PATTERNS) {
        if (!pattern.check(code)) {
          errors.push({
            code: pattern.code,
            message: pattern.message,
            pattern: '',
            fix: pattern.fix,
          });
          suggestedFixes.set(pattern.code, pattern.fix);
        }
      }
    }

    // Check list endpoint pattern (only for files with Express routes)
    if (hasExpressRoutes && !LIST_ENDPOINT_PATTERN.check(code)) {
      errors.push({
        code: LIST_ENDPOINT_PATTERN.code,
        message: LIST_ENDPOINT_PATTERN.message,
        pattern: '',
        fix: LIST_ENDPOINT_PATTERN.fix,
      });
      suggestedFixes.set(LIST_ENDPOINT_PATTERN.code, LIST_ENDPOINT_PATTERN.fix);
    }

    // Check OpenAPI completeness patterns (only for files with Express routes AND openApiSpec)
    if (hasExpressRoutes) {
      for (const pattern of OPENAPI_COMPLETENESS_PATTERNS) {
        if (!pattern.check(code)) {
          errors.push({
            code: pattern.code,
            message: pattern.message,
            pattern: '',
            fix: pattern.fix,
          });
          suggestedFixes.set(pattern.code, pattern.fix);
        }
      }
      
      // V5: Check if OpenAPI spec is incomplete (has openApiSpec but missing some route handlers)
      const incompleteCheck = detectIncompleteOpenApiSpec(code);
      if (incompleteCheck.hasMissingPaths) {
        errors.push({
          code: 'INCOMPLETE_OPENAPI_SPEC',
          message: `OpenAPI spec is missing paths for: ${incompleteCheck.missingPaths.join(', ')}`,
          pattern: '',
          fix: 'Add missing paths to openApiSpec.paths object',
        });
        suggestedFixes.set('INCOMPLETE_OPENAPI_SPEC', `Add missing paths: ${incompleteCheck.missingPaths.join(', ')}`);
      }
    }

    // Check required exports (only for files that DEFINE the Express app, not just import types)
    // IMPORTANT: Only the file that creates `const/let/var app = express()` should have start() export
    // Regex handles: const app = express(), const app: Express = express(), let app = express(), etc.
    const definesExpressApp = /(?:const|let|var)\s+app\s*(?::\s*\w+)?\s*=\s*express\s*\(/.test(code);
    if (definesExpressApp) {
      for (const pattern of REQUIRED_EXPORTS) {
        if (!pattern.regex.test(code)) {
          errors.push({
            code: pattern.code,
            message: pattern.message,
            pattern: '',
            fix: pattern.fix,
          });
          suggestedFixes.set(pattern.code, pattern.fix);
        }
      }
    }

    // Check for potential issues (warnings)
    this.checkWarnings(code, warnings);

    const elapsed = performance.now() - startTime;
    logger.debug({ elapsed, errorCount: errors.length }, 'Fast validation complete');

    const fixableErrorCodes = this.getFixableErrorCodes(errors);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      fixable: this.areAllFixable(errors),
      hasFixableErrors: fixableErrorCodes.length > 0,
      fixableErrorCodes,
      suggestedFixes,
    };
  }

  /**
   * Validate multiple files and check for cross-file issues
   * @param files The files to validate
   * @param storageMode Optional storage mode override for this validation
   */
  validateMultiple(files: Array<{ path: string; content: string }>, storageMode?: StorageMode): FastValidationResult {
    const allErrors: FastValidationError[] = [];
    const allWarnings: FastValidationWarning[] = [];
    const suggestedFixes = new Map<string, string>();

    // Validate each file
    for (const file of files) {
      // Skip non-TypeScript files
      if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) {
        continue;
      }

      const result = this.validate(file.content, storageMode);
      
      // Add file path to error messages
      for (const error of result.errors) {
        allErrors.push({
          ...error,
          message: `${file.path}: ${error.message}`,
        });
      }
      
      for (const warning of result.warnings) {
        allWarnings.push({
          ...warning,
          message: `${file.path}: ${warning.message}`,
        });
      }
      
      for (const [code, fix] of result.suggestedFixes) {
        suggestedFixes.set(code, fix);
      }
    }

    // Check for cross-file issues (duplicate exports)
    this.checkDuplicateExports(files, allErrors, suggestedFixes);

    const fixableErrorCodes = this.getFixableErrorCodes(allErrors);
    
    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      fixable: this.areAllFixable(allErrors),
      hasFixableErrors: fixableErrorCodes.length > 0,
      fixableErrorCodes,
      suggestedFixes,
    };
  }

  /**
   * Find line number for a match in code
   */
  private findLineNumber(code: string, match: string): { line: number; column: number } {
    const index = code.indexOf(match);
    if (index === -1) return { line: 0, column: 0 };

    const lines = code.substring(0, index).split('\n');
    return {
      line: lines.length,
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    };
  }

  /**
   * Check for warnings (non-blocking issues)
   */
  private checkWarnings(code: string, warnings: FastValidationWarning[]): void {
    // Check for unused imports
    if (/import.*\{[^}]*\}.*from/.test(code)) {
      const importMatch = code.match(/import\s+\{([^}]+)\}\s+from/g);
      if (importMatch) {
        // This is a simplified check - could be more sophisticated
        // For now, just a warning about potential unused imports
      }
    }

    // Check for any type usage
    if (/:\s*any\b/.test(code) || /<any>/.test(code)) {
      warnings.push({
        code: 'ANY_TYPE_USAGE',
        message: 'Using "any" type reduces type safety',
        suggestion: 'Replace with specific types or "unknown"',
      });
    }

    // Check for console.log in production code
    if (/console\.(log|debug|info)\(/.test(code)) {
      warnings.push({
        code: 'CONSOLE_LOG_USAGE',
        message: 'Using console.log in production code',
        suggestion: 'Consider using a proper logger like pino',
      });
    }
  }

  /**
   * Check for duplicate exports across files
   */
  private checkDuplicateExports(
    files: Array<{ path: string; content: string }>,
    errors: FastValidationError[],
    suggestedFixes: Map<string, string>
  ): void {
    const exportsByName = new Map<string, string[]>();

    for (const file of files) {
      // Find all exports
      const exportMatches = file.content.match(/export\s+(?:function|const|class|interface|type)\s+(\w+)/g);
      
      if (exportMatches) {
        for (const exportMatch of exportMatches) {
          const nameMatch = exportMatch.match(/(?:function|const|class|interface|type)\s+(\w+)/);
          if (nameMatch) {
            const name = nameMatch[1]!;
            const existing = exportsByName.get(name) || [];
            existing.push(file.path);
            exportsByName.set(name, existing);
          }
        }
      }
    }

    // Find duplicates
    for (const [name, paths] of exportsByName) {
      if (paths.length > 1) {
        errors.push({
          code: 'DUPLICATE_EXPORT_NAME',
          message: `Export "${name}" defined in multiple files: ${paths.join(', ')}`,
          pattern: name,
          fix: `Prefix with resource name: ${name} → create${name.charAt(0).toUpperCase() + name.slice(1)}`,
        });
        suggestedFixes.set('DUPLICATE_EXPORT_NAME', 'Use unique, prefixed names for exports');
      }
    }
  }

  /**
   * The set of error codes that can be auto-fixed
   */
  private static readonly FIXABLE_CODES = new Set([
    // Original 5 fixable patterns
    'UUID_PACKAGE_IMPORT',
    'EXPRESS_NAMESPACE_REQUEST',
    'EXPRESS_NAMESPACE_RESPONSE',
    'REQ_PARAMS_WITHOUT_TYPE_ASSERTION',
    'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST',
    // req.query type handling (V5 - fixes TS2345 errors)
    'REQ_QUERY_DIRECT_PARSE',
    'REQ_QUERY_WITHOUT_STRING_WRAPPER',
    'REQ_QUERY_ASSIGNMENT_WITHOUT_STRING',
    // PostgreSQL timestamp safety (V6 - prevents runtime crashes)
    'POSTGRES_TIMESTAMP_NULL_CHECK',
    // New 8 fixable patterns (V2 pipeline expansion)
    // NOTE: MISSING_LIST_ENDPOINT removed - too risky for auto-fix
    'MISSING_REQUEST_TYPE_IMPORT',
    'MISSING_RESPONSE_TYPE_IMPORT',
    'MISSING_ZOD_IMPORT',
    'MISSING_CRYPTO_IMPORT',
    'MISSING_HEALTH_ENDPOINT',
    'MISSING_APP_EXPORT',
    'MISSING_START_EXPORT',
    'UNUSED_ZOD_IMPORT',  // Remove unused z import
    'UNUSED_EXPRESS_TYPES_IMPORT',  // Remove unused Request/Response imports
    // Documentation endpoint patterns (V3 - API documentation enhancement)
    'MISSING_ROOT_ENDPOINT',
    'MISSING_DOCS_ENDPOINT',
    'MISSING_OPENAPI_ENDPOINT',
    'INCOMPLETE_OPENAPI_SPEC',  // V5 - OpenAPI spec missing some route handlers
    // OpenAPI response schema (V4 - Swagger UI response display fix)
    'OPENAPI_MISSING_RESPONSE_SCHEMA',
  ]);

  /**
   * Get the list of fixable error codes from the given errors
   */
  private getFixableErrorCodes(errors: FastValidationError[]): string[] {
    return errors
      .filter(e => FastValidator.FIXABLE_CODES.has(e.code))
      .map(e => e.code);
  }

  /**
   * Check if all errors are auto-fixable
   * @deprecated Use getFixableErrorCodes().length > 0 to check if any errors are fixable
   */
  private areAllFixable(errors: FastValidationError[]): boolean {
    return errors.every(e => FastValidator.FIXABLE_CODES.has(e.code));
  }

  /**
   * Get correct patterns for specific error codes
   */
  getCorrectPatterns(errorCodes: string[]): string {
    const patterns: string[] = [];

    for (const code of errorCodes) {
      switch (code) {
        case 'REQ_BODY_AS_CAST':
        case 'REQ_BODY_ANGLE_CAST':
        case 'DESTRUCTURE_UNVALIDATED_BODY':
          patterns.push(`
CORRECT PATTERN for request body validation:
\`\`\`typescript
app.post('/resource', (req: Request, res: Response) => {
  try {
    const input = CreateResourceSchema.parse(req.body);
    // Use input safely - it's now validated and typed
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
\`\`\`
`);
          break;

        case 'UUID_PACKAGE_IMPORT':
          patterns.push(`
CORRECT PATTERN for UUID generation:
\`\`\`typescript
import { randomUUID } from 'crypto';  // Built-in, no npm package needed
const id = randomUUID();
\`\`\`
`);
          break;

        case 'EXPRESS_NAMESPACE_REQUEST':
        case 'EXPRESS_NAMESPACE_RESPONSE':
        case 'MISSING_REQUEST_TYPE_IMPORT':
        case 'MISSING_RESPONSE_TYPE_IMPORT':
          patterns.push(`
CORRECT PATTERN for Express type imports:
\`\`\`typescript
import express, { Request, Response } from 'express';
app.get('/path', (req: Request, res: Response) => { ... });
\`\`\`
`);
          break;

        case 'MISSING_SCHEMA_PARSE':
        case 'MISSING_ZOD_ERROR_HANDLING':
        case 'MISSING_TRY_CATCH':
          patterns.push(`
CORRECT PATTERN for Zod validation:
\`\`\`typescript
try {
  const input = CreateResourceSchema.parse(req.body);
  // ... use input
} catch (error) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation failed', details: error.errors });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}
\`\`\`
`);
          break;

        case 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION':
        case 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST':
          patterns.push(`
CORRECT PATTERN for Express route params:
Express route params are typed as \`string | string[]\`. Always cast to string:
\`\`\`typescript
// Option 1: Cast when using in function call
const item = storage.get(req.params.id as string);

// Option 2: Cast when assigning to variable
const id = req.params.id as string;
const item = storage.get(id);

// Option 3: Use String() for explicit conversion
const id = String(req.params.id);
\`\`\`
`);
          break;

        case 'REQ_QUERY_DIRECT_PARSE':
        case 'REQ_QUERY_WITHOUT_STRING_WRAPPER':
        case 'REQ_QUERY_ASSIGNMENT_WITHOUT_STRING':
          patterns.push(`
CORRECT PATTERN for Express query params:
Express query params have type \`string | string[] | ParsedQs | undefined\`.
ALWAYS wrap with String() before use:

\`\`\`typescript
// For pagination with parseInt:
❌ WRONG: const page = parseInt(req.query.page, 10);  // TS2345 error!
✅ CORRECT: const page = parseInt(String(req.query.page || '1'), 10);

// For assignment:
❌ WRONG: const sort = req.query.sortBy;  // type is string | string[] | undefined
✅ CORRECT: const sort = String(req.query.sortBy || 'createdAt');

// For function arguments:
❌ WRONG: filter(req.query.status);
✅ CORRECT: filter(String(req.query.status || 'all'));

// For Number conversion:
❌ WRONG: const limit = Number(req.query.limit);
✅ CORRECT: const limit = Number(String(req.query.limit || '10'));
\`\`\`
`);
          break;

        case 'OPENAPI_MISSING_POST_REQUESTBODY':
        case 'OPENAPI_MISSING_PUT_REQUESTBODY':
        case 'OPENAPI_MISSING_CREATE_SCHEMA':
          patterns.push(`
CORRECT PATTERN for OpenAPI spec with requestBody:
Every POST and PUT path in openApiSpec MUST have requestBody with schema $ref:

\`\`\`typescript
const openApiSpec = {
  openapi: '3.0.0',
  info: { title: 'API', version: '1.0.0', description: 'API description' },
  paths: {
    '/users': {
      get: { summary: 'List users', ... },
      post: {
        summary: 'Create user',
        operationId: 'createUser',
        requestBody: {  // <-- REQUIRED for POST
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUser' }
            }
          }
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' } }
      }
    },
    '/users/{id}': {
      get: {
        summary: 'Get user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        ...
      },
      put: {
        summary: 'Update user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {  // <-- REQUIRED for PUT
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateUser' }
            }
          }
        },
        responses: { '200': { description: 'Updated' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' } }
      }
    }
  },
  components: {
    schemas: {
      User: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, ... }, required: ['id', ...] },
      CreateUser: { type: 'object', properties: { email: { type: 'string', format: 'email' }, ... }, required: ['email', ...] },  // <-- REQUIRED schema
      UpdateUser: { type: 'object', properties: { email: { type: 'string', format: 'email' }, ... } }  // <-- REQUIRED schema
    }
  }
};
\`\`\`
`);
          break;
      }
    }

    return patterns.join('\n');
  }
}

// =============================================================================
// AUTO-FIXER (for fixable patterns)
// =============================================================================

export class AutoFixer {
  /**
   * Check if the code has balanced brackets/braces/parentheses
   * This helps detect if code has syntax issues that would be worsened by injection
   * Now string-aware: skips brackets inside strings and comments
   */
  private hasBalancedSyntax(code: string): boolean {
    let braceCount = 0;
    let bracketCount = 0;
    let parenCount = 0;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let inTemplateExpr = 0; // Track template expression depth

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      const nextChar = code[i + 1] || '';
      const prevChar = i > 0 ? code[i - 1] : '';

      // Handle escape sequences (skip escaped characters in strings)
      if (inString && prevChar === '\\' && code[i - 2] !== '\\') {
        continue;
      }

      // Handle line comments
      if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (inLineComment && char === '\n') {
        inLineComment = false;
        continue;
      }

      // Handle block comments
      if (!inString && !inLineComment && char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
        continue;
      }

      // Skip if in comment
      if (inLineComment || inBlockComment) {
        continue;
      }

      // Handle template literal expressions ${...}
      if (inString && stringChar === '`' && char === '$' && nextChar === '{') {
        inTemplateExpr++;
        i++;
        continue;
      }

      // Handle string boundaries
      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
        continue;
      }
      if (inString && char === stringChar && inTemplateExpr === 0) {
        inString = false;
        stringChar = '';
        continue;
      }

      // Handle closing brace in template expression
      if (inString && stringChar === '`' && inTemplateExpr > 0 && char === '}') {
        inTemplateExpr--;
        continue;
      }

      // Skip if in string (but not in template expression)
      if (inString && inTemplateExpr === 0) {
        continue;
      }

      // Count brackets (only outside strings/comments, or inside template expressions)
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
      else if (char === '(') parenCount++;
      else if (char === ')') parenCount--;

      // Early exit if counts go negative (more closing than opening)
      if (braceCount < 0 || bracketCount < 0 || parenCount < 0) {
        return false;
      }
    }

    // Also check we're not still inside a string (unterminated)
    const isBalanced = braceCount === 0 && bracketCount === 0 && parenCount === 0;
    const isNotInString = !inString;

    return isBalanced && isNotInString;
  }

  /**
   * Check if NextFunction is actually used in the code (as a parameter type)
   * Returns false if NextFunction is imported but never used
   */
  private isNextFunctionUsed(code: string): boolean {
    // Check if NextFunction is used as a type annotation: (next: NextFunction)
    // or as a type: NextFunction somewhere in the code (excluding import)
    const importMatch = code.match(/import\s*\{[^}]*\bNextFunction\b[^}]*\}\s*from\s*['"]express['"]/);
    if (!importMatch) return true; // Not imported, so not unused
    
    // Remove the import line to check usage in rest of code
    const codeWithoutImport = code.replace(importMatch[0], '');
    
    // Check if NextFunction is used anywhere else
    return /\bNextFunction\b/.test(codeWithoutImport);
  }

  /**
   * Remove NextFunction from express import statement if unused
   */
  private removeUnusedNextFunction(code: string): string {
    if (this.isNextFunctionUsed(code)) {
      return code; // It's used, don't remove
    }

    // Remove NextFunction from import, handling various positions:
    // { Request, Response, NextFunction } -> { Request, Response }
    // { NextFunction, Request, Response } -> { Request, Response }
    // { Request, NextFunction, Response } -> { Request, Response }
    let fixed = code;
    
    // Case: NextFunction is last or middle
    fixed = fixed.replace(
      /(import\s*\{[^}]*),\s*NextFunction(\s*\})/g,
      '$1$2'
    );
    // Case: NextFunction is first
    fixed = fixed.replace(
      /(import\s*\{\s*)NextFunction\s*,([^}]*\})/g,
      '$1$2'
    );
    // Case: NextFunction is the only one (shouldn't happen but handle it)
    fixed = fixed.replace(
      /import\s*\{\s*NextFunction\s*\}\s*from\s*['"]express['"];?\n?/g,
      ''
    );
    
    return fixed;
  }

  /**
   * Remove unused schema declarations (e.g., UserSchema when only CreateUserSchema is used)
   * This only removes if the schema is truly unused and safe to remove
   */
  private removeUnusedSchemas(code: string): string {
    // Find all schema declarations: const XyzSchema = z.object(...)
    const schemaPattern = /const\s+(\w+Schema)\s*=\s*z\.object\s*\(/g;
    const schemas: string[] = [];
    let match;
    while ((match = schemaPattern.exec(code)) !== null) {
      if (match[1]) {
        schemas.push(match[1]);
      }
    }

    let fixed = code;
    for (const schemaName of schemas) {
      // Check if schema is used elsewhere (not in its own declaration)
      const usagePattern = new RegExp(`\\b${schemaName}\\b`, 'g');
      
      // Count total matches
      const allMatches = code.match(usagePattern) || [];
      
      // If only 1 match (the declaration), it's unused
      if (allMatches.length === 1) {
        // Check if there's a corresponding type: type Xyz = z.infer<typeof XyzSchema>
        const typeInferPattern = new RegExp(`type\\s+\\w+\\s*=\\s*z\\.infer<typeof\\s+${schemaName}>`);
        
        // Only remove if there's no type derivation from it
        if (!typeInferPattern.test(code)) {
          // Remove the entire const declaration
          const removePattern = new RegExp(
            `\\n?const\\s+${schemaName}\\s*=\\s*z\\.object\\s*\\([^)]*\\)[^;]*;`,
            'g'
          );
          fixed = fixed.replace(removePattern, '');
          logger.info({ schemaName }, 'Auto-removed unused schema declaration');
        }
      }
    }
    
    return fixed;
  }

  /**
   * Attempt to auto-fix simple pattern violations
   */
  fix(code: string, errors: FastValidationError[]): string {
    // CRITICAL: If the code already has syntax issues, don't make it worse
    if (!this.hasBalancedSyntax(code)) {
      logger.warn('Code has unbalanced syntax - skipping auto-fix to avoid corruption');
      return code;
    }

    let fixedCode = code;
    
    // FIRST: Always try to remove unused NextFunction (common issue)
    fixedCode = this.removeUnusedNextFunction(fixedCode);
    
    // SECOND: Try to remove unused schema declarations
    fixedCode = this.removeUnusedSchemas(fixedCode);

    for (const error of errors) {
      switch (error.code) {
        case 'UUID_PACKAGE_IMPORT':
          fixedCode = fixedCode
            .replace(/import\s+\{\s*v4\s+as\s+uuidv4\s*\}\s+from\s+['"]uuid['"];?/g, 
                     "import { randomUUID } from 'crypto';")
            .replace(/uuidv4\(\)/g, 'randomUUID()');
          break;

        case 'EXPRESS_NAMESPACE_REQUEST':
          // Add import if not present
          if (!fixedCode.includes('{ Request')) {
            fixedCode = fixedCode.replace(
              /import\s+express\s+from\s+['"]express['"];?/,
              "import express, { Request, Response } from 'express';"
            );
          }
          fixedCode = fixedCode.replace(/express\.Request/g, 'Request');
          break;

        case 'EXPRESS_NAMESPACE_RESPONSE':
          if (!fixedCode.includes('{ Response')) {
            fixedCode = fixedCode.replace(
              /import\s+express\s+from\s+['"]express['"];?/,
              "import express, { Request, Response } from 'express';"
            );
          }
          fixedCode = fixedCode.replace(/express\.Response/g, 'Response');
          break;

        case 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION':
          // Fix: findById(req.params.id) -> findById(req.params.id as string)
          // Note: \b word boundary prevents backtracking from matching partial param names
          fixedCode = fixedCode.replace(
            /\(\s*(req\.params\.\w+\b)\s*\)(?!\s*as\s+string)/g,
            '($1 as string)'
          );
          break;

        // =========================================================================
        // UNUSED IMPORT FIXES (auto-remove to prevent ESLint errors)
        // =========================================================================

        case 'UNUSED_NEXTFUNCTION_IMPORT':
          // Remove NextFunction from import statement
          // Handles: import { Request, Response, NextFunction } from 'express'
          // Result:  import { Request, Response } from 'express'
          fixedCode = fixedCode.replace(
            /import\s*\{([^}]*),\s*NextFunction\s*\}/g,
            'import {$1}'
          );
          fixedCode = fixedCode.replace(
            /import\s*\{\s*NextFunction\s*,([^}]*)\}/g,
            'import {$1}'
          );
          // Clean up any double commas or leading/trailing commas
          fixedCode = fixedCode.replace(/\{\s*,/g, '{');
          fixedCode = fixedCode.replace(/,\s*\}/g, '}');
          fixedCode = fixedCode.replace(/,\s*,/g, ',');
          break;

        case 'UNUSED_SCHEMA_IMPORT':
          // For unused schema declarations, we can't auto-remove without risking breaking
          // Instead, add @ts-expect-error comment if schema is declared but unused
          // This is handled by Gemini since schema usage patterns are complex
          break;

        case 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST':
          // Fix: const id = req.params.id -> const id = req.params.id as string
          // Note: \b word boundary prevents backtracking from matching partial param names
          fixedCode = fixedCode.replace(
            /const\s+(\w+)\s*=\s*(req\.params\.\w+\b)(?!\s*as\s+string)/g,
            'const $1 = $2 as string'
          );
          break;

        // =========================================================================
        // V5 REQ.QUERY TYPE FIXES (prevent TS2345 errors in Docker builds)
        // =========================================================================

        case 'REQ_QUERY_DIRECT_PARSE':
          // Fix: parseInt(req.query.page, 10) -> parseInt(String(req.query.page || '1'), 10)
          // Fix: Number(req.query.limit) -> Number(String(req.query.limit || '0'))
          fixedCode = fixedCode.replace(
            /parseInt\s*\(\s*req\.query\.(\w+)\s*,\s*(\d+)\s*\)/g,
            "parseInt(String(req.query.$1 || '0'), $2)"
          );
          fixedCode = fixedCode.replace(
            /Number\s*\(\s*req\.query\.(\w+)\s*\)/g,
            "Number(String(req.query.$1 || '0'))"
          );
          break;

        case 'REQ_QUERY_WITHOUT_STRING_WRAPPER':
          // Fix: someFunc(req.query.param) -> someFunc(String(req.query.param || ''))
          // This is tricky because we need to be careful not to double-wrap
          fixedCode = fixedCode.replace(
            /(?<!String\s*)\(\s*req\.query\.(\w+)\s*\)(?!\s*(?:as|\.toString))/g,
            "(String(req.query.$1 || ''))"
          );
          break;

        case 'REQ_QUERY_ASSIGNMENT_WITHOUT_STRING':
          // Fix: const page = req.query.page -> const page = String(req.query.page || '')
          fixedCode = fixedCode.replace(
            /const\s+(\w+)\s*=\s*req\.query\.(\w+)\b(?!\s*(?:as\s+string|\?\?|\.toString|\|\|))/g,
            "const $1 = String(req.query.$2 || '')"
          );
          break;

        // =========================================================================
        // V6 POSTGRESQL TIMESTAMP SAFETY (prevent runtime crashes)
        // =========================================================================

        case 'POSTGRES_TIMESTAMP_NULL_CHECK':
          // Fix: b.createdAt.toISOString() -> b.createdAt?.toISOString() ?? new Date().toISOString()
          // Fix: b.updatedAt.toISOString() -> b.updatedAt?.toISOString() ?? new Date().toISOString()
          // This prevents "TypeError: Cannot read properties of undefined (reading 'toISOString')"
          // when PostgreSQL returns undefined for nullable timestamp columns
          fixedCode = fixedCode.replace(
            /(\w+)\.(createdAt)\.toISOString\(\)/g,
            "$1.createdAt?.toISOString() ?? new Date().toISOString()"
          );
          fixedCode = fixedCode.replace(
            /(\w+)\.(updatedAt)\.toISOString\(\)/g,
            "$1.updatedAt?.toISOString() ?? new Date().toISOString()"
          );
          break;

        // =========================================================================
        // NEW V2 PIPELINE FIXES (expand auto-fix coverage from 25% to 65%)
        // =========================================================================

        case 'MISSING_REQUEST_TYPE_IMPORT':
        case 'MISSING_RESPONSE_TYPE_IMPORT':
          // Only add Express imports to files that have Express routes
          if (/app\.(get|post|put|patch|delete)\s*\(/.test(fixedCode)) {
            if (!fixedCode.includes("from 'express'")) {
              fixedCode = "import express, { Request, Response } from 'express';\n" + fixedCode;
            } else if (!fixedCode.includes('{ Request') && !fixedCode.includes('{Request')) {
              // Has import but missing types - upgrade to full import
              fixedCode = fixedCode.replace(
                /import\s+express\s+from\s+['"]express['"];?/,
                "import express, { Request, Response } from 'express';"
              );
            }
          }
          break;

        case 'MISSING_ZOD_IMPORT':
          // Only add Zod import to files that use z.* directly (z.object, z.string, z.ZodError, etc.)
          // Do NOT trigger on Schema.parse() - the schema might be imported from another file
          if (/\bz\.\w+/.test(fixedCode)) {
            if (!fixedCode.includes("from 'zod'")) {
              // Insert after last import statement or at top
              const lastZodImportMatch = fixedCode.match(/^(import\s+[^;]+;)/gm);
              const lastZodImport = lastZodImportMatch?.[lastZodImportMatch.length - 1];
              if (lastZodImport) {
                const lastImportIdx = fixedCode.lastIndexOf(lastZodImport);
                const insertPos = lastImportIdx + lastZodImport.length;
                fixedCode = fixedCode.slice(0, insertPos) + "\nimport { z } from 'zod';" + fixedCode.slice(insertPos);
              } else {
                fixedCode = "import { z } from 'zod';\n" + fixedCode;
              }
            }
          }
          break;

        case 'MISSING_CRYPTO_IMPORT':
          // Only add crypto import to files that use randomUUID
          if (/randomUUID\s*\(/.test(fixedCode)) {
            if (!fixedCode.includes("from 'crypto'")) {
              const lastCryptoImportMatch = fixedCode.match(/^(import\s+[^;]+;)/gm);
              const lastCryptoImport = lastCryptoImportMatch?.[lastCryptoImportMatch.length - 1];
              if (lastCryptoImport) {
                const lastImportIdx = fixedCode.lastIndexOf(lastCryptoImport);
                const insertPos = lastImportIdx + lastCryptoImport.length;
                fixedCode = fixedCode.slice(0, insertPos) + "\nimport { randomUUID } from 'crypto';" + fixedCode.slice(insertPos);
              } else {
                fixedCode = "import { randomUUID } from 'crypto';\n" + fixedCode;
              }
            }
          }
          break;

        case 'MISSING_HEALTH_ENDPOINT':
          if (!fixedCode.includes("'/health'") && !fixedCode.includes('"/health"')) {
            const healthEndpoint = `
// Health check endpoint (auto-injected by FastValidator)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});
`;
            // Insert after app.use(express.json()) or before first route
            const jsonMiddlewareMatch = fixedCode.match(/app\.use\(express\.json\(\)\);?/);
            if (jsonMiddlewareMatch && jsonMiddlewareMatch.index !== undefined) {
              const insertPos = jsonMiddlewareMatch.index + jsonMiddlewareMatch[0].length;
              fixedCode = fixedCode.slice(0, insertPos) + healthEndpoint + fixedCode.slice(insertPos);
            } else {
              // Find first route and insert before it
              const firstRouteMatch = fixedCode.match(/app\.(get|post|put|patch|delete)\s*\(/);
              if (firstRouteMatch && firstRouteMatch.index !== undefined) {
                fixedCode = fixedCode.slice(0, firstRouteMatch.index) + healthEndpoint + '\n' + fixedCode.slice(firstRouteMatch.index);
              }
            }
          }
          break;

        case 'MISSING_APP_EXPORT':
          // IMPORTANT: Only add app export if this file DEFINES the Express app
          // Regex handles: const app = express(), const app: Express = express(), let app = express(), etc.
          if (!fixedCode.includes('export { app }') && 
              !fixedCode.includes('export const app') && 
              !fixedCode.includes('export {app}') &&
              /(?:const|let|var)\s+app\s*(?::\s*\w+)?\s*=\s*express\s*\(/.test(fixedCode)) {
            // Add before start function or at end
            const startFuncMatch = fixedCode.match(/export\s+function\s+start/);
            if (startFuncMatch && startFuncMatch.index !== undefined) {
              fixedCode = fixedCode.slice(0, startFuncMatch.index) + 'export { app };\n\n' + fixedCode.slice(startFuncMatch.index);
            } else {
              // Add at end of file
              fixedCode = fixedCode.trimEnd() + '\n\nexport { app };\n';
            }
          }
          break;

        case 'MISSING_START_EXPORT': {
          // IMPORTANT: Only inject start() if this file DEFINES the Express app
          // Regex handles: const app = express(), const app: Express = express(), let app = express(), etc.
          // Otherwise, we'd create a reference to undefined `app`

          // Use robust regex patterns to detect existing start export (various formats)
          const hasStartFunction = /export\s+(async\s+)?function\s+start\s*\(/.test(fixedCode);
          const hasStartArrow = /export\s+const\s+start\s*=\s*(async\s*)?\(/.test(fixedCode);
          const hasStartVariable = /export\s+const\s+start\s*=\s*(async\s+)?(function|\(|[^;]+=>)/.test(fixedCode);

          if (!hasStartFunction && !hasStartArrow && !hasStartVariable &&
              /(?:const|let|var)\s+app\s*(?::\s*\w+)?\s*=\s*express\s*\(/.test(fixedCode)) {
            const startFunction = `
// Start function (auto-injected by FastValidator)
export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(\`Server listening on port \${PORT}\`));
}
`;
            fixedCode = fixedCode.trimEnd() + '\n' + startFunction;
          }
          break;
        }

        case 'MISSING_LIST_ENDPOINT': {
          // SKIP auto-fix for list endpoints - this is too risky to auto-inject
          // The logic of determining what resources need list endpoints vs auth actions
          // (like /login, /logout) is complex and error-prone.
          // Let Gemini handle this with proper context understanding.
          logger.debug('Skipping MISSING_LIST_ENDPOINT auto-fix - deferring to Gemini');
          break;
        }

        case 'UNUSED_ZOD_IMPORT':
          // Remove unused z import from 'zod' - this causes ESLint no-unused-vars errors
          // The code imports z but doesn't use z.object(), z.ZodError, z.infer, instanceof z.ZodError, etc.
          // IMPORTANT: Use /\bz\.\w+/ (not /\bz\.\w+\(/) to catch z.ZodError, z.infer which don't have parentheses
          if (/import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/.test(fixedCode) &&
              !/\bz\.\w+/.test(fixedCode)) {
            // Remove the entire import line (handles both single and double quotes, with/without semicolon)
            fixedCode = fixedCode.replace(/^import\s+\{\s*z\s*\}\s+from\s+['"]zod['"];?\s*\n?/gm, '');
            logger.debug('Removed unused z import from zod');
          }
          break;

        // =========================================================================
        // V3 DOCUMENTATION ENDPOINT FIXES
        // =========================================================================

        case 'MISSING_ROOT_ENDPOINT':
          if (!fixedCode.includes("app.get('/'") && !fixedCode.includes('app.get("/')) {
            // Try to extract app name from existing code patterns
            const appNameMatch = fixedCode.match(/name:\s*['"]([^'"]+)['"]/);
            const appName = appNameMatch?.[1] ?? 'API';

            const rootEndpoint = `
// Root endpoint - API metadata (auto-injected by FastValidator)
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: '${appName}',
    version: '1.0.0',
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});
`;
            // Insert before /health endpoint or before first route
            const healthMatch = fixedCode.match(/app\.get\s*\(\s*['"]\/health['"]/);
            if (healthMatch && healthMatch.index !== undefined) {
              fixedCode = fixedCode.slice(0, healthMatch.index) + rootEndpoint + '\n' + fixedCode.slice(healthMatch.index);
            } else {
              const firstRouteMatch = fixedCode.match(/app\.(get|post|put|patch|delete)\s*\(/);
              if (firstRouteMatch && firstRouteMatch.index !== undefined) {
                fixedCode = fixedCode.slice(0, firstRouteMatch.index) + rootEndpoint + '\n' + fixedCode.slice(firstRouteMatch.index);
              }
            }
            logger.debug('Injected root endpoint');
          }
          break;

        case 'MISSING_DOCS_ENDPOINT':
          // IMPORTANT: Check for actual route definition, not just string presence
          // The string '/docs' may exist as a JSON value (e.g., { docs: '/docs' }) without the route being defined
          if (!/app\.get\s*\(\s*['"]\/docs['"]/.test(fixedCode)) {
            // Extract app name for Swagger UI title
            const docsAppNameMatch = fixedCode.match(/name:\s*['"]([^'"]+)['"]/);
            const docsAppName = docsAppNameMatch?.[1] ?? 'API';

            // Add swaggerHtml constant if not present
            if (!fixedCode.includes('swaggerHtml')) {
              const swaggerHtmlConst = `
// Swagger UI HTML (auto-injected by FastValidator)
const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docsAppName} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis]
      });
    };
  </script>
</body>
</html>\`;
`;
              // Insert before routes
              const jsonMiddleware = fixedCode.match(/app\.use\(express\.json\(\)\);?/);
              if (jsonMiddleware && jsonMiddleware.index !== undefined) {
                const insertPos = jsonMiddleware.index + jsonMiddleware[0].length;
                fixedCode = fixedCode.slice(0, insertPos) + '\n' + swaggerHtmlConst + fixedCode.slice(insertPos);
              }
            }

            const docsEndpoint = `
// Swagger UI documentation endpoint (auto-injected by FastValidator)
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});
`;
            // Insert after /openapi.json endpoint or before /health
            const openapiMatch = fixedCode.match(/app\.get\s*\(\s*['"]\/openapi\.json['"]/);
            const healthEndpointMatch = fixedCode.match(/app\.get\s*\(\s*['"]\/health['"]/);

            if (openapiMatch && openapiMatch.index !== undefined) {
              // Find end of openapi handler
              const routeEndMatch = fixedCode.slice(openapiMatch.index).match(/\}\);/);
              if (routeEndMatch && routeEndMatch.index !== undefined) {
                const insertPos = openapiMatch.index + routeEndMatch.index + routeEndMatch[0].length;
                fixedCode = fixedCode.slice(0, insertPos) + docsEndpoint + fixedCode.slice(insertPos);
              }
            } else if (healthEndpointMatch && healthEndpointMatch.index !== undefined) {
              fixedCode = fixedCode.slice(0, healthEndpointMatch.index) + docsEndpoint + '\n' + fixedCode.slice(healthEndpointMatch.index);
            }
            logger.debug('Injected /docs endpoint');
          }
          break;

        case 'MISSING_OPENAPI_ENDPOINT':
          // IMPORTANT: Check for actual route definition, not just string presence
          // The string '/openapi.json' may exist as a JSON value (e.g., { openapi: '/openapi.json' }) without the route being defined
          if (!/app\.get\s*\(\s*['"]\/openapi\.json['"]/.test(fixedCode)) {
            // Add openApiSpec constant if not present - EXTRACT PATHS FROM ACTUAL ROUTES
            if (!fixedCode.includes('openApiSpec')) {
              // Extract all route handlers to generate proper OpenAPI paths
              const routePattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
              const paths: Record<string, Record<string, { summary: string; responses: Record<string, { description: string }> }>> = {};
              let routeMatch: RegExpExecArray | null;
              
              while ((routeMatch = routePattern.exec(fixedCode)) !== null) {
                const method = (routeMatch[1] ?? 'get').toLowerCase();
                const routePath = routeMatch[2] ?? '/';
                
                // Skip infrastructure endpoints - they don't need to be in OpenAPI
                if (['/openapi.json', '/docs', '/health', '/healthz', '/readyz', '/metrics', '/'].includes(routePath)) {
                  continue;
                }
                
                // Convert Express :param to OpenAPI {param}
                const openApiPath = routePath.replace(/:(\w+)/g, '{$1}');
                
                if (!paths[openApiPath]) {
                  paths[openApiPath] = {};
                }
                
                // Generate summary from path
                const pathParts = routePath.split('/').filter((p: string) => p && !p.startsWith(':'));
                const lastPart = pathParts[pathParts.length - 1] ?? 'resource';
                const summary = `${method.charAt(0).toUpperCase() + method.slice(1)} ${lastPart}`;
                
                // Determine response codes based on method
                const responses: Record<string, { description: string }> = {};
                if (method === 'post') {
                  responses['201'] = { description: 'Created' };
                  responses['400'] = { description: 'Bad Request' };
                } else if (method === 'get') {
                  responses['200'] = { description: 'OK' };
                  responses['404'] = { description: 'Not Found' };
                } else if (method === 'put' || method === 'patch') {
                  responses['200'] = { description: 'OK' };
                  responses['404'] = { description: 'Not Found' };
                } else if (method === 'delete') {
                  responses['204'] = { description: 'No Content' };
                  responses['404'] = { description: 'Not Found' };
                }
                
                // Add 401 for auth-related paths
                if (routePath.includes('auth') || routePath.includes('login') || routePath.includes('logout') || routePath.includes('session')) {
                  responses['401'] = { description: 'Unauthorized' };
                }
                
                paths[openApiPath][method] = { summary, responses };
              }
              
              // Extract API_INFO if present for better info section
              const apiInfoMatch = fixedCode.match(/const\s+API_INFO\s*=\s*\{[^}]*name:\s*['"]([^'"]+)['"][^}]*version:\s*['"]([^'"]+)['"][^}]*\}/);
              const title = apiInfoMatch?.[1] ?? 'API';
              const version = apiInfoMatch?.[2] ?? '1.0.0';
              
              const openapiSpecConst = `
// OpenAPI specification (auto-generated by FastValidator from route handlers)
const openApiSpec = {
  openapi: '3.0.0',
  info: { title: '${title}', version: '${version}' },
  paths: ${JSON.stringify(paths, null, 2).replace(/\n/g, '\n  ')},
};
`;
              // Insert after app initialization
              const appInit = fixedCode.match(/const\s+app\s*=\s*express\s*\(\);?/);
              if (appInit && appInit.index !== undefined) {
                const insertPos = appInit.index + appInit[0].length;
                fixedCode = fixedCode.slice(0, insertPos) + '\n' + openapiSpecConst + fixedCode.slice(insertPos);
              }
              
              logger.debug({ pathCount: Object.keys(paths).length }, 'Auto-generated OpenAPI spec from route handlers');
            }

            const openapiEndpoint = `
// OpenAPI specification endpoint (auto-injected by FastValidator)
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});
`;
            // Insert before /docs or /health endpoint
            const docsMatch = fixedCode.match(/app\.get\s*\(\s*['"]\/docs['"]/);
            const healthForOpenapi = fixedCode.match(/app\.get\s*\(\s*['"]\/health['"]/);

            if (docsMatch && docsMatch.index !== undefined) {
              fixedCode = fixedCode.slice(0, docsMatch.index) + openapiEndpoint + '\n' + fixedCode.slice(docsMatch.index);
            } else if (healthForOpenapi && healthForOpenapi.index !== undefined) {
              fixedCode = fixedCode.slice(0, healthForOpenapi.index) + openapiEndpoint + '\n' + fixedCode.slice(healthForOpenapi.index);
            }
            logger.debug('Injected /openapi.json endpoint');
          }
          break;

        case 'INCOMPLETE_OPENAPI_SPEC':
          // V5: Enrich incomplete OpenAPI spec with missing paths from actual route handlers
          {
            const incompleteCheck = detectIncompleteOpenApiSpec(fixedCode);
            if (incompleteCheck.hasMissingPaths) {
              // Build the missing paths object
              const missingPathsObj: Record<string, Record<string, { summary: string; responses: Record<string, { description: string }> }>> = {};
              
              for (const route of incompleteCheck.missingPaths) {
                const [method, path] = route.split(':');
                if (!method || !path) continue;
                
                const openApiPath = path.replace(/:(\w+)/g, '{$1}');
                
                if (!missingPathsObj[openApiPath]) {
                  missingPathsObj[openApiPath] = {};
                }
                
                // Generate summary from path
                const pathParts = path.split('/').filter((p: string) => p && !p.startsWith(':'));
                const lastPart = pathParts[pathParts.length - 1] ?? 'resource';
                const summary = `${method.charAt(0).toUpperCase() + method.slice(1)} ${lastPart}`;
                
                // Determine response codes based on method
                const responses: Record<string, { description: string }> = {};
                if (method === 'post') {
                  responses['201'] = { description: 'Created' };
                  responses['400'] = { description: 'Bad Request' };
                } else if (method === 'get') {
                  responses['200'] = { description: 'OK' };
                  responses['404'] = { description: 'Not Found' };
                } else if (method === 'put' || method === 'patch') {
                  responses['200'] = { description: 'OK' };
                  responses['404'] = { description: 'Not Found' };
                } else if (method === 'delete') {
                  responses['204'] = { description: 'No Content' };
                  responses['404'] = { description: 'Not Found' };
                }
                
                // Add 401 for auth-related paths
                if (path.includes('auth') || path.includes('login') || path.includes('logout') || path.includes('session')) {
                  responses['401'] = { description: 'Unauthorized' };
                }
                
                missingPathsObj[openApiPath][method] = { summary, responses };
              }
              
              // Find the paths: { ... } section in openApiSpec and inject missing paths
              // Look for pattern: paths: { ... existing paths ... }
              const pathsMatch = fixedCode.match(/(const\s+openApiSpec\s*=\s*\{[\s\S]*?paths:\s*\{)([\s\S]*?)(\},?\s*(?:components|\};))/);
              if (pathsMatch && pathsMatch.index !== undefined) {
                const beforePaths = pathsMatch[1] ?? '';
                const existingPaths = pathsMatch[2] ?? '';
                const afterPaths = pathsMatch[3] ?? '';
                
                // Build the missing paths string
                const missingPathsEntries: string[] = [];
                for (const [pathKey, methods] of Object.entries(missingPathsObj)) {
                  const methodEntries: string[] = [];
                  for (const [methodKey, spec] of Object.entries(methods)) {
                    const responsesStr = Object.entries(spec.responses)
                      .map(([code, r]) => `'${code}': { description: '${r.description}' }`)
                      .join(', ');
                    methodEntries.push(`${methodKey}: { summary: '${spec.summary}', responses: { ${responsesStr} } }`);
                  }
                  missingPathsEntries.push(`'${pathKey}': { ${methodEntries.join(', ')} }`);
                }
                
                // Inject missing paths at the end of existing paths
                
                const trimmedExisting = existingPaths.trimEnd();
                const needsComma = trimmedExisting.length > 0 && !trimmedExisting.endsWith(',');
                const separator = needsComma ? ',' : '';
                
                const newPathsSection = beforePaths + existingPaths + separator + '\n    // Auto-injected by FastValidator\n    ' + missingPathsEntries.join(',\n    ') + '\n  ' + afterPaths;
                
                fixedCode = fixedCode.slice(0, pathsMatch.index) + newPathsSection + fixedCode.slice(pathsMatch.index + pathsMatch[0].length);
                
                logger.debug({ injectedCount: incompleteCheck.missingPaths.length, paths: incompleteCheck.missingPaths }, 'Injected missing OpenAPI paths');
              }
            }
          }
          break;

        // =========================================================================
        // V4 SWAGGER UI RESPONSE DISPLAY FIXES
        // =========================================================================

        case 'UNUSED_EXPRESS_TYPES_IMPORT':
          // Remove unused Request/Response/NextFunction types from express import
          // This happens when route handlers use (req, res) without type annotations
          // NOTE: Uses flexible patterns to handle imports with additional types like NextFunction
          {
            const hasUnusedExpressTypes =
              (/import\s+express\s*,\s*\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(fixedCode) ||
               /import\s+\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(fixedCode)) &&
              !/:\s*Request\b/.test(fixedCode) && !/:\s*Response\b/.test(fixedCode) && !/:\s*NextFunction\b/.test(fixedCode);

            if (hasUnusedExpressTypes) {
              // Replace import with destructured types with simple express import
              fixedCode = fixedCode.replace(
                /import\s+express\s*,\s*\{[^}]*\}\s+from\s+['"]express['"];?/g,
                "import express from 'express';"
              );
              // Also handle standalone type imports
              fixedCode = fixedCode.replace(
                /import\s+\{[^}]*\bRequest\b[^}]*\bResponse\b[^}]*\}\s+from\s+['"]express['"];?\n?/g,
                ""
              );
              logger.debug('Removed unused Request, Response, NextFunction from express import');
            }
          }
          break;

        case 'OPENAPI_MISSING_RESPONSE_SCHEMA':
          // Inject responses property into OpenAPI endpoint definitions
          // This is critical for Swagger UI to display response data
          if (/const\s+openApiSpec\s*=/.test(fixedCode)) {
            // For each HTTP method in openApiSpec that has summary/parameters but no responses,
            // inject a basic responses object
            // Pattern: get: { summary: '...', parameters: [...] } -> get: { summary: '...', parameters: [...], responses: { '200': { ... } } }

            // Match method definitions without responses
            // This regex is careful to only match method objects that don't already have responses
            fixedCode = fixedCode.replace(
              /(get|post|put|patch|delete)\s*:\s*\{([^}]*?)(summary\s*:[^,}]+)([^}]*)(\})/g,
              (match, method, before, summary, after, closeBrace) => {
                // Skip if already has responses
                if (/responses\s*:/.test(match)) {
                  return match;
                }

                // Determine response code based on method
                const responseCode = method === 'post' ? '201' : '200';
                const responseDesc = method === 'post' ? 'Created' :
                                     method === 'delete' ? 'Deleted' : 'Success';

                // Build the responses object
                const responsesObj = `, responses: { '${responseCode}': { description: '${responseDesc}', content: { 'application/json': { schema: { type: 'object' } } } } }`;

                // Insert responses before closing brace
                return `${method}: {${before}${summary}${after}${responsesObj}${closeBrace}`;
              }
            );
            logger.debug('Injected responses into OpenAPI endpoints');
          }
          break;
      }
    }

    // FINAL VALIDATION: If our fixes broke the syntax, return original code
    if (!this.hasBalancedSyntax(fixedCode)) {
      logger.warn('Auto-fix broke syntax - returning original code');
      return code;
    }

    return fixedCode;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const fastValidator = new FastValidator();
export const autoFixer = new AutoFixer();
