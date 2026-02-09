/**
 * Development-related prompt templates for self-regenerating app ecosystem
 * Uses Gemini 3's code generation capabilities with thinking levels
 */

import type { PromptTemplate } from './index.js';

/**
 * Requirement analysis prompt - parses natural language into structured requirements
 */
export const ANALYZE_REQUIREMENT_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert software architect analyzing requirements for implementation.

Your task is to analyze natural language requirements and produce structured, actionable specifications.

Key responsibilities:
1. Identify the type of change (feature, bugfix, refactor, infrastructure)
2. Extract clear acceptance criteria
3. Estimate complexity based on scope and dependencies
4. Identify required capabilities and potential risks
5. Suggest implementation approach

Complexity estimation guidelines:
- LOW: Single file change, no new dependencies, straightforward logic
- MEDIUM: Multiple files, some new dependencies, moderate complexity
- HIGH: Many files, significant dependencies, complex logic or architecture changes

Response format (JSON):
{
  "type": "feature|bugfix|refactor|infrastructure",
  "title": "Short descriptive title (max 60 chars)",
  "description": "Detailed description of what needs to be implemented",
  "acceptanceCriteria": ["Specific, testable criterion 1", "Criterion 2"],
  "estimatedComplexity": "low|medium|high",
  "suggestedApproach": "High-level implementation approach",
  "requiredCapabilities": ["api", "database", "ui", "kubernetes", "etc"],
  "potentialRisks": ["Risk 1", "Risk 2"],
  "relatedPatterns": ["Existing patterns to follow"],
  "targetFiles": ["Suggested files to create/modify"],
  "suggestedDependencies": ["New npm packages if needed"]
}`,

  build: (params: Record<string, unknown>): string => {
    const requirement = params.requirement as string || '';
    const projectContext = params.projectContext as string || '';
    const existingPatterns = params.existingPatterns as string || '';

    return `Analyze the following requirement and produce a structured specification:

=== REQUIREMENT ===
${requirement}

${projectContext ? `=== PROJECT CONTEXT ===\n${projectContext}\n` : ''}
${existingPatterns ? `=== EXISTING PATTERNS ===\n${existingPatterns}\n` : ''}

Guidelines:
- Be specific and actionable in acceptance criteria
- Consider edge cases and error scenarios
- Think about testability and maintainability
- Consider security implications
- Keep complexity estimates realistic

Provide your analysis in the specified JSON format.`;
  },
};

/**
 * Architecture design prompt - designs component structure for a feature
 */
export const DESIGN_ARCHITECTURE_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert software architect designing the architecture for a feature.

Your task is to design a clean, maintainable architecture that follows existing project patterns.

Design principles:
1. Single Responsibility - each component does one thing well
2. Dependency Injection - components receive dependencies, don't create them
3. Interface Segregation - small, focused interfaces
4. Testability - design for easy unit and integration testing
5. Error Handling - graceful degradation, clear error messages

REQUIRED COMPONENTS:
- You MUST include a component with 'App' in the name (e.g., PingApp, ApiApp, ServerApp)
- This App component handles ALL Express/HTTP server setup
- For simple APIs: use ONLY the App component (do not create separate controllers, routes, services)
- The App component should contain:
  - Express app setup
  - All route handlers (inline, not imported)
  - A start() function that starts the HTTP server
- Keep the architecture MINIMAL - do not over-engineer simple requirements

ChronosOps conventions:
- Use 'interface' for object shapes, 'type' for unions
- Use 'const' objects with 'as const' instead of enums
- Named exports (avoid default exports except React components)
- EventEmitter for component communication
- Pino logger with object-first syntax

Response format (JSON):
{
  "overview": "High-level architecture description",
  "components": [
    {
      "name": "ComponentName",
      "type": "service|repository|controller|middleware|route|model|util",
      "purpose": "What this component does",
      "suggestedPath": "packages/package/src/path/file.ts",
      "interface": [
        {
          "name": "methodName",
          "description": "What the method does",
          "parameters": [{"name": "param", "type": "string", "optional": false, "description": "..."}],
          "returnType": "Promise<ReturnType>",
          "async": true
        }
      ],
      "internalState": ["Optional list of internal state"],
      "errorHandling": "How errors are handled",
      "dependsOn": ["Other component names"],
      "testRequirements": ["Key test scenarios"]
    }
  ],
  "dependencies": [
    {"from": "ComponentA", "to": "ComponentB", "type": "uses|extends|implements"}
  ],
  "externalDependencies": [
    {"name": "zod", "version": "^3.22.0", "purpose": "Input validation", "devOnly": false}
  ],
  "dataFlow": "Description of how data flows through components",
  "securityConsiderations": ["Security consideration 1"],
  "performanceConsiderations": ["Performance consideration 1"],
  "testingStrategy": "How to test this feature"
}`,

  build: (params: Record<string, unknown>): string => {
    const requirement = params.requirement as string || '';
    const acceptanceCriteria = params.acceptanceCriteria as string[] || [];
    const existingArchitecture = params.existingArchitecture as string || '';
    const codebaseContext = params.codebaseContext as string || '';

    // Format acceptance criteria as a numbered list for emphasis
    const acceptanceCriteriaSection = acceptanceCriteria.length > 0
      ? `=== MANDATORY ACCEPTANCE CRITERIA ===
CRITICAL: The following requirements MUST be reflected in your architecture.
Each criterion represents a REQUIRED feature, endpoint, or constraint.

${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

IMPORTANT: Your component interface[] MUST include methods for ALL endpoints listed above.
Do NOT omit any endpoints. Every acceptance criterion must map to at least one interface method.
`
      : '';

    return `Design the architecture for the following feature:

=== ANALYZED REQUIREMENT ===
${requirement}

${acceptanceCriteriaSection}
${existingArchitecture ? `=== EXISTING ARCHITECTURE ===\n${existingArchitecture}\n` : ''}
${codebaseContext ? `=== CODEBASE PATTERNS ===\n${codebaseContext}\n` : ''}

Guidelines:
- Follow existing project patterns exactly
- Use dependency injection where appropriate
- Keep components focused and testable
- Consider error handling at each layer
- Follow TypeScript best practices
- Design for extensibility
- CRITICAL: Include ALL endpoints from acceptance criteria in component interfaces

Provide your architecture design in the specified JSON format.`;
  },
};

/**
 * Code generation prompt - generates SIMPLE, working TypeScript code
 * Uses 1M context window to generate ALL components in a single call
 */
export const GENERATE_CODE_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, generating SIMPLE, MINIMAL TypeScript code.
You have access to a 1 MILLION TOKEN context window - use it to generate ALL components together.

════════════════════════════════════════════════════════════════════════════════
MANDATORY PATTERNS - EVERY GENERATED FILE MUST INCLUDE THESE EXACTLY
════════════════════════════════════════════════════════════════════════════════

1. IMPORTS (copy these EXACTLY - do NOT add NextFunction):
   import express, { Request, Response } from 'express';
   import { z } from 'zod';
   import { randomUUID } from 'crypto';
   
   ⚠️ DO NOT import NextFunction - it causes "unused import" errors!
   ⚠️ DO NOT import from 'uuid' - use crypto.randomUUID() instead

