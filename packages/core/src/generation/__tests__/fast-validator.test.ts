/**
 * FastValidator Tests
 * Tests for the V2 pattern validation layer
 */

import { describe, it, expect } from 'vitest';
import { FastValidator, AutoFixer, fastValidator, autoFixer } from '../fast-validator.js';

describe('FastValidator', () => {
  describe('singleton instances', () => {
    it('should export singleton instances', () => {
      expect(fastValidator).toBeInstanceOf(FastValidator);
      expect(autoFixer).toBeInstanceOf(AutoFixer);
    });
  });

  describe('banned patterns', () => {
    it('should catch req.body as Type casting', () => {
      const code = `
        const input = req.body as CreateUserInput;
        console.log(input);
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      // Check that REQ_BODY_AS_CAST is among the errors (there may be others like missing imports)
      expect(result.errors.some(e => e.code === 'REQ_BODY_AS_CAST')).toBe(true);
    });

    it('should catch req.body as with named type', () => {
      // The regex requires uppercase letter after 'as ' (matches named types like CreateUserInput)
      // Inline types like { name?: string } won't match the pattern
      const code = `
        const input = req.body as UserInput;
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'REQ_BODY_AS_CAST')).toBe(true);
    });

    it('should catch angle bracket casting', () => {
      const code = `
        const input = <CreateUserInput>req.body;
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('REQ_BODY_ANGLE_CAST');
    });

    it('should catch uuid package import', () => {
      const code = `
        import { v4 } from 'uuid';
        const id = v4();
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('UUID_PACKAGE_IMPORT');
    });

    it('should catch express.Request namespace usage', () => {
      const code = `
        app.get('/test', (req: express.Request, res: express.Response) => {});
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'EXPRESS_NAMESPACE_REQUEST')).toBe(true);
    });

    it('should catch destructuring unvalidated req.body', () => {
      // Note: the pattern matches destructuring NOT followed by ;
      // so the destructure must be on same line or have something after it
      const code = `
        app.post('/users', (req, res) => {
          const { name, email } = req.body
          console.log(name);
        });
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DESTRUCTURE_UNVALIDATED_BODY')).toBe(true);
    });

    it('should catch req.params used without type assertion in function call', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const storage = new Map<string, { id: string }>();
        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/items', (_req, res) => res.json([]));
        app.get('/items/:id', (req: Request, res: Response) => {
          const item = storage.get(req.params.id);
          res.json(item);
        });
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION')).toBe(true);
    });

    it('should catch req.params assignment without type assertion', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const storage = new Map<string, { id: string }>();
        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/items', (_req, res) => res.json([]));
        app.get('/items/:id', (req: Request, res: Response) => {
          const id = req.params.id
          const item = storage.get(id);
          res.json(item);
        });
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST')).toBe(true);
    });

    it('should allow req.params with type assertion', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const storage = new Map<string, { id: string }>();
        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/items', (_req, res) => res.json([]));
        app.get('/items/:id', (req: Request, res: Response) => {
          const id = req.params.id as string;
          const item = storage.get(id);
          res.json(item);
        });
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.errors.some(e => e.code === 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION')).toBe(false);
      expect(result.errors.some(e => e.code === 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST')).toBe(false);
    });
  });

  describe('required patterns', () => {
    it('should require Zod import when using Zod schemas', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { randomUUID } from 'crypto';

        const app = express();
        const UserSchema = z.object({ name: z.string() });
        app.post('/users', (req, res) => {
          const data = UserSchema.parse(req.body);
          res.json(data);
        });
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_ZOD_IMPORT')).toBe(true);
    });

    it('should NOT require Zod import when not using Zod schemas', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { randomUUID } from 'crypto';

        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/users', (_req, res) => res.json([]));
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      // Should not trigger MISSING_ZOD_IMPORT when Zod is not used
      expect(result.errors.some(e => e.code === 'MISSING_ZOD_IMPORT')).toBe(false);
    });

    it('should require randomUUID import when using randomUUID', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';

        const app = express();
        app.post('/users', (req, res) => {
          const id = randomUUID();
          res.json({ id });
        });
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_CRYPTO_IMPORT')).toBe(true);
    });

    it('should NOT require randomUUID import when not using randomUUID', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';

        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/users', (_req, res) => res.json([]));
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      // Should not trigger MISSING_CRYPTO_IMPORT when randomUUID is not used
      expect(result.errors.some(e => e.code === 'MISSING_CRYPTO_IMPORT')).toBe(false);
    });
  });

  describe('required endpoints', () => {
    it('should require health endpoint', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const app = express();
        app.get('/users', (_req, res) => res.json([]));
        export { app };
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_HEALTH_ENDPOINT')).toBe(true);
    });
  });

  describe('required exports', () => {
    it('should require app export', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/users', (_req, res) => res.json([]));
        export function start() {}
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_APP_EXPORT')).toBe(true);
    });

    it('should require start function export', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/users', (_req, res) => res.json([]));
        export { app };
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_START_EXPORT')).toBe(true);
    });

    it('should require start function export with type-annotated app', () => {
      // Test that type annotations like "const app: Express = express()" are detected
      const code = `
        import express, { Request, Response, Express } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const app: Express = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        app.get('/users', (_req, res) => res.json([]));
        export { app };
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_START_EXPORT')).toBe(true);
    });

    it('should require start function export with let declaration', () => {
      const code = `
        import express, { Request, Response } from 'express';
        let app = express();
        app.get('/health', (_req, res) => res.json({ status: 'ok' }));
        export { app };
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_START_EXPORT')).toBe(true);
    });
  });

  describe('valid code', () => {
    it('should pass valid code with all required patterns', () => {
      const code = `
        import express, { Request, Response } from 'express';
        import { z } from 'zod';
        import { randomUUID } from 'crypto';

        const UserSchema = z.object({
          id: z.string().uuid(),
          name: z.string(),
        });

        const CreateUserSchema = z.object({
          name: z.string(),
        });

        const app = express();

        app.get('/health', (_req: Request, res: Response) => {
          res.json({ status: 'ok' });
        });

        app.get('/users', (_req: Request, res: Response) => {
          res.json([]);
        });

        app.post('/users', (req: Request, res: Response) => {
          try {
            const input = CreateUserSchema.parse(req.body);
            const user = { id: randomUUID(), ...input };
            res.status(201).json(user);
          } catch (error) {
            if (error instanceof z.ZodError) {
              res.status(400).json({ error: 'Validation failed', details: error.errors });
              return;
            }
            res.status(500).json({ error: 'Internal server error' });
          }
        });

        export { app };

        export function start(port = 3000) {
          app.listen(port, () => console.log(\`Listening on port \${port}\`));
        }
      `;
      const result = fastValidator.validate(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateMultiple', () => {
    it('should detect duplicate exports across files', () => {
      const files = [
        { path: 'src/types.ts', content: 'export interface User { id: string; }' },
        { path: 'src/models.ts', content: 'export interface User { name: string; }' },
      ];
      const result = fastValidator.validateMultiple(files);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DUPLICATE_EXPORT_NAME')).toBe(true);
    });

    it('should pass unique exports across files', () => {
      // Note: Each TypeScript file gets validated for required patterns
      // This test verifies that unique exports don't trigger DUPLICATE_EXPORT_NAME errors
      const files = [
        {
          path: 'src/app.ts',
          content: `
            import express, { Request, Response } from 'express';
            import { z } from 'zod';
            import { randomUUID } from 'crypto';
            const app = express();
            app.get('/health', (_req, res) => res.json({ status: 'ok' }));
            app.get('/users', (_req, res) => res.json([]));
            export { app };
            export function start() {}
          `,
        },
        {
          path: 'src/types.ts',
          content: 'export interface User { id: string; name: string; }',
        },
      ];
      const result = fastValidator.validateMultiple(files);
      // Check there are no duplicate export errors (the purpose of this test)
      expect(result.errors.some(e => e.code === 'DUPLICATE_EXPORT_NAME')).toBe(false);
    });
  });
});

describe('AutoFixer', () => {
  it('should fix uuid import to randomUUID', () => {
    // AutoFixer expects the pattern: import { v4 as uuidv4 } from 'uuid';
    const code = `import { v4 as uuidv4 } from 'uuid';
const id = uuidv4();`;
    const errors = [{ code: 'UUID_PACKAGE_IMPORT', message: '', fix: '', pattern: '' }];
    const fixed = autoFixer.fix(code, errors);
    expect(fixed).toContain("import { randomUUID } from 'crypto'");
    expect(fixed).toContain('const id = randomUUID()');
  });

  it('should add Request/Response imports for express namespace usage', () => {
    const code = `import express from 'express';
app.get('/', (req: express.Request, res: express.Response) => {});`;
    const errors = [
      { code: 'EXPRESS_NAMESPACE_REQUEST', message: '', fix: '', pattern: '' },
      { code: 'EXPRESS_NAMESPACE_RESPONSE', message: '', fix: '', pattern: '' },
    ];
    const fixed = autoFixer.fix(code, errors);
    expect(fixed).toContain("import express, { Request, Response } from 'express'");
    expect(fixed).toContain('req: Request');
    expect(fixed).toContain('res: Response');
  });

  it('should not modify code for non-fixable errors', () => {
    const code = `const x = 1;`;
    const errors = [{ code: 'SOME_OTHER_ERROR', message: '', fix: '', pattern: '' }];
    const fixed = autoFixer.fix(code, errors);
    expect(fixed).toBe(code);
  });

  it('should fix req.params in function call without type assertion', () => {
    const code = `const item = storage.get(req.params.id);`;
    const errors = [{ code: 'REQ_PARAMS_WITHOUT_TYPE_ASSERTION', message: '', fix: '', pattern: '' }];
    const fixed = autoFixer.fix(code, errors);
    expect(fixed).toContain('storage.get(req.params.id as string)');
  });

  it('should fix req.params assignment without type assertion', () => {
    const code = `const id = req.params.id
const item = storage.get(id);`;
    const errors = [{ code: 'REQ_PARAMS_ASSIGNMENT_WITHOUT_CAST', message: '', fix: '', pattern: '' }];
    const fixed = autoFixer.fix(code, errors);
    expect(fixed).toContain('const id = req.params.id as string');
  });
});
