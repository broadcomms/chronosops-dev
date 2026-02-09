/**
 * Golden Templates Library
 *
 * Complete, working API examples for template-driven code generation.
 * Each template passes FastValidator checks and follows all required patterns.
 *
 * Usage: Include relevant templates in Gemini prompt context to guide generation.
 * The model should adapt template patterns, only changing resource names and fields.
 */

// =============================================================================
// GOLDEN TEMPLATE 1: User CRUD API
// Complete user management with authentication fields + API documentation
// =============================================================================

export const USER_API_TEMPLATE = `
// ============================================================================
// USER API - Complete CRUD with Zod validation + API Documentation
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'User API',
  version: '1.0.0',
  description: 'User management REST API with CRUD operations',
};

// ============================================================================
// SCHEMAS (Always at top, before routes)
// ============================================================================

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateUserSchema = z.object({
  email: z.string().email(),           // REQUIRED - no .optional()
  name: z.string().min(1).max(100),    // REQUIRED - no .optional()
  role: z.enum(['admin', 'user']).default('user'),
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
});

// Type derivations (single source of truth)
type User = z.infer<typeof UserSchema>;
type CreateUserInput = z.infer<typeof CreateUserSchema>;
type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: API_INFO.name,
    version: API_INFO.version,
    description: API_INFO.description,
  },
  paths: {
    '/': {
      get: {
        summary: 'API Information',
        operationId: 'getApiInfo',
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/users': {
      get: {
        summary: 'List all users',
        operationId: 'listUsers',
        tags: ['Users'],
        responses: {
          '200': {
            description: 'Array of users',
            content: {
              'application/json': {
                schema: { type: 'array', items: { '$ref': '#/components/schemas/User' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a user',
        operationId: 'createUser',
        tags: ['Users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/CreateUser' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created user',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/User' } } },
          },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/users/{id}': {
      get: {
        summary: 'Get user by ID',
        operationId: 'getUserById',
        tags: ['Users'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'User found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/User' } } },
          },
          '404': { description: 'User not found' },
        },
      },
      put: {
        summary: 'Update user',
        operationId: 'updateUser',
        tags: ['Users'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/UpdateUser' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated user',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/User' } } },
          },
          '400': { description: 'Validation error' },
          '404': { description: 'User not found' },
        },
      },
      delete: {
        summary: 'Delete user',
        operationId: 'deleteUser',
        tags: ['Users'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'User deleted' },
          '404': { description: 'User not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          role: { type: 'string', enum: ['admin', 'user'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'email', 'name', 'role', 'createdAt', 'updatedAt'],
      },
      CreateUser: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          role: { type: 'string', enum: ['admin', 'user'], default: 'user' },
        },
        required: ['email', 'name'],
      },
      UpdateUser: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    },
  },
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
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

// ============================================================================
// STORAGE
// ============================================================================

const users = new Map<string, User>();

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});

// OpenAPI specification
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH & METRICS ENDPOINTS (REQUIRED)
// ============================================================================

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// BUSINESS ROUTES
// ============================================================================

// List all users (REQUIRED for every POST resource)
app.get('/users', (_req: Request, res: Response) => {
  res.json(Array.from(users.values()));
});

// Get user by ID
app.get('/users/:id', (req: Request, res: Response) => {
  const user = users.get(req.params.id as string);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// Create user (with Zod validation in try/catch)
app.post('/users', (req: Request, res: Response) => {
  try {
    const input = CreateUserSchema.parse(req.body);

    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };

    users.set(user.id, user);
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (with Zod validation in try/catch)
app.put('/users/:id', (req: Request, res: Response) => {
  const user = users.get(req.params.id as string);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  try {
    const input = UpdateUserSchema.parse(req.body);

    const updated: User = {
      ...user,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    users.set(user.id, updated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
app.delete('/users/:id', (req: Request, res: Response) => {
  if (!users.has(req.params.id as string)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  users.delete(req.params.id as string);
  res.status(204).send();
});

// ============================================================================
// EXPORTS (REQUIRED)
// ============================================================================

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  API Root:    http://localhost:\${PORT}/\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
    console.log(\`  OpenAPI:     http://localhost:\${PORT}/openapi.json\`);
    console.log(\`  Health:      http://localhost:\${PORT}/health\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 2: Task/Todo API
// Task management with completion status
// =============================================================================

export const TASK_API_TEMPLATE = `
// ============================================================================
// TASK API - Todo/Task management with status tracking
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ============================================================================
// SCHEMAS
// ============================================================================

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['low', 'medium', 'high']),
  dueDate: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().datetime().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().datetime().optional(),
});