2. API METADATA & OPENAPI SPEC (required - MUST include full spec with parameters and schemas):
   const API_INFO = { name: 'Your API Name', version: '1.0.0', description: 'Your API description' };

   // CRITICAL: OpenAPI spec MUST include:
   // - paths with parameters array for {id} routes
   // - requestBody for POST/PUT endpoints
   // - components.schemas matching your Zod schemas
   const openApiSpec = {
     openapi: '3.0.0',
     info: { title: API_INFO.name, version: API_INFO.version, description: API_INFO.description },
     paths: {
       '/resources': {
         get: { summary: 'List resources', operationId: 'listResources', tags: ['Resources'],
           responses: { '200': { description: 'Array of resources', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Resource' } } } } } }
         },
         post: { summary: 'Create resource', operationId: 'createResource', tags: ['Resources'],
           requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateResource' } } } },
           responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' } }
         }
       },
       '/resources/{id}': {
         get: { summary: 'Get resource', operationId: 'getResource', tags: ['Resources'],
           parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Resource ID' }],
           responses: { '200': { description: 'Resource found' }, '404': { description: 'Not found' } }
         },
         put: { summary: 'Update resource', operationId: 'updateResource', tags: ['Resources'],
           parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Resource ID' }],
           requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateResource' } } } },
           responses: { '200': { description: 'Updated' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' } }
         },
         delete: { summary: 'Delete resource', operationId: 'deleteResource', tags: ['Resources'],
           parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Resource ID' }],
           responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } }
         }
       }
     },
     components: {
       schemas: {
         Resource: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, /* ... all fields from your ResourceSchema */ }, required: ['id', /* required fields */] },
         CreateResource: { type: 'object', properties: { /* fields from CreateResourceSchema */ }, required: [/* required fields */] },
         UpdateResource: { type: 'object', properties: { /* fields from UpdateResourceSchema */ } }
       }
     }
   };

   const swaggerHtml = \`<!DOCTYPE html>...\`; // Swagger UI from CDN (see template)

3. DOCUMENTATION ENDPOINTS (required in every API):
   // Root endpoint - API metadata
   app.get('/', (_req: Request, res: Response) => {
     res.json({ ...API_INFO, docs: '/docs', openapi: '/openapi.json', health: '/health' });
   });
   // OpenAPI spec endpoint
   app.get('/openapi.json', (_req: Request, res: Response) => {
     res.json(openApiSpec);
   });
   // Swagger UI documentation
   app.get('/docs', (_req: Request, res: Response) => {
     res.setHeader('Content-Type', 'text/html');
     res.send(swaggerHtml);
   });

4. HEALTH & BUSINESS ENDPOINTS (required in every API):
   app.get('/health', (_req: Request, res: Response) => {
     res.json({ status: 'ok' });
   });
   app.get('/<resources>', ...) // List all endpoint for each POST resource

5. EXPORTS (required at the end of every API file):
   export { app };
   export function start(): void {
     const PORT = process.env.PORT || 8080;
     app.listen(PORT, () => {
       console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
       console.log(\`  API Docs: http://localhost:\${PORT}/docs\`);
     });
   }

6. VALIDATION (wrap every POST/PUT handler body access with Zod):
   try {
     const input = CreateSchema.parse(req.body);
   } catch (error) {
     if (error instanceof z.ZodError) {
       res.status(400).json({ error: 'Validation failed', details: error.errors });
       return;
     }
     res.status(500).json({ error: 'Internal server error' });
   }

FAILURE TO INCLUDE ANY OF THESE PATTERNS WILL CAUSE VALIDATION ERRORS!
════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
ERROR PATTERN DATABASE - NEVER MAKE THESE MISTAKES
═══════════════════════════════════════════════════════════════════════════════

ERROR 1: Using 'as' casting on req.body
❌ WRONG: const input = req.body as CreateUserInput;
❌ WRONG: const input = req.body as { email?: string };
✅ CORRECT: const input = CreateUserSchema.parse(req.body);

ERROR 2: Importing uuid package
❌ WRONG: import { v4 as uuidv4 } from 'uuid';
✅ CORRECT: import { randomUUID } from 'crypto';

ERROR 3: Using express namespace for types
❌ WRONG: (req: express.Request, res: express.Response)
✅ CORRECT: import { Request, Response } from 'express'; then use (req: Request, res: Response)
❌ WRONG: import express, { Request, Response, NextFunction } from 'express'; // NextFunction unused!
✅ CORRECT: import express, { Request, Response } from 'express'; // Only import what you use!

ERROR 4: Optional fields in Create schema when used as required
❌ WRONG: const CreateUserSchema = z.object({ email: z.string().optional() }); // if email is used!
✅ CORRECT: const CreateUserSchema = z.object({ email: z.string().email() }); // no .optional()

ERROR 5: Missing try/catch on Schema.parse
❌ WRONG: const input = CreateUserSchema.parse(req.body); // May throw!
✅ CORRECT: try { const input = Schema.parse(req.body); } catch (e) { if (e instanceof z.ZodError) ... }

ERROR 6: Unused parameters without underscore
❌ WRONG: (req, res) => { res.json({}); } // 'req' unused
✅ CORRECT: (_req, res) => { res.json({}); } // prefix with _

ERROR 7: Missing list endpoint
❌ WRONG: Only POST /users without GET /users
✅ CORRECT: If POST /users exists, GET /users MUST exist (returns array)

ERROR 8: Destructuring unvalidated req.body
❌ WRONG: const { email, name } = req.body; // No type safety!
✅ CORRECT: const input = CreateUserSchema.parse(req.body); then use input.email, input.name

ERROR 9: Using req.params without type cast (Express types it as string | string[])
❌ WRONG: const user = users.get(req.params.id); // Type error: string | string[] not assignable to string
❌ WRONG: const id = req.params.id; // id has type string | string[]
✅ CORRECT: const id = req.params.id as string; // Cast to string first
✅ CORRECT: const user = users.get(req.params.id as string);
REASON: Express route params are typed as string | string[] to handle array params. ALWAYS cast to string!

ERROR 10: Incomplete OpenAPI spec (missing parameters, schemas, or requestBody)
❌ WRONG: openApiSpec.paths = { '/users': { get: { summary: 'List' }, post: { summary: 'Create' } } }
❌ WRONG: openApiSpec with no components.schemas defined
❌ WRONG: '/users/{id}' path without parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
✅ CORRECT: openApiSpec.paths.'/users/{id}'.get.parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'User ID' }]
✅ CORRECT: openApiSpec.paths.'/users'.post.requestBody = { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } } } }
✅ CORRECT: openApiSpec.components.schemas = { User: { type: 'object', properties: {...}, required: [...] }, CreateUser: {...} }

ERROR 11: POST/PUT endpoint in OpenAPI spec WITHOUT requestBody (Swagger UI shows "No parameters")
❌ WRONG: post: { summary: 'Create user', operationId: 'createUser', responses: {...} }  // Missing requestBody!
❌ WRONG: put: { summary: 'Update user', parameters: [...], responses: {...} }  // Missing requestBody!
✅ CORRECT: post: {
    summary: 'Create user',
    operationId: 'createUser',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } } }
    },
    responses: {...}
  }
✅ CORRECT: put: {
    summary: 'Update user',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUser' } } }
    },
    responses: {...}
  }
CRITICAL: Every POST and PUT path in openApiSpec.paths MUST have requestBody with schema $ref!

ERROR 11: Direct use of req.query values without type conversion
❌ WRONG: parseInt(req.query.page, 10)  // req.query.page is string | string[] | undefined, not string!
❌ WRONG: const page = req.query.page || 1  // Type error: string | string[] vs number
❌ WRONG: limit: req.query.limit  // Type mismatch
✅ CORRECT: const page = parseInt(String(req.query.page || '1'), 10);
✅ CORRECT: const limit = parseInt(String(req.query.limit || '10'), 10);
✅ CORRECT: const sortBy = String(req.query.sortBy || 'createdAt');
REASON: Express req.query values have type string | string[] | ParsedQs | undefined. ALWAYS convert with String() wrapper!

ERROR 12: OpenAPI responses missing content/schema (Swagger UI won't display response body!)
❌ WRONG: responses: { '200': { description: 'User found' } }  // No content schema!
❌ WRONG: responses: { '201': { description: 'Created user' } }  // No content schema!
✅ CORRECT: responses: {
    '200': {
      description: 'User found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
    }
  }
✅ CORRECT: responses: {
    '201': {
      description: 'Created user',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
    }
  }
CRITICAL: Every 200/201 response MUST have content.application/json.schema with $ref for Swagger UI to display response body!

ERROR 13: Authentication endpoints returning 400 instead of 401 for missing/invalid tokens
❌ WRONG: For /auth/logout endpoint with missing token:
   try { const input = LogoutSchema.parse(req.body); }
   catch (error) { if (error instanceof z.ZodError) { res.status(400).json(...); } }  // Returns 400!
❌ WRONG: Treating missing authentication token as a validation error (400)
✅ CORRECT: For authentication endpoints (login, logout, validate-session), check auth first:
   // Check for token/credentials BEFORE Zod validation
   const token = req.body?.token || req.headers.authorization?.replace('Bearer ', '');
   if (!token) {
     res.status(401).json({ error: 'No token provided' });  // 401 Unauthorized
     return;
   }
   // Then validate other fields with Zod (returns 400 for format errors)
✅ CORRECT: Use 401 for missing/invalid authentication, 400 for malformed data
RULE: Authentication errors (missing token, invalid credentials, expired session) → 401 Unauthorized
RULE: Validation errors (wrong email format, missing name field) → 400 Bad Request

ERROR 14: Crashing on missing environment variables instead of using defaults
❌ WRONG: if (!process.env.JWT_SECRET) { throw new Error('Missing JWT_SECRET'); }  // App crashes!
❌ WRONG: const secret = process.env.JWT_SECRET!;  // Crashes if undefined
❌ WRONG: const config = { jwtSecret: process.env.JWT_SECRET };  // undefined causes issues
✅ CORRECT: const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-CHANGE-IN-PRODUCTION';
✅ CORRECT: const DATABASE_URL = process.env.DATABASE_URL || 'memory://localhost/development';
✅ CORRECT: const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret';
CRITICAL RULE: NEVER throw errors or crash on missing environment variables!
REASON: ChronosOps injects env vars at deployment time. Code must gracefully use development defaults.
For authentication APIs, use sensible defaults:
  - JWT_SECRET → 'development-jwt-secret-CHANGE-IN-PRODUCTION'
  - SESSION_SECRET → 'development-session-secret'
  - DATABASE_URL → 'memory://localhost/dev' (signals in-memory storage)
  - TOKEN_EXPIRY → '24h'
Log a warning instead: console.warn('JWT_SECRET not set, using development default');

ERROR 15: Using Redis or external session stores when storageMode is memory
❌ WRONG: import Redis from 'ioredis';  // Requires external Redis server!
❌ WRONG: import redis from 'redis';  // Requires external Redis server!
❌ WRONG: import session from 'express-session'; import RedisStore from 'connect-redis';
❌ WRONG: const redisClient = new Redis(process.env.REDIS_URL);
❌ WRONG: Checking redis.status in health/readyz endpoints
✅ CORRECT: Use in-memory Map<string, Session> for session storage
✅ CORRECT: Use JWT tokens (stateless, no server-side session needed)
✅ CORRECT: const sessions = new Map<string, Session>();
✅ CORRECT: readyz endpoint checks only internal state, returns 200 OK
CRITICAL RULE: When storageMode is 'memory', NEVER use Redis, Memcached, or external stores!
REASON: The Kubernetes pod has NO access to Redis. The app will crash or return 503.
For auth APIs in memory mode:
  - Use JWT (tokens are self-contained, client stores them)
  - If sessions needed: store in Map<string, Session>
  - readyz should return { status: 'ok' } with NO external dependency checks

ERROR 16: OpenAPI spec paths do not match actual route handlers (Swagger UI incomplete!)
❌ WRONG: You define these routes:
   app.post('/api/v1/auth/register', ...);
   app.post('/api/v1/auth/login', ...);
   app.post('/api/v1/auth/logout', ...);  // EXISTS
   app.get('/api/v1/auth/validate', ...);
   
   But your openApiSpec.paths only contains:
   '/api/v1/auth/register': {...}
   '/api/v1/auth/login': {...}
   '/api/v1/auth/validate': {...}
   // MISSING: /api/v1/auth/logout ← Swagger won't show this!

❌ WRONG: POST endpoint without requestBody in OpenAPI:
   '/api/v1/auth/login': {
     post: { summary: 'Login', responses: {...} }  // NO requestBody!
   }
   // Swagger UI shows "No parameters" - user can't test the endpoint

❌ WRONG: Malformed OpenAPI - responses nested inside schema:
   requestBody: { content: { 'application/json': { schema: {
     $ref: '#/components/schemas/X',
     responses: {...}  // WRONG PLACE! responses go at the operation level
   }}}}

✅ CORRECT: EVERY route handler must have a matching openApiSpec.paths entry:
   const openApiSpec = {
     paths: {
       '/api/v1/auth/register': {
         post: {
           summary: 'Register new user',
           requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } } } },
           responses: { '201': { description: 'Created' }, '400': { description: 'Bad Request' } }
         }
       },
       '/api/v1/auth/login': {
         post: {
           summary: 'Login user',
           requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } } },
           responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } }
         }
       },
       '/api/v1/auth/logout': {  // REQUIRED - matches app.post('/api/v1/auth/logout')
         post: {
           summary: 'Logout user',
           responses: { '204': { description: 'No Content' } }
         }
       },
       '/api/v1/auth/validate': {
         get: {
           summary: 'Validate session',
           responses: { '200': { description: 'Valid' }, '401': { description: 'Invalid' } }
         }
       }
     },
     components: {
       schemas: {
         CreateUser: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
         LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }
       }
     }
   };

VERIFICATION RULE: Count app.get/post/put/delete route handlers. Count openApiSpec.paths entries.
                   THEY MUST MATCH. Every POST/PUT must have requestBody.

═══════════════════════════════════════════════════════════════════════════════
SELF-VERIFICATION CHECKLIST (Run BEFORE outputting code)
═══════════════════════════════════════════════════════════════════════════════

Before outputting, verify EACH item. If ANY fails, FIX before outputting:

□ IMPORTS: Has import express, { Request, Response } from 'express'
□ IMPORTS: Has import { z } from 'zod'
□ IMPORTS: Has import { randomUUID } from 'crypto'
□ IMPORTS: Does NOT have import from 'uuid'
□ IMPORTS: Does NOT use express.Request or express.Response

□ SCHEMAS: All Zod schemas defined BEFORE routes
□ SCHEMAS: Types derived with z.infer<typeof Schema>
□ SCHEMAS: Create schema required fields have NO .optional()

□ DOCS: Has const API_INFO = { name, version, description }
□ DOCS: Has const openApiSpec with openapi: '3.0.0'
□ DOCS: openApiSpec.info has title, version, description (NOT just API_INFO reference)
□ DOCS: openApiSpec.paths has ALL endpoints documented
□ DOCS: openApiSpec.paths.'/resources/{id}' has parameters: [{ name: 'id', in: 'path', ... }]
□ DOCS: CRITICAL - Every POST path has requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateX' } } } }
□ DOCS: CRITICAL - Every PUT path has requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateX' } } } }
□ DOCS: CRITICAL - Every 200/201 response has content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } }
□ DOCS: CRITICAL - components.schemas has CreateX and UpdateX for each resource X (e.g., CreateUser, UpdateUser)
□ DOCS: openApiSpec.components.schemas.CreateX.properties matches CreateXSchema.shape
□ DOCS: openApiSpec.components.schemas.UpdateX.properties matches UpdateXSchema.shape
□ DOCS: Has const swaggerHtml with Swagger UI from CDN

□ ROUTES: Has GET / root endpoint returning API metadata
□ ROUTES: Has GET /openapi.json endpoint returning openApiSpec
□ ROUTES: Has GET /docs endpoint returning swaggerHtml
□ ROUTES: Has GET /health endpoint
□ ROUTES: Has GET /<resources> list endpoint for each POST resource
□ ROUTES: Every POST/PUT has Schema.parse(req.body) in try/catch
□ ROUTES: Every try/catch handles instanceof z.ZodError → 400
□ ROUTES: Auth endpoints (logout, validate) return 401 for missing token, NOT 400

□ PATTERNS: NO 'req.body as' casting anywhere
□ PATTERNS: Unused params prefixed with _ (e.g., _req)
□ PATTERNS: All req.query values wrapped with String() before use (e.g., String(req.query.page || '1'))

□ EXPORTS: Has export { app }
□ EXPORTS: Has export function start()

═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
DATABASE PERSISTENCE OPTIONS (when storageMode is specified)
═══════════════════════════════════════════════════════════════════════════════

When generating APIs with database persistence, use Drizzle ORM for type-safe database access.
Storage modes are: 'memory' (default Map), 'sqlite' (SQLite + PVC), 'postgres' (PostgreSQL).

SQLITE PERSISTENCE PATTERN:
\`\`\`typescript
// Required imports for SQLite
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Define Drizzle schema (replaces in-memory Map)
export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Database connection (synchronous for SQLite)
const DB_PATH = process.env.DATABASE_PATH || './data/app.db';
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch {}
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);

// Create table if not exists
sqlite.exec(\`CREATE TABLE IF NOT EXISTS items (...)\`);

// SQLite uses SYNCHRONOUS methods: .all(), .get(), .run()
const allItems = db.select().from(items).all();        // List
const item = db.select().from(items).where(eq(items.id, id)).get(); // Get one
db.insert(items).values(newItem).run();               // Insert
db.update(items).set(data).where(eq(items.id, id)).run(); // Update
db.delete(items).where(eq(items.id, id)).run();       // Delete

// Health check includes database status
app.get('/health', (_req, res) => {
  try {
    sqlite.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'connected', path: DB_PATH });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => { sqlite.close(); process.exit(0); });
\`\`\`

POSTGRESQL PERSISTENCE PATTERN:
\`\`\`typescript
// Required imports for PostgreSQL
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import pg from 'pg';

// Define Drizzle schema (PostgreSQL types)
export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Database connection (async for PostgreSQL)
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgres://postgres:\${POSTGRES_PASSWORD}@chronosops-postgres.development.svc.cluster.local:5432/appdb';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
let db: ReturnType<typeof drizzle>;

// ============================================================================
// CRITICAL: Initialize database with migrations - MUST call before app.listen()
// ============================================================================
async function initializeDatabase(): Promise<void> {
  db = drizzle(pool);
  const client = await pool.connect();
  try {
    // Create tables if they don't exist - adapt columns to your schema
    await client.query(\`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    \`);
    console.log('Database migrations completed');
  } finally {
    client.release();
  }
}

// PostgreSQL uses ASYNC methods (add async to route handlers)
const allItems = await db.select().from(items);       // List
const [item] = await db.select().from(items).where(eq(items.id, id)); // Get one
const [created] = await db.insert(items).values(data).returning(); // Insert
const [updated] = await db.update(items).set(data).where(eq(items.id, id)).returning(); // Update
await db.delete(items).where(eq(items.id, id));      // Delete

// Health check includes database status (async)
app.get('/health', async (_req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });

// ============================================================================
// CRITICAL: Export start() that calls initializeDatabase() BEFORE app.listen()
// ============================================================================
export async function start(port = 8080): Promise<void> {
  await initializeDatabase();  // MUST call this before starting server!
  app.listen(port, () => {
    console.log(\`API running on port \${port}\`);
    console.log(\`  Database: PostgreSQL (\${DATABASE_URL.replace(/:[^:@]+@/, ':***@').split('/').pop()})\`);
  });
}
\`\`\`

KEY DIFFERENCES:
| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| Methods | Synchronous (.all(), .get(), .run()) | Async (await, .returning()) |
| Route handlers | (req, res) => {...} | async (req, res) => {...} |
| ID column | text('id').primaryKey() | uuid('id').primaryKey().defaultRandom() |
| Timestamps | text() with manual ISO strings | timestamp().defaultNow() |
| Boolean | integer({ mode: 'boolean' }) | boolean() |
| Connection | new Database(path) | new pg.Pool({ connectionString }) |

STORAGE MODE CHECKLIST:
□ If storageMode='sqlite': Use better-sqlite3, synchronous methods, text timestamps
□ If storageMode='postgres': Use pg + drizzle, async methods, native timestamps
  ⚠️ CRITICAL for postgres: MUST have initializeDatabase() with CREATE TABLE IF NOT EXISTS
  ⚠️ CRITICAL for postgres: MUST call initializeDatabase() in start() BEFORE app.listen()
□ If storageMode='memory' or unspecified: Use Map<string, T> (no database)
□ Add graceful shutdown handlers for database connections
□ Health endpoint reports database connection status

═══════════════════════════════════════════════════════════════════════════════

CRITICAL: Generate the SIMPLEST possible code that works.
- For simple APIs: USE A SINGLE FILE (src/app/index.ts) with everything
- NO classes - use simple functions
- NO complex patterns - just basic Express handlers
- NO pino-http or advanced logging - just console.log if needed
- NO middleware complexity - minimal setup only
- PREFER fewer files over many files
- ALL routes should be in the SAME file as Express app setup

MULTI-COMPONENT GENERATION:
When given multiple components (allComponents array), generate ALL of them in a single response.
This ensures TYPE CONSISTENCY across components.

TYPE CONSISTENCY REQUIREMENTS:
1. Create src/types/entities.ts with ALL shared entity types (User, Session, Token, etc.)
2. ALL components MUST import shared types from '../types/entities'
3. Use CONSISTENT property names across components (e.g., always 'passwordHash' not 'password')
4. Export ALL types that any component needs
5. Use relative imports: '../user-repository' not 'src/user-repository'

CRITICAL: NO DUPLICATE EXPORTS
- Each module MUST have UNIQUE export names
- NEVER export the same function name from multiple modules (e.g., don't export 'create' from both project-repository and task-repository)
- Use PREFIXED function names to avoid conflicts:
  * project-repository exports: createProject, findProjectById, updateProject, deleteProject
  * task-repository exports: createTask, findTaskById, updateTask, deleteTask
- NEVER have two modules that both export 'create', 'findById', 'update', or 'delete'

CRITICAL: ID GENERATION - USE BUILT-IN CRYPTO
- DO NOT use 'uuid' package - it requires npm install and @types
- USE Node.js built-in crypto.randomUUID() instead:
  \`\`\`typescript
  import { randomUUID } from 'crypto';  // Built-in, no npm package needed
  const id = randomUUID();  // Returns UUID like '550e8400-e29b-41d4-a716-446655440000'
  \`\`\`
- Alternative simple approach (also built-in):
  \`\`\`typescript
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  \`\`\`
- NEVER do this:
  \`\`\`typescript
  import { v4 as uuidv4 } from 'uuid';  // BAD - requires npm package
  \`\`\`

CRITICAL: DTO TYPE MATCHING - EXACT ERROR TO AVOID
When defining DTOs (Data Transfer Objects), ensure CREATE and UPDATE DTOs match what functions expect:
- If a function parameter is REQUIRED (not optional), the DTO MUST have that property as REQUIRED
- If a function expects { title: string }, the CreateDTO MUST have { title: string } (not { title?: string })
- BEFORE generating, verify: for each repository function, what are ALL required properties?

THE EXACT ERROR WE MUST AVOID:
\`\`\`
error TS2345: Argument of type '{ email?: string; name?: string; }' is not assignable to parameter of type 'CreateUserInput'.
  Property 'email' is optional in type '{ email?: string; }' but required in type 'CreateUserInput'.
\`\`\`

This error happens when you cast req.body with optional properties but pass it to a function expecting required properties.

- Example of CORRECT typing:
  \`\`\`typescript
  // In types/entities.ts
  export interface CreateProjectInput {
    name: string;       // REQUIRED - function will use it
    description?: string; // Optional
  }

  // In project-repository/index.ts
  export function createProject(input: CreateProjectInput): Project {
    return {
      id: randomUUID(),
      name: input.name,  // OK - 'name' is required in CreateProjectInput
      description: input.description ?? '',
    };
  }
  \`\`\`
- Example of WRONG typing (causes TypeScript errors):
  \`\`\`typescript
  // WRONG - 'name' is optional but function uses it as required
  export interface CreateProjectInput {
    name?: string;  // WRONG - should be required
  }
  \`\`\`

CRITICAL: REQUEST BODY VALIDATION - THE #1 SOURCE OF TYPESCRIPT ERRORS

⛔ BANNED PATTERNS (will cause TypeScript errors - NEVER USE THESE):
\`\`\`typescript
// ❌ Pattern 1: Casting with optional properties
const input = req.body as { email?: string; name?: string };  // WRONG!
userService.create(input);  // ERROR: email is optional but required in CreateUserInput

// ❌ Pattern 2: Direct type casting (no runtime validation)
const input = req.body as CreateUserInput;  // WRONG! No validation!
userService.create(input);  // May crash at runtime if email missing

// ❌ Pattern 3: Destructuring unvalidated body
const { email, name } = req.body;  // WRONG! Types are unknown

// ❌ Pattern 4: Angle bracket casting
const input = <CreateUserInput>req.body;  // WRONG! Same as 'as'
\`\`\`

✅ THE ONLY CORRECT PATTERN (ALWAYS USE THIS):
\`\`\`typescript
// Step 1: Define Zod schema with REQUIRED fields as z.string() (no .optional())
const CreateUserSchema = z.object({
  email: z.string().email(),    // REQUIRED - no .optional()
  name: z.string().min(1),      // REQUIRED - no .optional()
  role: z.string().optional(),  // Optional field - has .optional()
});

// Step 2: Derive TypeScript type from Zod schema (guaranteed to match)
type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Step 3: In route handler - ALWAYS use .parse() for validation
app.post('/users', (req: Request, res: Response) => {
  try {
    // .parse() validates AND types - throws ZodError if invalid
    const input: CreateUserInput = CreateUserSchema.parse(req.body);
    
    // Now input.email is guaranteed to be string (not string | undefined)
    // Now input.name is guaranteed to be string (not string | undefined)
    // Now input.role is string | undefined (because it's optional in schema)
    
    const user = userRepository.create(input);  // ✅ Type-safe!
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
\`\`\`

🔑 KEY INSIGHT: req.body has type 'any'. Casting with 'as' does NOT validate - it lies to TypeScript.
Zod's .parse() provides BOTH runtime validation AND correct TypeScript types.

PRE-GENERATION CHECKLIST (verify before generating code):
□ Every route handler uses Schema.parse(req.body), never 'as' casting
□ Zod schemas use z.string() for required fields, z.string().optional() for optional
□ Types derived with z.infer<typeof Schema> guarantee Zod schema matches TypeScript type
□ No 'as' keyword is used anywhere with req.body or request.body
□ try/catch around .parse() with ZodError handling returning 400 status

Code requirements:
1. Complete, working code - test it compiles in your head
2. SIMPLE functions, not classes
3. Basic Express: app.get('/path', (req, res) => res.json({}))
4. NO advanced TypeScript features

CRITICAL CRUD API REQUIREMENTS:
When generating CRUD APIs for a resource (e.g., users, tasks, items, products):
- GET /<resources> - List ALL resources (REQUIRED - THIS MUST EXIST!)
- GET /<resources>/:id - Get a single resource by ID
- POST /<resources> - Create a new resource
- PUT /<resources>/:id - Update a resource
- DELETE /<resources>/:id - Delete a resource
- GET /api-docs.json - Auto-generated OpenAPI spec (REQUIRED for frontend integration!)

⚠️ IMPORTANT: The GET /<resources> (list all) endpoint is REQUIRED for verification!
If you have POST /users, you MUST also have GET /users that returns an array.
Verification will FAIL if list endpoints are missing.

CRITICAL: USE ZOD FOR SCHEMA DEFINITION
- Define resource schemas using Zod (REQUIRED!)
- This enables automatic accurate API documentation
- Use z.object(), z.string(), z.boolean(), z.optional()

EXAMPLE of COMPLETE CRUD API WITH ZOD:
\`\`\`typescript
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';  // Built-in Node.js - no npm package needed!

const app = express();
app.use(express.json());

// ==================== SCHEMA DEFINITIONS (REQUIRED!) ====================
// Define schemas with Zod - this is the single source of truth
const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  createdAt: z.string(),
});

const CreateTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
});

// Derive TypeScript types from Zod schemas
type Task = z.infer<typeof TaskSchema>;
type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ==================== IN-MEMORY STORAGE ====================
const tasks: Map<string, Task> = new Map();

// ==================== ROUTES ====================
// GET /health - Health check endpoint (REQUIRED for all services)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// GET /api-docs.json - OpenAPI spec endpoint (REQUIRED!)
app.get('/api-docs.json', (req: Request, res: Response) => {
  const resourceName = 'tasks';
  const schema = TaskSchema.shape;
  const createSchema = CreateTaskSchema.shape;
  
  // Auto-generate OpenAPI from Zod schemas
  const apiDocs = {
    openapi: '3.0.0',
    info: { title: 'API', version: '1.0.0' },
    paths: {
      [\`/\${resourceName}\`]: {
        get: { summary: \`List all \${resourceName}\`, responses: { '200': { description: 'Success' } } },
        post: { summary: \`Create a \${resourceName.slice(0, -1)}\`, responses: { '201': { description: 'Created' } } }
      },
      [\`/\${resourceName}/:id\`]: {
        get: { summary: \`Get a \${resourceName.slice(0, -1)}\`, responses: { '200': { description: 'Success' } } },
        put: { summary: \`Update a \${resourceName.slice(0, -1)}\`, responses: { '200': { description: 'Success' } } },
        delete: { summary: \`Delete a \${resourceName.slice(0, -1)}\`, responses: { '204': { description: 'No Content' } } }
      }
    },
    components: {
      schemas: {
        [resourceName.slice(0, -1).charAt(0).toUpperCase() + resourceName.slice(1, -1)]: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(schema).map(([key, zodType]) => {
              const isOptional = zodType.isOptional();
              let type = 'string';
              // H2 fix: Use public unwrap() API instead of _def internals
              const innerType = isOptional && 'unwrap' in zodType ? zodType.unwrap() : zodType;
              const typeName = innerType?.constructor?.name ?? '';
              if (typeName === 'ZodBoolean') type = 'boolean';
              else if (typeName === 'ZodNumber') type = 'number';
              return [key, { type, required: !isOptional }];
            })
          )
        },
        CreateInput: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(createSchema).map(([key, zodType]) => {
              const isOptional = zodType.isOptional();
              let type = 'string';
              // H2 fix: Use public unwrap() API instead of _def internals
              const innerType = isOptional && 'unwrap' in zodType ? zodType.unwrap() : zodType;
              const typeName = innerType?.constructor?.name ?? '';
              if (typeName === 'ZodBoolean') type = 'boolean';
              else if (typeName === 'ZodNumber') type = 'number';
              return [key, { type, required: !isOptional }];
            })
          )
        }
      }
    }
  };
  res.json(apiDocs);
});

// GET /tasks - List ALL tasks (REQUIRED for any CRUD API)
app.get('/tasks', (req: Request, res: Response) => {
  const allTasks = Array.from(tasks.values());
  res.json(allTasks);
});

// GET /tasks/:id - Get a single task
app.get('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// POST /tasks - Create a new task with Zod validation
app.post('/tasks', (req: Request, res: Response) => {
  try {
    const input = CreateTaskSchema.parse(req.body);
    const id = randomUUID();  // Use built-in crypto.randomUUID()
    const task: Task = {
      id,
      title: input.title,
      description: input.description,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.set(id, task);
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /tasks/:id - Update a task
app.put('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  try {
    const input = UpdateTaskSchema.parse(req.body);
    Object.assign(task, input);
    res.json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /tasks/:id - Delete a task
app.delete('/tasks/:id', (req: Request, res: Response) => {
  if (!tasks.has(req.params.id)) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  tasks.delete(req.params.id);
  res.status(204).send();
});

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(\`Server listening on port \${PORT}\`));
}
\`\`\`

IMPORTANT NOTES:
1. ALWAYS include Zod schemas at the top of the file
2. ALWAYS include /api-docs.json endpoint that introspects schemas
3. Use z.infer<typeof Schema> to derive TypeScript types
4. Validate input with Schema.parse() in route handlers

DO NOT generate:
- Classes with constructors
- Private properties
- Complex logging frameworks
- Dependency injection patterns
- Abstract interfaces

CRITICAL FILE STRUCTURE REQUIREMENTS:
- Each component MUST be in its own directory: src/<kebab-case-name>/index.ts
- Example: component "HelloController" → src/hello-controller/index.ts
- Imports between components use: import { X } from '../other-component'
- DO NOT generate src/index.ts (entry point is generated separately)
- DO NOT import from paths that don't match this structure
- DO NOT import from @chronosops/* packages - code must be STANDALONE
- Use only standard npm packages (express, fastify, etc.) for dependencies
- SHARED TYPES go in src/types/entities.ts and are imported by ALL components

MULTI-COMPONENT FILE STRUCTURE EXAMPLE (for auth API with 3 components):
\`\`\`
src/
├── types/
│   └── entities.ts      # ALL shared types: User, Session, etc.
├── auth-app/
│   └── index.ts         # Express app with routes, imports from siblings
├── auth-service/
│   └── index.ts         # Business logic, imports User from ../types/entities
└── user-repository/
    └── index.ts         # Data access, imports User from ../types/entities
\`\`\`

CRITICAL: CROSS-FILE IMPORT RULES FOR MULTI-COMPONENT APPS
⚠️ When auth-app/index.ts needs to call functions from auth-service/index.ts:

1. IMPORT THE SERVICE, NOT INDIVIDUAL FUNCTIONS:
   \`\`\`typescript
   // auth-app/index.ts
   import * as authService from '../auth-service';  // Import as namespace
   
   // Then use: authService.login(), authService.logout(), authService.validateSession()
   \`\`\`

2. VERIFY FUNCTION NAMES MATCH EXACTLY:
   - If auth-service exports: export function validateSession(...)
   - Then auth-app must call: authService.validateSession(...) NOT authService.alidateSession()
   - Common typos to avoid: 'login' vs 'Login', 'validateSession' vs 'alidateSession'

3. EXPORT ALL FUNCTIONS FROM SERVICE FILES:
   \`\`\`typescript
   // auth-service/index.ts
   export function login(...) { ... }
   export function logout(...) { ... }
   export function validateSession(...) { ... }
   \`\`\`

4. DO NOT USE BARE FUNCTION NAMES WITHOUT IMPORT:
   ❌ WRONG: login(credentials)  // 'login' is not defined
   ✅ CORRECT: authService.login(credentials)  // Using imported namespace

SHARED TYPES FILE EXAMPLE (src/types/entities.ts):
\`\`\`typescript
// src/types/entities.ts - SINGLE source of truth for all entity types
export interface User {
  id: string;
  email: string;
  passwordHash: string;  // Use consistent name across all components!
  name?: string;
  role: string;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}
\`\`\`

APP STARTUP REQUIREMENT:
- One component MUST be named with 'App' (e.g., PingApp, ApiApp)
- This app component MUST export a function named 'start()' that starts the server
- The app component MUST also export the express app instance for testing:
  \`\`\`typescript
  // In src/task-app/index.ts
  import express from 'express';
  export const app = express();
  app.use(express.json());
  
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  // ... all routes ...

  export function start(): void {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => console.log(\`Server listening on port \${PORT}\`));
  }
  \`\`\`

CRITICAL TYPESCRIPT IMPORT REQUIREMENTS:
- ALWAYS import types explicitly: import { Request, Response } from 'express';
- NEVER use namespace references like 'express.Request' - use 'Request' after importing
- Express types example:
  \`\`\`typescript
  import express, { Request, Response, NextFunction } from 'express';
  const app = express();
  app.get('/hello', (req: Request, res: Response) => { res.json({ message: 'Hello' }); });
  \`\`\`
- DO NOT extend express types unless necessary - use simple handler signatures
- Keep types simple: avoid complex generic patterns

Response format (JSON) - FOR MULTI-COMPONENT GENERATION:
{
  "files": [
    {
      "path": "src/types/entities.ts",
      "content": "// SHARED TYPES - import this in ALL components\\nexport interface User {...}",
      "language": "typescript",
      "purpose": "Shared entity types for all components",
      "isNew": true
    },
    {
      "path": "src/auth-app/index.ts",
      "content": "// App component with Express setup and routes",
      "language": "typescript",
      "purpose": "HTTP server with Express routes",
      "isNew": true
    },
    {
      "path": "src/auth-service/index.ts",
      "content": "import { User } from '../types/entities';\\n// Business logic",
      "language": "typescript",
      "purpose": "Authentication business logic",
      "isNew": true
    }
  ],
  "dependencies": [
    {"name": "package-name", "version": "^1.0.0", "purpose": "...", "devOnly": false}
  ],
  "explanation": "Explanation of implementation choices",
  "integrationNotes": "How to integrate with existing code"
}`,

  build: (params: Record<string, unknown>): string => {
    const component = params.component as string || '';
    const architecture = params.architecture as string || '';
    const codebaseContext = params.codebaseContext as string || '';
    const previousThoughtSignature = params.previousThoughtSignature as string || '';
    const constraints = params.constraints as string[] || [];

    // Check if this is a multi-component generation request
    let componentSpec;
    try {
      componentSpec = JSON.parse(component);
    } catch {
      componentSpec = null;
    }

    const isMultiComponent = componentSpec?.allComponents?.length > 0;

    let prompt: string;
    if (isMultiComponent) {
      const componentList = componentSpec.allComponents
        .map((c: { name: string; purpose: string }) => `- ${c.name}: ${c.purpose}`)
        .join('\n');

      prompt = `Generate production-ready TypeScript code for ALL ${componentSpec.allComponents.length} components in a SINGLE response.

=== COMPONENTS TO GENERATE (ALL AT ONCE) ===
${componentList}

=== FULL COMPONENT SPECIFICATIONS ===
${JSON.stringify(componentSpec.allComponents, null, 2)}

=== SHARED TYPES HINTS ===
${JSON.stringify(componentSpec.sharedTypes, null, 2)}

${architecture ? `=== ARCHITECTURE CONTEXT ===\n${architecture}\n` : ''}
${codebaseContext ? `=== GUIDELINES ===\n${codebaseContext}\n` : ''}

CRITICAL: Generate src/types/entities.ts FIRST with all shared types (User, Session, etc.)
Then generate each component, ensuring they ALL import from '../types/entities'

=== CRITICAL TYPE SAFETY RULES (MUST FOLLOW) ===
For EVERY route handler that reads req.body:
1. Define Zod schema: const CreateUserSchema = z.object({ email: z.string(), name: z.string() })
2. Derive type: type CreateUserInput = z.infer<typeof CreateUserSchema>
3. Parse and validate: const input = CreateUserSchema.parse(req.body)
4. Handle errors: wrap in try/catch, return 400 for ZodError
5. NEVER use: req.body as SomeType - this causes TypeScript errors!
6. NEVER use: const { x, y } = req.body - no type safety!`;
    } else {
      prompt = `Generate production-ready TypeScript code for the following component:

=== COMPONENT SPECIFICATION ===
${component}

${architecture ? `=== ARCHITECTURE CONTEXT ===\n${architecture}\n` : ''}
${codebaseContext ? `=== EXISTING CODE PATTERNS ===\n${codebaseContext}\n` : ''}`;
    }

    if (constraints.length > 0) {
      prompt += `\n=== CONSTRAINTS ===\n${constraints.join('\n')}\n`;
    }

    if (previousThoughtSignature) {
      prompt += `\n=== CONTINUATION ===\nContinuing from previous analysis with thought signature: ${previousThoughtSignature}\n`;
    }

    prompt += `
Guidelines:
- Generate COMPLETE, WORKING code - no placeholders
- Follow the project's existing coding style exactly
- Include proper error handling
- Add JSDoc comments for public APIs
- Use proper typing (no 'any')
- Include all necessary imports

Provide your implementation in the specified JSON format.`;

    return prompt;
  },
};

/**
 * Code fix prompt - fixes validation errors in generated code
 */
export const FIX_CODE_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert TypeScript developer fixing code issues.

Your task is to fix validation errors while preserving original functionality.

╔══════════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: RETURN COMPLETE CODE - NO TRUNCATION!                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  You MUST return the FULL source file with fixes applied.                   ║
║  The returned code length should be SIMILAR to the original code length.    ║
║  If you omit code, the fix will be REJECTED.                                ║
║                                                                             ║
║  - DO NOT use "// ... rest of code" or any truncation markers               ║
║  - DO NOT skip functions or sections                                        ║
║  - Include ALL imports, functions, routes, and exports                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

Fix priorities:
1. TypeScript compilation errors (TS####)
2. ESLint errors (@typescript-eslint/*)
3. Test syntax errors
4. Logic errors

COMMON ERROR PATTERNS AND QUICK FIXES:

1. UNUSED IMPORTS: "'X' is defined but never used"
   - FIX: Remove the unused import from the import statement
   - Example: Remove 'NextFunction' if not used in any (req, res, next) => handler
   - Example: Remove 'UserSchema' if only CreateUserSchema/UpdateUserSchema are used

2. STRING | STRING[] ERROR: "Argument of type 'string | string[]' is not assignable to parameter of type 'string'"
   - CAUSE: req.params.id has type string | string[] in Express
   - FIX: Cast to string: const id = req.params.id as string;
   - OR: (req.params.id as string)

3. DUPLICATE EXPORT ERROR: "Module './xyz' has already exported a member named 'create'"
   - CAUSE: Two modules export same name (e.g., both export 'create')
   - FIX: Rename exports to be unique. Use prefixed names:
     * project-repository: createProject, findProjectById, updateProject
     * task-repository: createTask, findTaskById, updateTask
   - Update ALL imports to use new names

4. TYPE MISMATCH ERROR: "Argument of type '{ x?: string }' is not assignable to parameter of type 'Y'"
   - ROOT CAUSE: Using 'req.body as Type' or casting with optional properties
   - WHY IT HAPPENS: req.body is 'any', so casting doesn't validate - it lies to TypeScript
   - FIX STEPS (follow exactly):
     a. Find the line with 'req.body as ...' or direct 'req.body' usage
     b. Create Zod schema: const CreateSchema = z.object({ field: z.string() })
     c. Derive type: type CreateInput = z.infer<typeof CreateSchema>
     d. Replace cast with: const input = CreateSchema.parse(req.body)
     e. Wrap in try/catch, return 400 for ZodError
   - NEVER just change interface to make properties optional - that hides the bug!
   - The correct fix is ADD RUNTIME VALIDATION with Zod, not weaken types
   - Example fix:
     BEFORE: const input = req.body as CreateUserInput;  // WRONG
     AFTER:  const input = CreateUserSchema.parse(req.body);  // CORRECT

5. PROPERTY DOES NOT EXIST: "Property 'x' does not exist on type 'Y'"
   - CAUSE: Trying to access property not defined in interface
   - FIX: Either add property to interface OR use correct property name

6. CANNOT FIND NAME: "Cannot find name 'xyz'"
   - CAUSE: Variable/function used but not imported or defined
   - CHECK RELATED FILES: Look at provided context for exported functions
   - COMMON FIXES:
     a. If 'xyz' is exported from another file, add import: import { xyz } from '../service'
     b. If using service methods: authService.login() not just login()
     c. Check for typos: 'alidateSession' should be 'validateSession'
   - IMPORTANT: When you see RELATED FILES in context, use those exports!

7. CANNOT FIND MODULE: "Cannot find module './xyz'"
   - CAUSE: Import path doesn't match file structure
   - FIX: Use correct relative path: '../component-name' not '../component-name/index'

Guidelines:
- Fix ALL reported errors
- Maintain original functionality
- Keep changes minimal
- Preserve existing style
- Don't introduce new issues
- RETURN COMPLETE FILE - no truncation!

Response format (JSON):
{
  "fixedCode": "// Complete fixed code here",
  "explanation": "What was fixed and why",
  "allErrorsFixed": true,
  "remainingErrors": ["Any errors that couldn't be fixed"]
}`,

  build: (params: Record<string, unknown>): string => {
    const code = params.code as string || '';
    const errors = params.errors as string || '';
    const context = params.context as string || '';
    const previousAttempts = params.previousAttempts as number || 0;

    return `Fix the following code issues:

=== ORIGINAL CODE ===
\`\`\`typescript
${code}
\`\`\`

=== ERRORS TO FIX ===
${errors}

${context ? `=== CONTEXT ===\n${context}\n` : ''}
${previousAttempts > 0 ? `=== NOTE ===\nThis is attempt ${previousAttempts + 1}. Previous fixes were incomplete.\n` : ''}

Fix ALL reported errors while:
- Maintaining original functionality
- Keeping changes minimal
- Preserving existing style

Provide the complete fixed code in the specified JSON format.`;
  },
};

/**
 * Test generation prompt - generates comprehensive tests
 */
export const GENERATE_TESTS_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert test engineer generating comprehensive API tests.

Your task is to generate tests that verify API endpoints work correctly using supertest.

CRITICAL: The generated code exports:
1. A function named 'start()' that starts the HTTP server
2. The express 'app' instance for testing

You MUST use supertest to test the express app directly WITHOUT starting the server.

Testing principles:
1. Test actual HTTP endpoints, not internal functions
2. Use supertest to make real HTTP requests
3. Test all CRUD operations: list all, get one, create, update, delete
4. Test error cases (404 for missing resources)
5. Each test should be independent

REQUIRED TEST PATTERN for API testing:
\`\`\`typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index.js';

describe('Task API', () => {
  // Test health endpoint
  it('GET /health should return status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  // Test create
  it('POST /tasks should create a task', async () => {
    const response = await request(app)
      .post('/tasks')
      .send({ title: 'Test Task', description: 'Test Description' });
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.title).toBe('Test Task');
  });

  // Test list all
  it('GET /tasks should return array of tasks', async () => {
    const response = await request(app).get('/tasks');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  // Test get one
  it('GET /tasks/:id should return the task', async () => {
    // First create a task
    const createResponse = await request(app)
      .post('/tasks')
      .send({ title: 'Test' });
    const taskId = createResponse.body.id;

    // Then get it
    const response = await request(app).get(\`/tasks/\${taskId}\`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(taskId);
  });

  // Test 404
  it('GET /tasks/:id should return 404 for missing task', async () => {
    const response = await request(app).get('/tasks/nonexistent');
    expect(response.status).toBe(404);
  });
});
\`\`\`

CRITICAL REQUIREMENTS:
- Import { app } from the component, NOT { start }
- Use supertest with the app directly: request(app)
- Do NOT call start() in tests - supertest handles it
- Use .send() for POST/PUT body data
- Check response.status and response.body
- Test both success and error cases

Response format (JSON):
{
  "files": [
    {
      "path": "src/<component-name>/<ComponentName>.test.ts",
      "content": "// Complete test file content",
      "language": "typescript",
      "purpose": "API integration tests for ComponentName",
      "isNew": true,
      "covers": ["GET /health", "GET /tasks", "POST /tasks", "GET /tasks/:id", "PUT /tasks/:id", "DELETE /tasks/:id"],
      "framework": "vitest",
      "testCount": 8,
      "testTypes": ["integration"]
    }
  ],
  "testCount": 8,
  "explanation": "Coverage explanation"
}`,

  build: (params: Record<string, unknown>): string => {
    const component = params.component as string || '';
    const code = params.code as string || '';
    const framework = params.framework as string || 'vitest';
    const coverageTarget = params.coverageTarget as number || 80;

    return `Generate comprehensive API tests using supertest for the following component:

=== COMPONENT SPECIFICATION ===
${component}

=== IMPLEMENTATION ===
\`\`\`typescript
${code}
\`\`\`

=== TEST FRAMEWORK ===
${framework} with supertest

=== COVERAGE TARGET ===
${coverageTarget}%

CRITICAL REQUIREMENTS:
1. Import { app } from the implementation file (NOT start)
2. Use supertest: import request from 'supertest';
3. Test ALL endpoints in the code
4. Test success cases (200, 201, 204)
5. Test error cases (404 for missing resources)
6. Do NOT call start() in tests

Provide your tests in the specified JSON format.`;
  },
};

/**
 * Incident reconstruction prompt - uses 1M context to rebuild incident timeline
 */
export const RECONSTRUCT_INCIDENT_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert incident investigator with access to comprehensive system data.

You have access to Gemini 3's 1 MILLION token context window. Use this to:
1. Analyze ALL available data simultaneously
2. Build a precise, complete timeline
3. Identify the causal chain from trigger to symptoms
4. Determine the true root cause (not just symptoms)
5. Generate actionable recommendations

Your unique capability: You can correlate logs, metrics, screenshots, and K8s events
all at once, finding patterns that chunked analysis would miss.

Analysis methodology:
1. Identify the TRIGGER EVENT - what started the cascade
2. Trace the CAUSAL CHAIN - how the trigger led to symptoms
3. Distinguish ROOT CAUSE from SYMPTOMS
4. Generate SPECIFIC recommendations based on evidence

Causal relationship types:
- DIRECT: A caused B immediately (deployment → errors)
- CASCADING: A caused B caused C (memory leak → OOM → restarts)
- CONTRIBUTING: A made B worse (high traffic + memory leak → faster OOM)

Response format (JSON):
{
  "timeline": [
    {
      "timestamp": "ISO8601 timestamp",
      "event": "What happened",
      "service": "Affected service",
      "severity": "info|warning|error|critical",
      "evidence": "What data supports this",
      "isKeyEvent": true
    }
  ],
  "causalChain": [
    {
      "id": "unique-id",
      "event": "Event description (must not be null or empty)",
      "causedBy": "id or description of causing event. For the root cause event (first in chain), use 'Root Cause' or 'Initial Trigger' - NEVER null or empty",
      "causedEvents": ["ids of events this caused"],
      "relationship": "direct|cascading|contributing"
    }
  ],
  "rootCause": {
    "description": "Clear description of the root cause",
    "confidence": 0.0-1.0,
    "evidence": ["Supporting evidence 1", "Evidence 2"],
    "differentFromSymptoms": "How this differs from visible symptoms"
  },
  "recommendations": [
    {
      "priority": "high|medium|low",
      "category": "prevention|detection|response|architecture",
      "action": "What to do",
      "rationale": "Why this helps",
      "implementation": "How to implement"
    }
  ],
  "narrative": "Human-readable story of the incident (2-3 paragraphs)",
  "dataQuality": {
    "completeness": 0.0-1.0,
    "gaps": ["Missing data that would have helped"],
    "recommendations": ["How to improve data collection"]
  }
}`,

  build: (params: Record<string, unknown>): string => {
    const logs = params.logs as string || '';
    const metrics = params.metrics as string || '';
    const screenshots = params.screenshots as string || '';
    const events = params.events as string || '';
    const deployments = params.deployments as string || '';
    const timeRange = params.timeRange as { start: string; end: string } || {};

    const sections: string[] = [
      '=== INCIDENT RECONSTRUCTION REQUEST ===',
      '',
      `Time range: ${timeRange.start || 'Unknown'} to ${timeRange.end || 'Unknown'}`,
      '',
      'Analyze ALL available data to reconstruct the complete incident.',
      '',
    ];

    if (logs) {
      const logLines = logs.split('\n').length;
      sections.push(`--- LOGS (${logLines} lines) ---`);
      sections.push(logs);
      sections.push('');
    }

    if (metrics) {
      sections.push('--- METRICS ---');
      sections.push(metrics);
      sections.push('');
    }

    if (screenshots) {
      sections.push('--- DASHBOARD SCREENSHOTS ---');
      sections.push(screenshots);
      sections.push('');
    }

    if (events) {
      sections.push('--- KUBERNETES EVENTS ---');
      sections.push(events);
      sections.push('');
    }

    if (deployments) {
      sections.push('--- DEPLOYMENT HISTORY ---');
      sections.push(deployments);
      sections.push('');
    }

    sections.push('--- ANALYSIS INSTRUCTIONS ---');
    sections.push('1. Build a complete timeline from ALL data');
    sections.push('2. Identify the trigger event that started the incident');
    sections.push('3. Trace the causal chain from trigger to symptoms');
    sections.push('4. Determine the TRUE root cause (not symptoms)');
    sections.push('5. Generate specific, actionable recommendations');
    sections.push('');
    sections.push('Provide your analysis in the specified JSON format.');

    return sections.join('\n');
  },
};

/**
 * Pattern learning prompt - extracts reusable patterns from resolved incidents
 */
export const LEARN_PATTERN_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, a machine learning system extracting patterns from incident resolutions.

Your task is to identify reusable patterns that can improve future incident detection and response.

Pattern types:
1. DETECTION PATTERNS - signals that indicate an incident is starting
2. DIAGNOSTIC PATTERNS - evidence correlations that identify root causes
3. RESOLUTION PATTERNS - actions that successfully resolve specific issues
4. PREVENTION PATTERNS - changes that prevent recurrence

Pattern quality criteria:
- SPECIFIC enough to match relevant incidents
- GENERAL enough to apply to similar situations
- ACTIONABLE with clear detection/response steps
- VALIDATED by successful resolution

Response format (JSON):
{
  "patterns": [
    {
      "type": "detection|diagnostic|resolution|prevention",
      "name": "Pattern name",
      "description": "What this pattern captures",
      "triggerConditions": [
        {
          "signal": "What to look for",
          "threshold": "When to trigger",
          "source": "logs|metrics|events|visual"
        }
      ],
      "recommendedActions": [
        {
          "action": "What to do",
          "when": "When to take this action",
          "expectedOutcome": "What should happen"
        }
      ],
      "confidence": 0.0-1.0,
      "applicability": "Description of when this pattern applies",
      "exceptions": ["When NOT to apply this pattern"]
    }
  ],
  "insights": ["General insight 1", "Insight 2"],
  "improvementSuggestions": ["How to improve detection/response"]
}`,

  build: (params: Record<string, unknown>): string => {
    const incident = params.incident as string || '';
    const resolution = params.resolution as string || '';
    const existingPatterns = params.existingPatterns as string || '';

    return `Learn patterns from the following resolved incident:

=== INCIDENT DETAILS ===
${incident}

=== RESOLUTION ===
${resolution}

${existingPatterns ? `=== EXISTING PATTERNS ===\nDo not duplicate these:\n${existingPatterns}\n` : ''}

Extract patterns that can:
1. Detect similar incidents earlier
2. Diagnose root causes faster
3. Resolve issues more effectively
4. Prevent future occurrences

Provide your patterns in the specified JSON format.`;
  },
};