type Task = z.infer<typeof TaskSchema>;
type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Task API',
  version: '1.0.0',
  description: 'Task management REST API with status tracking',
};

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: API_INFO.name,
    version: API_INFO.version,
    description: API_INFO.description,
  },
  paths: {
    '/': {
      get: {
        summary: 'API Information',
        operationId: 'getApiInfo',
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/tasks': {
      get: {
        summary: 'List all tasks',
        operationId: 'listTasks',
        tags: ['Tasks'],
        responses: {
          '200': {
            description: 'Array of tasks',
            content: {
              'application/json': {
                schema: { type: 'array', items: { '$ref': '#/components/schemas/Task' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a task',
        operationId: 'createTask',
        tags: ['Tasks'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/CreateTask' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created task',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Task' } } },
          },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/tasks/{id}': {
      get: {
        summary: 'Get task by ID',
        operationId: 'getTaskById',
        tags: ['Tasks'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Task found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Task' } } },
          },
          '404': { description: 'Task not found' },
        },
      },
      put: {
        summary: 'Update task',
        operationId: 'updateTask',
        tags: ['Tasks'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/UpdateTask' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated task',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Task' } } },
          },
          '400': { description: 'Validation error' },
          '404': { description: 'Task not found' },
        },
      },
      delete: {
        summary: 'Delete task',
        operationId: 'deleteTask',
        tags: ['Tasks'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'Task deleted' },
          '404': { description: 'Task not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueDate: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'title', 'status', 'priority', 'createdAt', 'updatedAt'],
      },
      CreateTask: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
          priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
          dueDate: { type: 'string', format: 'date-time' },
        },
        required: ['title'],
      },
      UpdateTask: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueDate: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
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

// ============================================================================
// STORAGE
// ============================================================================

const tasks = new Map<string, Task>();

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});

// OpenAPI specification
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH & BUSINESS ROUTES
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/tasks', (_req: Request, res: Response) => {
  res.json(Array.from(tasks.values()));
});

app.get('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

app.post('/tasks', (req: Request, res: Response) => {
  try {
    const input = CreateTaskSchema.parse(req.body);

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: 'pending',
      priority: input.priority,
      dueDate: input.dueDate,
      createdAt: now,
      updatedAt: now,
    };

    tasks.set(task.id, task);
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    const input = UpdateTaskSchema.parse(req.body);

    const updated: Task = {
      ...task,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    tasks.set(task.id, updated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/tasks/:id', (req: Request, res: Response) => {
  if (!tasks.has(req.params.id as string)) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  tasks.delete(req.params.id as string);
  res.status(204).send();
});

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  API Root:    http://localhost:\${PORT}/\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
    console.log(\`  OpenAPI:     http://localhost:\${PORT}/openapi.json\`);
    console.log(\`  Health:      http://localhost:\${PORT}/health\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 3: Product API
// E-commerce product management
// =============================================================================

export const PRODUCT_API_TEMPLATE = `
// ============================================================================
// PRODUCT API - E-commerce product management
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ============================================================================
// SCHEMAS
// ============================================================================

const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  category: z.string().min(1).max(100),
  inStock: z.boolean(),
  quantity: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
  category: z.string().min(1).max(100),
  quantity: z.number().int().min(0).default(0),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().positive().optional(),
  currency: z.enum(['USD', 'EUR', 'GBP']).optional(),
  category: z.string().min(1).max(100).optional(),
  inStock: z.boolean().optional(),
  quantity: z.number().int().min(0).optional(),
});

type Product = z.infer<typeof ProductSchema>;
type CreateProductInput = z.infer<typeof CreateProductSchema>;
type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Product API',
  version: '1.0.0',
  description: 'E-commerce product management REST API',
};

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: API_INFO.name,
    version: API_INFO.version,
    description: API_INFO.description,
  },
  paths: {
    '/': {
      get: {
        summary: 'API Information',
        operationId: 'getApiInfo',
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/products': {
      get: {
        summary: 'List all products',
        operationId: 'listProducts',
        tags: ['Products'],
        responses: {
          '200': {
            description: 'Array of products',
            content: {
              'application/json': {
                schema: { type: 'array', items: { '$ref': '#/components/schemas/Product' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a product',
        operationId: 'createProduct',
        tags: ['Products'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/CreateProduct' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created product',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Product' } } },
          },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/products/{id}': {
      get: {
        summary: 'Get product by ID',
        operationId: 'getProductById',
        tags: ['Products'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Product found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Product' } } },
          },
          '404': { description: 'Product not found' },
        },
      },
      put: {
        summary: 'Update product',
        operationId: 'updateProduct',
        tags: ['Products'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/UpdateProduct' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated product',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Product' } } },
          },
          '400': { description: 'Validation error' },
          '404': { description: 'Product not found' },
        },
      },
      delete: {
        summary: 'Delete product',
        operationId: 'deleteProduct',
        tags: ['Products'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'Product deleted' },
          '404': { description: 'Product not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          price: { type: 'number', minimum: 0 },
          currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
          category: { type: 'string', minLength: 1, maxLength: 100 },
          inStock: { type: 'boolean' },
          quantity: { type: 'integer', minimum: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'price', 'currency', 'category', 'inStock', 'quantity', 'createdAt', 'updatedAt'],
      },
      CreateProduct: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          price: { type: 'number', minimum: 0 },
          currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'], default: 'USD' },
          category: { type: 'string', minLength: 1, maxLength: 100 },
          quantity: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['name', 'price', 'category'],
      },
      UpdateProduct: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          price: { type: 'number', minimum: 0 },
          currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
          category: { type: 'string', minLength: 1, maxLength: 100 },
          inStock: { type: 'boolean' },
          quantity: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
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

// ============================================================================
// STORAGE
// ============================================================================

const products = new Map<string, Product>();

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});

// OpenAPI specification
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH & BUSINESS ROUTES
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/products', (_req: Request, res: Response) => {
  res.json(Array.from(products.values()));
});

app.get('/products/:id', (req: Request, res: Response) => {
  const product = products.get(req.params.id as string);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(product);
});

app.post('/products', (req: Request, res: Response) => {
  try {
    const input = CreateProductSchema.parse(req.body);

    const now = new Date().toISOString();
    const product: Product = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      price: input.price,
      currency: input.currency,
      category: input.category,
      inStock: input.quantity > 0,
      quantity: input.quantity,
      createdAt: now,
      updatedAt: now,
    };

    products.set(product.id, product);
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/products/:id', (req: Request, res: Response) => {
  const product = products.get(req.params.id as string);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  try {
    const input = UpdateProductSchema.parse(req.body);

    const newQuantity = input.quantity ?? product.quantity;
    const updated: Product = {
      ...product,
      ...input,
      inStock: input.inStock ?? newQuantity > 0,
      updatedAt: new Date().toISOString(),
    };

    products.set(product.id, updated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/products/:id', (req: Request, res: Response) => {
  if (!products.has(req.params.id as string)) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  products.delete(req.params.id as string);
  res.status(204).send();
});

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  API Root:    http://localhost:\${PORT}/\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
    console.log(\`  OpenAPI:     http://localhost:\${PORT}/openapi.json\`);
    console.log(\`  Health:      http://localhost:\${PORT}/health\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 4: Comment/Review API
// User-generated content with ratings
// =============================================================================

export const COMMENT_API_TEMPLATE = `
// ============================================================================
// COMMENT API - Reviews/comments with ratings
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ============================================================================
// SCHEMAS
// ============================================================================

const CommentSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  targetId: z.string().uuid(),
  targetType: z.enum(['product', 'post', 'user']),
  content: z.string().min(1).max(5000),
  rating: z.number().int().min(1).max(5).optional(),
  approved: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateCommentSchema = z.object({
  authorId: z.string().uuid(),
  targetId: z.string().uuid(),
  targetType: z.enum(['product', 'post', 'user']),
  content: z.string().min(1).max(5000),
  rating: z.number().int().min(1).max(5).optional(),
});

const UpdateCommentSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  approved: z.boolean().optional(),
});

type Comment = z.infer<typeof CommentSchema>;
type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Comment API',
  version: '1.0.0',
  description: 'Reviews and comments REST API with ratings',
};

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: API_INFO.name,
    version: API_INFO.version,
    description: API_INFO.description,
  },
  paths: {
    '/': {
      get: {
        summary: 'API Information',
        operationId: 'getApiInfo',
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/comments': {
      get: {
        summary: 'List all comments',
        operationId: 'listComments',
        tags: ['Comments'],
        responses: {
          '200': {
            description: 'Array of comments',
            content: {
              'application/json': {
                schema: { type: 'array', items: { '$ref': '#/components/schemas/Comment' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a comment',
        operationId: 'createComment',
        tags: ['Comments'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/CreateComment' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created comment',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Comment' } } },
          },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/comments/{id}': {
      get: {
        summary: 'Get comment by ID',
        operationId: 'getCommentById',
        tags: ['Comments'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Comment found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Comment' } } },
          },
          '404': { description: 'Comment not found' },
        },
      },
      put: {
        summary: 'Update comment',
        operationId: 'updateComment',
        tags: ['Comments'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/UpdateComment' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated comment',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Comment' } } },
          },
          '400': { description: 'Validation error' },
          '404': { description: 'Comment not found' },
        },
      },
      delete: {
        summary: 'Delete comment',
        operationId: 'deleteComment',
        tags: ['Comments'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'Comment deleted' },
          '404': { description: 'Comment not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          authorId: { type: 'string', format: 'uuid' },
          targetId: { type: 'string', format: 'uuid' },
          targetType: { type: 'string', enum: ['product', 'post', 'user'] },
          content: { type: 'string', minLength: 1, maxLength: 5000 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          approved: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'authorId', 'targetId', 'targetType', 'content', 'approved', 'createdAt', 'updatedAt'],
      },
      CreateComment: {
        type: 'object',
        properties: {
          authorId: { type: 'string', format: 'uuid' },
          targetId: { type: 'string', format: 'uuid' },
          targetType: { type: 'string', enum: ['product', 'post', 'user'] },
          content: { type: 'string', minLength: 1, maxLength: 5000 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['authorId', 'targetId', 'targetType', 'content'],
      },
      UpdateComment: {
        type: 'object',
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 5000 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          approved: { type: 'boolean' },
        },
      },
    },
  },
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
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

// ============================================================================
// STORAGE
// ============================================================================

const comments = new Map<string, Comment>();

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});

// OpenAPI specification
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH & BUSINESS ROUTES
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/comments', (_req: Request, res: Response) => {
  res.json(Array.from(comments.values()));
});

app.get('/comments/:id', (req: Request, res: Response) => {
  const comment = comments.get(req.params.id as string);
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.json(comment);
});

app.post('/comments', (req: Request, res: Response) => {
  try {
    const input = CreateCommentSchema.parse(req.body);

    const now = new Date().toISOString();
    const comment: Comment = {
      id: randomUUID(),
      authorId: input.authorId,
      targetId: input.targetId,
      targetType: input.targetType,
      content: input.content,
      rating: input.rating,
      approved: false,
      createdAt: now,
      updatedAt: now,
    };

    comments.set(comment.id, comment);
    res.status(201).json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/comments/:id', (req: Request, res: Response) => {
  const comment = comments.get(req.params.id as string);
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  try {
    const input = UpdateCommentSchema.parse(req.body);

    const updated: Comment = {
      ...comment,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    comments.set(comment.id, updated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/comments/:id', (req: Request, res: Response) => {
  if (!comments.has(req.params.id as string)) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  comments.delete(req.params.id as string);
  res.status(204).send();
});

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  API Root:    http://localhost:\${PORT}/\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
    console.log(\`  OpenAPI:     http://localhost:\${PORT}/openapi.json\`);
    console.log(\`  Health:      http://localhost:\${PORT}/health\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 5: Settings/Preferences API
// User settings and preferences management
// =============================================================================

export const SETTINGS_API_TEMPLATE = `
// ============================================================================
// SETTINGS API - User preferences management
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ============================================================================
// SCHEMAS
// ============================================================================

const SettingsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  theme: z.enum(['light', 'dark', 'system']),
  language: z.string().min(2).max(10),
  timezone: z.string().min(1).max(50),
  notifications: z.object({
    email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateSettingsSchema = z.object({
  userId: z.string().uuid(),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.string().min(2).max(10).default('en'),
  timezone: z.string().min(1).max(50).default('UTC'),
  notifications: z.object({
    email: z.boolean().default(true),
    push: z.boolean().default(true),
    sms: z.boolean().default(false),
  }).default({ email: true, push: true, sms: false }),
});

const UpdateSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(50).optional(),
  notifications: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    sms: z.boolean().optional(),
  }).optional(),
});

type Settings = z.infer<typeof SettingsSchema>;
type CreateSettingsInput = z.infer<typeof CreateSettingsSchema>;
type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Settings API',
  version: '1.0.0',
  description: 'User preferences and settings management REST API',
};

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: API_INFO.name,
    version: API_INFO.version,
    description: API_INFO.description,
  },
  paths: {
    '/': {
      get: {
        summary: 'API Information',
        operationId: 'getApiInfo',
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/settings': {
      get: {
        summary: 'List all settings',
        operationId: 'listSettings',
        tags: ['Settings'],
        responses: {
          '200': {
            description: 'Array of settings',
            content: {
              'application/json': {
                schema: { type: 'array', items: { '$ref': '#/components/schemas/Settings' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create settings',
        operationId: 'createSettings',
        tags: ['Settings'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/CreateSettings' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created settings',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Settings' } } },
          },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/settings/{id}': {
      get: {
        summary: 'Get settings by ID',
        operationId: 'getSettingsById',
        tags: ['Settings'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Settings found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Settings' } } },
          },
          '404': { description: 'Settings not found' },
        },
      },
      put: {
        summary: 'Update settings',
        operationId: 'updateSettings',
        tags: ['Settings'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/UpdateSettings' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated settings',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Settings' } } },
          },
          '400': { description: 'Validation error' },
          '404': { description: 'Settings not found' },
        },
      },
      delete: {
        summary: 'Delete settings',
        operationId: 'deleteSettings',
        tags: ['Settings'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '204': { description: 'Settings deleted' },
          '404': { description: 'Settings not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Settings: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          theme: { type: 'string', enum: ['light', 'dark', 'system'] },
          language: { type: 'string', minLength: 2, maxLength: 10 },
          timezone: { type: 'string', minLength: 1, maxLength: 50 },
          notifications: {
            type: 'object',
            properties: {
              email: { type: 'boolean' },
              push: { type: 'boolean' },
              sms: { type: 'boolean' },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'userId', 'theme', 'language', 'timezone', 'notifications', 'createdAt', 'updatedAt'],
      },
      CreateSettings: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid' },
          theme: { type: 'string', enum: ['light', 'dark', 'system'], default: 'system' },
          language: { type: 'string', minLength: 2, maxLength: 10, default: 'en' },
          timezone: { type: 'string', minLength: 1, maxLength: 50, default: 'UTC' },
          notifications: {
            type: 'object',
            properties: {
              email: { type: 'boolean', default: true },
              push: { type: 'boolean', default: true },
              sms: { type: 'boolean', default: false },
            },
          },
        },
        required: ['userId'],
      },
      UpdateSettings: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: ['light', 'dark', 'system'] },
          language: { type: 'string', minLength: 2, maxLength: 10 },
          timezone: { type: 'string', minLength: 1, maxLength: 50 },
          notifications: {
            type: 'object',
            properties: {
              email: { type: 'boolean' },
              push: { type: 'boolean' },
              sms: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
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

// ============================================================================
// STORAGE
// ============================================================================

const settings = new Map<string, Settings>();

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
  });
});

// OpenAPI specification
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH & BUSINESS ROUTES
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/settings', (_req: Request, res: Response) => {
  res.json(Array.from(settings.values()));
});

app.get('/settings/:id', (req: Request, res: Response) => {
  const setting = settings.get(req.params.id as string);
  if (!setting) {
    res.status(404).json({ error: 'Settings not found' });
    return;
  }
  res.json(setting);
});

app.post('/settings', (req: Request, res: Response) => {
  try {
    const input = CreateSettingsSchema.parse(req.body);

    const now = new Date().toISOString();
    const setting: Settings = {
      id: randomUUID(),
      userId: input.userId,
      theme: input.theme,
      language: input.language,
      timezone: input.timezone,
      notifications: input.notifications,
      createdAt: now,
      updatedAt: now,
    };

    settings.set(setting.id, setting);
    res.status(201).json(setting);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/settings/:id', (req: Request, res: Response) => {
  const setting = settings.get(req.params.id as string);
  if (!setting) {
    res.status(404).json({ error: 'Settings not found' });
    return;
  }

  try {
    const input = UpdateSettingsSchema.parse(req.body);

    const updated: Settings = {
      ...setting,
      ...input,
      notifications: input.notifications
        ? { ...setting.notifications, ...input.notifications }
        : setting.notifications,
      updatedAt: new Date().toISOString(),
    };

    settings.set(setting.id, updated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/settings/:id', (req: Request, res: Response) => {
  if (!settings.has(req.params.id as string)) {
    res.status(404).json({ error: 'Settings not found' });
    return;
  }
  settings.delete(req.params.id as string);
  res.status(204).send();
});

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  API Root:    http://localhost:\${PORT}/\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
    console.log(\`  OpenAPI:     http://localhost:\${PORT}/openapi.json\`);
    console.log(\`  Health:      http://localhost:\${PORT}/health\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 6: SQLite Database API
// CRUD API with SQLite persistence using Drizzle ORM
// =============================================================================

export const SQLITE_API_TEMPLATE = `
// ============================================================================
// NOTE API - SQLite Database with Drizzle ORM
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const app = express();
app.use(express.json());

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Note API',
  version: '1.0.0',
  description: 'Note management REST API with SQLite persistence',
};

// ============================================================================
// DATABASE SCHEMA (Drizzle ORM)
// ============================================================================

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  category: text('category', { enum: ['personal', 'work', 'idea'] }).notNull(),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// TypeScript types derived from schema
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

const DB_PATH = process.env.DATABASE_PATH || './data/app.db';

// Create database directory if it doesn't exist
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  // Directory already exists
}

// Initialize SQLite with WAL mode for better concurrency
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

// Create Drizzle ORM instance
// Explicit type annotation prevents TS4023 "cannot be named" error during declaration emit
const db: BetterSQLite3Database = drizzle(sqlite);

// Create table if not exists
sqlite.exec(\`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT NOT NULL CHECK(category IN ('personal', 'work', 'idea')),
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
\`);

// Graceful shutdown
process.on('SIGINT', () => {
  sqlite.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  sqlite.close();
  process.exit(0);
});

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

const NoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(10000).optional(),
  category: z.enum(['personal', 'work', 'idea']),
  isPinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(10000).optional(),
  category: z.enum(['personal', 'work', 'idea']).default('personal'),
  isPinned: z.boolean().default(false),
});

const UpdateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  category: z.enum(['personal', 'work', 'idea']).optional(),
  isPinned: z.boolean().optional(),
});

type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: { title: API_INFO.name, version: API_INFO.version, description: API_INFO.description },
  paths: {
    '/': { get: { summary: 'API Information', operationId: 'getApiInfo', responses: { '200': { description: 'API metadata' } } } },
    '/notes': {
      get: { summary: 'List all notes', operationId: 'listNotes', tags: ['Notes'],
        responses: { '200': { description: 'Array of notes', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Note' } } } } } }
      },
      post: {
        summary: 'Create a note', operationId: 'createNote', tags: ['Notes'],
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateNote' } } } },
        responses: { '201': { description: 'Created note', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Note' } } } }, '400': { description: 'Validation error' } }
      }
    },
    '/notes/{id}': {
      get: { summary: 'Get note by ID', operationId: 'getNoteById', tags: ['Notes'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Note found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Note' } } } }, '404': { description: 'Note not found' } }
      },
      put: { summary: 'Update note', operationId: 'updateNote', tags: ['Notes'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/UpdateNote' } } } },
        responses: { '200': { description: 'Updated note', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Note' } } } }, '400': { description: 'Validation error' }, '404': { description: 'Note not found' } }
      },
      delete: { summary: 'Delete note', operationId: 'deleteNote', tags: ['Notes'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '204': { description: 'Note deleted' }, '404': { description: 'Note not found' } }
      }
    }
  },
  components: {
    schemas: {
      Note: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, content: { type: 'string' }, category: { type: 'string', enum: ['personal', 'work', 'idea'] }, isPinned: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } }, required: ['id', 'title', 'category', 'isPinned', 'createdAt', 'updatedAt'] },
      CreateNote: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, category: { type: 'string', enum: ['personal', 'work', 'idea'] }, isPinned: { type: 'boolean' } }, required: ['title'] },
      UpdateNote: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, category: { type: 'string', enum: ['personal', 'work', 'idea'] }, isPinned: { type: 'boolean' } } }
    }
  }
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>body { margin: 0; padding: 0; }.swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>window.onload = function() { SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, presets: [SwaggerUIBundle.presets.apis] }); };</script>
</body>
</html>\`;

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

app.get('/', (_req: Request, res: Response) => {
  res.json({ ...API_INFO, docs: '/docs', openapi: '/openapi.json', health: '/health', storage: 'sqlite' });
});

app.get('/openapi.json', (_req: Request, res: Response) => { res.json(openApiSpec); });

app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH ENDPOINT
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  // Check database connectivity
  try {
    sqlite.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'connected', path: DB_PATH, timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected', path: DB_PATH });
  }
});

// ============================================================================
// BUSINESS ROUTES (Using Drizzle ORM - SYNCHRONOUS for SQLite)
// ============================================================================

// List all notes
app.get('/notes', (_req: Request, res: Response) => {
  const allNotes = db.select().from(notes).all();
  res.json(allNotes);
});

// Get note by ID
app.get('/notes/:id', (req: Request, res: Response) => {
  const note = db.select().from(notes).where(eq(notes.id, req.params.id as string)).get();
  if (!note) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  res.json(note);
});

// Create note
app.post('/notes', (req: Request, res: Response) => {
  try {
    const input = CreateNoteSchema.parse(req.body);
    const now = new Date().toISOString();
    const newNote: NewNote = {
      id: randomUUID(),
      title: input.title,
      content: input.content ?? null,
      category: input.category,
      isPinned: input.isPinned,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(notes).values(newNote).run();
    res.status(201).json(newNote);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update note
app.put('/notes/:id', (req: Request, res: Response) => {
  const existing = db.select().from(notes).where(eq(notes.id, req.params.id as string)).get();
  if (!existing) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  try {
    const input = UpdateNoteSchema.parse(req.body);
    const updated = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    db.update(notes).set(updated).where(eq(notes.id, req.params.id as string)).run();
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete note
app.delete('/notes/:id', (req: Request, res: Response) => {
  const existing = db.select().from(notes).where(eq(notes.id, req.params.id as string)).get();
  if (!existing) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  db.delete(notes).where(eq(notes.id, req.params.id as string)).run();
  res.status(204).send();
});

// ============================================================================
// EXPORTS (REQUIRED)
// ============================================================================

export { app };

export function start(): void {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  Database:    \${DB_PATH}\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
  });
}
`;

// =============================================================================
// GOLDEN TEMPLATE 7: PostgreSQL Database API
// CRUD API with PostgreSQL persistence using Drizzle ORM (async)
// =============================================================================

export const POSTGRES_API_TEMPLATE = `
// ============================================================================
// BOOKMARK API - PostgreSQL Database with Drizzle ORM
// ============================================================================

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, text, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import pg from 'pg';

const app = express();
app.use(express.json());

// ============================================================================
// API METADATA
// ============================================================================

const API_INFO = {
  name: 'Bookmark API',
  version: '1.0.0',
  description: 'Bookmark management REST API with PostgreSQL persistence',
};

// ============================================================================
// DATABASE SCHEMA (Drizzle ORM for PostgreSQL)
// ============================================================================

export const bookmarks = pgTable('bookmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  tags: text('tags'), // JSON array stored as text
  isFavorite: boolean('is_favorite').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// TypeScript types derived from schema
export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

// Build DATABASE_URL from individual env vars (avoids K8s shell expansion issues)
const DATABASE_URL = process.env.DATABASE_URL || (() => {
  const host = process.env.POSTGRES_HOST || 'chronosops-postgres.database.svc.cluster.local';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || '';
  const database = process.env.POSTGRES_DATABASE || 'postgres';
  return \`postgres://\${user}:\${password}@\${host}:\${port}/\${database}\`;
})();

let pool: pg.Pool | null = null;

// Sleep utility for retry delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Connect with exponential backoff retry
async function connectWithRetry(maxRetries: number = 5): Promise<pg.Pool> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const newPool = new pg.Pool({
        connectionString: DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // Test connection
      const client = await newPool.connect();
      await client.query('SELECT 1');
      client.release();

      console.log('PostgreSQL connected:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
      return newPool;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(\`Connection attempt \${attempt}/\${maxRetries} failed, retrying in \${delay}ms...\`);
        await sleep(delay);
      }
    }
  }
  throw lastError || new Error('Failed to connect to PostgreSQL');
}

async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = await connectWithRetry();
    pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));
  }
  return pool;
}

// Explicit type annotation prevents TS4023 "cannot be named" error during declaration emit
let db: NodePgDatabase;

// Initialize database schema
async function initializeDatabase(): Promise<void> {
  const p = await getPool();
  db = drizzle(p);

  const client = await p.connect();
  try {
    await client.query(\`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    \`);
    console.log('Database migrations completed');
  } finally {
    client.release();
  }
}

// Graceful shutdown
async function shutdown() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('PostgreSQL pool closed');
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

const BookmarkSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  isFavorite: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CreateBookmarkSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  isFavorite: z.boolean().default(false),
});

const UpdateBookmarkSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  isFavorite: z.boolean().optional(),
});

type CreateBookmarkInput = z.infer<typeof CreateBookmarkSchema>;
type UpdateBookmarkInput = z.infer<typeof UpdateBookmarkSchema>;

// ============================================================================
// OPENAPI SPECIFICATION
// ============================================================================

const openApiSpec = {
  openapi: '3.0.0',
  info: { title: API_INFO.name, version: API_INFO.version, description: API_INFO.description },
  paths: {
    '/': { get: { summary: 'API Information', operationId: 'getApiInfo', responses: { '200': { description: 'API metadata' } } } },
    '/bookmarks': {
      get: { summary: 'List all bookmarks', operationId: 'listBookmarks', tags: ['Bookmarks'],
        responses: { '200': { description: 'Array of bookmarks', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Bookmark' } } } } } }
      },
      post: {
        summary: 'Create a bookmark', operationId: 'createBookmark', tags: ['Bookmarks'],
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateBookmark' } } } },
        responses: { '201': { description: 'Created bookmark', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Bookmark' } } } }, '400': { description: 'Validation error' } }
      }
    },
    '/bookmarks/{id}': {
      get: { summary: 'Get bookmark by ID', operationId: 'getBookmarkById', tags: ['Bookmarks'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Bookmark found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Bookmark' } } } }, '404': { description: 'Bookmark not found' } }
      },
      put: { summary: 'Update bookmark', operationId: 'updateBookmark', tags: ['Bookmarks'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/UpdateBookmark' } } } },
        responses: { '200': { description: 'Updated bookmark', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Bookmark' } } } }, '400': { description: 'Validation error' }, '404': { description: 'Bookmark not found' } }
      },
      delete: { summary: 'Delete bookmark', operationId: 'deleteBookmark', tags: ['Bookmarks'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '204': { description: 'Bookmark deleted' }, '404': { description: 'Bookmark not found' } }
      }
    }
  },
  components: {
    schemas: {
      Bookmark: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, url: { type: 'string', format: 'uri' }, title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, isFavorite: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } }, required: ['id', 'url', 'title', 'isFavorite', 'createdAt', 'updatedAt'] },
      CreateBookmark: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, isFavorite: { type: 'boolean' } }, required: ['url', 'title'] },
      UpdateBookmark: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, isFavorite: { type: 'boolean' } } }
    }
  }
};

// ============================================================================
// SWAGGER UI HTML
// ============================================================================

const swaggerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${API_INFO.name} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>body { margin: 0; padding: 0; }.swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>window.onload = function() { SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, presets: [SwaggerUIBundle.presets.apis] }); };</script>
</body>
</html>\`;

// ============================================================================
// DOCUMENTATION ENDPOINTS (REQUIRED)
// ============================================================================

app.get('/', (_req: Request, res: Response) => {
  res.json({ ...API_INFO, docs: '/docs', openapi: '/openapi.json', health: '/health', storage: 'postgresql' });
});

app.get('/openapi.json', (_req: Request, res: Response) => { res.json(openApiSpec); });

app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// ============================================================================
// HEALTH ENDPOINT
// ============================================================================

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// ============================================================================
// BUSINESS ROUTES (Using Drizzle ORM - ASYNC for PostgreSQL)
// ============================================================================

// List all bookmarks
app.get('/bookmarks', async (_req: Request, res: Response) => {
  const allBookmarks = await db.select().from(bookmarks);
  // Parse tags JSON
  const parsed = allBookmarks.map(b => ({
    ...b,
    tags: b.tags ? JSON.parse(b.tags) : [],
    createdAt: b.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: b.updatedAt?.toISOString() ?? new Date().toISOString(),
  }));
  res.json(parsed);
});

// Get bookmark by ID
app.get('/bookmarks/:id', async (req: Request, res: Response) => {
  const [bookmark] = await db.select().from(bookmarks).where(eq(bookmarks.id, req.params.id as string));
  if (!bookmark) {
    res.status(404).json({ error: 'Bookmark not found' });
    return;
  }
  res.json({
    ...bookmark,
    tags: bookmark.tags ? JSON.parse(bookmark.tags) : [],
    createdAt: bookmark.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: bookmark.updatedAt?.toISOString() ?? new Date().toISOString(),
  });
});

// Create bookmark
app.post('/bookmarks', async (req: Request, res: Response) => {
  try {
    const input = CreateBookmarkSchema.parse(req.body);
    const [created] = await db.insert(bookmarks).values({
      url: input.url,
      title: input.title,
      description: input.description ?? null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      isFavorite: input.isFavorite,
    }).returning();
    res.status(201).json({
      ...created,
      tags: created.tags ? JSON.parse(created.tags) : [],
      createdAt: created.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: created.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update bookmark
app.put('/bookmarks/:id', async (req: Request, res: Response) => {
  const [existing] = await db.select().from(bookmarks).where(eq(bookmarks.id, req.params.id as string));
  if (!existing) {
    res.status(404).json({ error: 'Bookmark not found' });
    return;
  }
  try {
    const input = UpdateBookmarkSchema.parse(req.body);
    const [updated] = await db.update(bookmarks).set({
      ...(input.url && { url: input.url }),
      ...(input.title && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.tags && { tags: JSON.stringify(input.tags) }),
      ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
      updatedAt: new Date(),
    }).where(eq(bookmarks.id, req.params.id as string)).returning();
    res.json({
      ...updated,
      tags: updated.tags ? JSON.parse(updated.tags) : [],
      createdAt: updated.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: updated.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete bookmark
app.delete('/bookmarks/:id', async (req: Request, res: Response) => {
  const [existing] = await db.select().from(bookmarks).where(eq(bookmarks.id, req.params.id as string));
  if (!existing) {
    res.status(404).json({ error: 'Bookmark not found' });
    return;
  }
  await db.delete(bookmarks).where(eq(bookmarks.id, req.params.id as string));
  res.status(204).send();
});

// ============================================================================
// EXPORTS (REQUIRED)
// ============================================================================

export { app };

export async function start(): Promise<void> {
  await initializeDatabase();
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${PORT}\`);
    console.log(\`  Database:    PostgreSQL (\${DATABASE_URL.replace(/:[^:@]+@/, ':***@').split('/').pop()})\`);
    console.log(\`  API Docs:    http://localhost:\${PORT}/docs\`);
  });
}
`;

// =============================================================================
// Template Selection Helper
// =============================================================================

export interface GoldenTemplate {
  name: string;
  description: string;
  keywords: string[];
  template: string;
  /** Storage mode this template demonstrates */
  storageMode?: 'memory' | 'sqlite' | 'postgres';
}

export const GOLDEN_TEMPLATES: GoldenTemplate[] = [
  {
    name: 'User API',
    description: 'User management with authentication fields',
    keywords: ['user', 'account', 'profile', 'member', 'authentication', 'login'],
    template: USER_API_TEMPLATE,
    storageMode: 'memory',
  },
  {
    name: 'Task API',
    description: 'Task/todo management with status tracking',
    keywords: ['task', 'todo', 'item', 'checklist', 'progress', 'status'],
    template: TASK_API_TEMPLATE,
    storageMode: 'memory',
  },
  {
    name: 'Product API',
    description: 'E-commerce product management',
    keywords: ['product', 'item', 'inventory', 'catalog', 'shop', 'store', 'ecommerce'],
    template: PRODUCT_API_TEMPLATE,
    storageMode: 'memory',
  },
  {
    name: 'Comment API',
    description: 'Reviews and comments with ratings',
    keywords: ['comment', 'review', 'feedback', 'rating', 'reply', 'post'],
    template: COMMENT_API_TEMPLATE,
    storageMode: 'memory',
  },
  {
    name: 'Settings API',
    description: 'User preferences and settings management',
    keywords: ['settings', 'preferences', 'config', 'options', 'profile'],
    template: SETTINGS_API_TEMPLATE,
    storageMode: 'memory',
  },
  {
    name: 'SQLite Note API',
    description: 'Note management with SQLite persistence using Drizzle ORM',
    keywords: ['note', 'sqlite', 'database', 'persistence', 'drizzle', 'storage'],
    template: SQLITE_API_TEMPLATE,
    storageMode: 'sqlite',
  },
  {
    name: 'PostgreSQL Bookmark API',
    description: 'Bookmark management with PostgreSQL persistence using Drizzle ORM',
    keywords: ['bookmark', 'postgres', 'postgresql', 'database', 'persistence', 'drizzle', 'scalable'],
    template: POSTGRES_API_TEMPLATE,
    storageMode: 'postgres',
  },
];

/**
 * Select relevant templates based on requirement keywords and storage mode
 * @param requirement The requirement description
 * @param maxTemplates Maximum number of templates to return
 * @param storageMode Optional storage mode to prioritize matching templates
 * @returns Array of relevant templates
 */
export function selectTemplates(
  requirement: string,
  maxTemplates: number = 3,
  storageMode?: 'memory' | 'sqlite' | 'postgres'
): GoldenTemplate[] {
  const reqLower = requirement.toLowerCase();

  // Score each template based on keyword matches and storage mode
  const scored = GOLDEN_TEMPLATES.map(template => {
    let score = template.keywords.reduce((acc, keyword) => {
      return acc + (reqLower.includes(keyword) ? 1 : 0);
    }, 0);

    // Boost score significantly for matching storage mode
    if (storageMode && template.storageMode === storageMode) {
      score += 10; // Strong boost for matching storage mode
    }

    // If storage mode is specified, penalize non-matching templates
    if (storageMode && template.storageMode !== storageMode && template.storageMode !== undefined) {
      score -= 5;
    }

    return { template, score };
  });

  // Sort by score descending and return top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTemplates)
    .filter(s => s.score > 0 || maxTemplates === GOLDEN_TEMPLATES.length)
    .map(s => s.template);
}

/**
 * Build template context for Gemini prompt
 * @param requirement The requirement to match templates against
 * @param _maxTokens Approximate max tokens for templates (default 50K) - reserved for future truncation
 * @param storageMode Optional storage mode to prioritize matching templates
 * @returns Template context string for prompt injection
 */
export function buildTemplateContext(
  requirement: string,
  _maxTokens: number = 50000,
  storageMode?: 'memory' | 'sqlite' | 'postgres'
): string {
  const templates = selectTemplates(requirement, 3, storageMode);

  if (templates.length === 0 && GOLDEN_TEMPLATES[0]) {
    // No specific match, include first template as generic example
    templates.push(GOLDEN_TEMPLATES[0]);
  }

  // If storage mode specified, ensure we have at least one matching template
  if (storageMode && !templates.some(t => t.storageMode === storageMode)) {
    const storageTemplate = GOLDEN_TEMPLATES.find(t => t.storageMode === storageMode);
    if (storageTemplate) {
      templates.unshift(storageTemplate);
    }
  }

  const storageModeLabel = storageMode ? ` (${storageMode.toUpperCase()} storage)` : '';

  let context = `
═══════════════════════════════════════════════════════════════════════════════
GOLDEN TEMPLATES - Copy these patterns EXACTLY${storageModeLabel}
═══════════════════════════════════════════════════════════════════════════════

The following are COMPLETE, WORKING API examples. Copy their patterns exactly,
only changing resource names and schema fields to match your requirements.

`;

  for (const template of templates) {
    const storageLabel = template.storageMode ? ` [${template.storageMode}]` : '';
    context += `
--- ${template.name.toUpperCase()}${storageLabel} ---
${template.description}
${template.template}

`;
  }

  return context;
}