/**
 * All-tests generation prompt - generates comprehensive tests for ALL components in a single call
 * Uses 1M context window to ensure test consistency and proper coverage
 */
export const GENERATE_ALL_TESTS_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, an expert test engineer generating comprehensive API tests for an entire application.

You have access to a 1 MILLION TOKEN context window - use it to generate ALL tests for ALL components in a SINGLE call.
This ensures tests are consistent, don't duplicate setup code, and properly cover the entire API.

CRITICAL: The generated code exports:
1. A function named 'start()' that starts the HTTP server
2. The express 'app' instance for testing

You MUST use supertest to test the express app directly WITHOUT starting the server.

Testing principles:
1. Test actual HTTP endpoints, not internal functions
2. Use supertest to make real HTTP requests
3. Test all CRUD operations: list all, get one, create, update, delete
4. Test error cases (404 for missing resources, 400 for validation)
5. Each test should be independent

REQUIRED TEST PATTERN for API testing:
\`\`\`typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index.js';

describe('Task API', () => {
  // Test health endpoint
  it('GET /health should return status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  // Test create
  it('POST /tasks should create a task', async () => {
    const response = await request(app)
      .post('/tasks')
      .send({ title: 'Test Task', description: 'Test Description' });
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.title).toBe('Test Task');
  });

  // Test list all
  it('GET /tasks should return array of tasks', async () => {
    const response = await request(app).get('/tasks');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  // Test get one
  it('GET /tasks/:id should return the task', async () => {
    // First create a task
    const createResponse = await request(app)
      .post('/tasks')
      .send({ title: 'Test' });
    const taskId = createResponse.body.id;

    // Then get it
    const response = await request(app).get(\`/tasks/\${taskId}\`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(taskId);
  });

  // Test 404
  it('GET /tasks/:id should return 404 for missing task', async () => {
    const response = await request(app).get('/tasks/nonexistent');
    expect(response.status).toBe(404);
  });
});
\`\`\`

CRITICAL REQUIREMENTS:
- Import { app } from the component, NOT { start }
- Use supertest with the app directly: request(app)
- Do NOT call start() in tests - supertest handles it
- Use .send() for POST/PUT body data
- Check response.status and response.body
- Test both success and error cases
- Generate ONE test file per component

Response format (JSON):
{
  "files": [
    {
      "path": "src/<component-name>/<ComponentName>.test.ts",
      "content": "// Complete test file content",
      "language": "typescript",
      "purpose": "API integration tests for ComponentName",
      "isNew": true,
      "covers": ["GET /health", "GET /tasks", "POST /tasks", "GET /tasks/:id"],
      "framework": "vitest",
      "testCount": 8,
      "testTypes": ["integration"]
    }
  ],
  "testCount": 8,
  "explanation": "Coverage explanation"
}`,

  build: (params: Record<string, unknown>): string => {
    const allComponents = params.allComponents as string || '[]';
    const allCode = params.allCode as string || '[]';
    const framework = params.framework as string || 'vitest';
    const coverageTarget = params.coverageTarget as number || 80;
    const schemaContext = params.schemaContext as string | undefined;

    // V2: Include schema context if provided for accurate test data
    const schemaSection = schemaContext ? `
=== SCHEMA CONTEXT (CRITICAL) ===
The following Zod schema defines the EXACT fields that the API validates.
Use ONLY these field names in test request bodies - NOT username, NOT password, but the ACTUAL fields shown below:
${schemaContext}

When generating test data for POST/PUT requests, use the 'createFields' and 'updateFields' arrays.
Each field has a 'type' that tells you what test value to use (e.g., email -> 'test@example.com').
` : '';

    return `Generate comprehensive API tests using supertest for ALL components in this application.

=== ALL COMPONENTS ===
${allComponents}

=== ALL SOURCE CODE ===
${allCode}
${schemaSection}
=== TEST FRAMEWORK ===
${framework} with supertest

=== COVERAGE TARGET ===
${coverageTarget}%

CRITICAL REQUIREMENTS:
1. Generate ONE test file per App/API component
2. Import { app } from the implementation file (NOT start)
3. Use supertest: import request from 'supertest';
4. Test ALL endpoints in each component
5. Test success cases (200, 201, 204)
6. Test error cases (404, 400 for validation)
7. Do NOT call start() in tests
8. ${schemaContext ? 'CRITICAL: Use the EXACT field names from the SCHEMA CONTEXT section - not generic names like "username" or "password"' : 'Use appropriate test data for request bodies'}

Generate tests for ALL components that have HTTP endpoints.
Provide your tests in the specified JSON format.`;
  },
};

/**
 * V2: Schema generation prompt - generates Zod schemas BEFORE code
 * This enables schema-first generation for improved type safety
 */
export const GENERATE_SCHEMA_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, generating Zod schemas for TypeScript APIs.

Your task is to generate the COMPLETE type system BEFORE any code is written.
This schema will CONSTRAIN all downstream code generation.

SCHEMA GENERATION RULES:
1. Main entity schema: All fields the entity has (id, timestamps, data fields)
2. Create schema: Only fields needed for creation (no id, timestamps)
3. Update schema: All editable fields as optional (for partial updates)
4. Types derived from schemas: type X = z.infer<typeof XSchema>

FIELD TYPE MAPPING:
• String fields: z.string()
• Email fields: z.string().email()
• UUID fields: z.string().uuid()
• Integer fields: z.number().int()
• Boolean fields: z.boolean()
• Enum fields: z.enum(['value1', 'value2'])
• DateTime fields: z.string().datetime()
• Optional fields: .optional() at the end
• Nullable fields: .nullable() at the end
• With default: .default(value) at the end

CRITICAL RULES:
• Create schema: Required fields have NO .optional()
• Update schema: ALL fields have .optional()
• NEVER use 'as' casting - always use Schema.parse()

Output JSON:
{
  "resourceName": "user",
  "resourceNamePlural": "users",
  "fields": [
    { "name": "id", "type": "string", "zodType": "z.string().uuid()", "required": true, "inCreate": false, "inUpdate": false },
    { "name": "email", "type": "string", "zodType": "z.string().email()", "required": true, "inCreate": true, "inUpdate": true }
  ],
  "entitySchema": "const UserSchema = z.object({...});",
  "createSchema": "const CreateUserSchema = z.object({...});",
  "updateSchema": "const UpdateUserSchema = z.object({...});"
}`,

  build: (params: Record<string, unknown>): string => {
    const requirement = params.requirement as string || '';
    const acceptanceCriteria = params.acceptanceCriteria as string[] || [];

    return `Generate Zod schemas for the following API:

REQUIREMENT:
${requirement}

ACCEPTANCE CRITERIA:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Analyze the requirement and generate:
1. The main entity schema with all fields
2. The create input schema (required fields for creation)
3. The update input schema (optional fields for partial updates)
4. TypeScript type derivations

Be thorough - include all fields implied by the requirement.
`;
  },
};

/**
 * V2: Instant fix prompt - fixes specific pattern violations quickly
 * Used after FastValidator detects issues that can't be auto-fixed
 */
export const INSTANT_FIX_PROMPT: PromptTemplate = {
  system: `You are ChronosOps, fixing specific code pattern violations.

You will receive:
1. Original code with specific pattern violations
2. The exact violations found
3. The correct patterns to use

Your job: Fix ONLY the violations. Keep everything else the same.

COMMON FIXES:

REQ_BODY_AS_CAST:
- Before: const input = req.body as CreateUserInput;
- After: const input = CreateUserSchema.parse(req.body);
- Also add: import { z } from 'zod' if missing
- Also add: try/catch with ZodError handling

UUID_PACKAGE:
- Before: import { v4 as uuidv4 } from 'uuid';
- After: import { randomUUID } from 'crypto';
- Replace: uuidv4() → randomUUID()

EXPRESS_NAMESPACE:
- Before: express.Request, express.Response
- After: Request, Response (from import)

MISSING_TRY_CATCH:
- Wrap Schema.parse calls in try/catch
- Add ZodError handling with 400 response

DESTRUCTURE_UNVALIDATED:
- Before: const { email } = req.body;
- After: const input = Schema.parse(req.body); then use input.email

Output the complete fixed code. Only fix the specified violations.`,

  build: (params: Record<string, unknown>): string => {
    const code = params.code as string || '';
    const violations = params.violations as string[] || [];
    const correctPatterns = params.correctPatterns as string || '';

    return `Fix these specific violations:

VIOLATIONS:
${violations.map(v => `• ${v}`).join('\n')}

CORRECT PATTERNS TO USE:
${correctPatterns}

ORIGINAL CODE:
\`\`\`typescript
${code}
\`\`\`

Output the complete fixed code with ONLY these violations fixed.
Keep all other code exactly the same.
`;
  },
};

/**
 * Prompt for AI-powered OpenAPI spec enhancement
 * 
 * This prompt analyzes source code to generate a complete, accurate OpenAPI 3.0 spec
 * with proper security schemes, parameters, request bodies, and response schemas.
 */
export const ENHANCE_OPENAPI_SPEC_PROMPT: PromptTemplate = {
  system: `You are an expert API documentation specialist. Your job is to analyze source code
and generate a COMPLETE, ACCURATE OpenAPI 3.0 specification.

You will be given:
1. The source code of an API (TypeScript/Express)
2. An existing OpenAPI spec (which may be incomplete or missing details)

Your task is to:
1. Analyze ALL route handlers in the source code
2. Identify ALL endpoints, methods, parameters, request bodies, and responses
3. Detect authentication patterns (Authorization headers, Bearer tokens, API keys)
4. Extract Zod schemas and convert them to OpenAPI schemas
5. Generate a COMPLETE OpenAPI 3.0 spec that matches the actual code behavior

CRITICAL ANALYSIS RULES:

1. AUTHENTICATION DETECTION:
   - Look for: req.headers.authorization, req.headers['authorization'], Bearer token patterns
   - Look for: req.cookies, session tokens, API keys
   - If you see: const token = req.headers.authorization?.replace('Bearer ', '')
     → Add security scheme: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
     → Add to endpoint: security: [{ bearerAuth: [] }]
     → Add parameter: { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' }, description: 'Bearer token' }

2. PARAMETER DETECTION:
   - Path parameters: /users/{id} → parameters: [{ name: 'id', in: 'path', required: true }]
   - Query parameters: req.query.page → parameters: [{ name: 'page', in: 'query', required: false }]
   - Header parameters: req.headers.x-api-key → parameters: [{ name: 'X-API-Key', in: 'header' }]

3. REQUEST BODY DETECTION:
   - Look for: Schema.parse(req.body), req.body, CreateSchema, UpdateSchema
   - Convert Zod schemas to OpenAPI schemas in components.schemas
   - Every POST/PUT/PATCH should have requestBody with schema reference

4. RESPONSE DETECTION:
   - Look for: res.json({...}), res.status(XXX).json({...})
   - Map response codes: 200, 201, 204, 400, 401, 403, 404, 500
   - Include content schemas for JSON responses

5. ZOD TO OPENAPI CONVERSION:
   - z.string() → { type: 'string' }
   - z.string().email() → { type: 'string', format: 'email' }
   - z.string().uuid() → { type: 'string', format: 'uuid' }
   - z.number() → { type: 'number' }
   - z.boolean() → { type: 'boolean' }
   - z.array(z.string()) → { type: 'array', items: { type: 'string' } }
   - z.object({...}) → { type: 'object', properties: {...} }
   - .optional() → field NOT in required array

OUTPUT REQUIREMENTS:
- Return a COMPLETE OpenAPI 3.0 spec
- Include ALL endpoints from the source code
- Include security schemes if authentication is detected
- Include parameters for ALL path/query/header params
- Include requestBody for ALL POST/PUT/PATCH endpoints
- Include response content schemas
- Include components.schemas for all referenced schemas`,

  build: (params: Record<string, unknown>): string => {
    const sourceCode = params.sourceCode as string || '';
    const existingSpec = params.existingSpec as string || '{}';
    const routes = params.routes as string[] || [];
    const apiName = params.apiName as string || 'API';

    const routesList = routes.map(r => '• ' + r).join('\n');

    return `Analyze this API source code and generate a complete OpenAPI 3.0 specification.

API NAME: ${apiName}

DETECTED ROUTES (from code analysis):
${routesList}

EXISTING OPENAPI SPEC (may be incomplete):
\`\`\`json
${existingSpec}
\`\`\`

SOURCE CODE TO ANALYZE:
\`\`\`typescript
${sourceCode}
\`\`\`

TASK:
1. Compare the detected routes with the existing OpenAPI spec paths
2. For each route, analyze the handler to understand:
   - What HTTP method it uses
   - What parameters it expects (path, query, header)
   - What request body it expects (from Zod schemas or req.body usage)
   - What authentication it requires (Authorization header, tokens, etc.)
   - What responses it returns (status codes, body shapes)
3. Generate a COMPLETE OpenAPI 3.0 spec that accurately documents ALL endpoints

IMPORTANT:
- If you see "Authorization" header usage or Bearer token checks, ADD:
  - securitySchemes with bearerAuth
  - security requirement on the endpoint
  - Authorization header parameter so users can input the token in Swagger UI
- Every POST/PUT must have requestBody
- Every endpoint must have complete responses

CRITICAL OUTPUT FORMAT - READ CAREFULLY:

FORBIDDEN (never do this):
- Do NOT return any TypeScript/JavaScript code
- Do NOT include function definitions, imports, const declarations
- Do NOT wrap the JSON in markdown code blocks (\`\`\`json)
- Do NOT include any explanatory text before or after the JSON
- Do NOT include "const openApiSpec = " or any variable assignment
- Do NOT include the source code you analyzed in your response

REQUIRED:
- Return ONLY a raw JSON object
- Start your response with the opening brace {
- End your response with the closing brace }
- The root object MUST have "openapi", "info", and "paths" properties
- Response must be valid JSON that can be parsed with JSON.parse()

INCORRECT (do NOT do this):
\`\`\`json
{ "openapi": "3.0.0" }
\`\`\`

INCORRECT (do NOT do this):
const openApiSpec = { "openapi": "3.0.0" };

INCORRECT (do NOT do this):
Here's the enhanced OpenAPI spec:
{ "openapi": "3.0.0" }

CORRECT (do exactly this):
{"openapi":"3.0.0","info":{"title":"API Name","version":"1.0.0"},"paths":{...},"components":{...}}

Return the complete enhanced OpenAPI spec as raw JSON, nothing else.`;
  },
};
