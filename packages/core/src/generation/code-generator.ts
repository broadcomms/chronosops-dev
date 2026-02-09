/**
 * Code Generator
 * Generates TypeScript code from architecture design using Gemini
 */

import { createChildLogger } from '@chronosops/shared';
import type {
  ArchitectureDesign,
  GeneratedCode,
  GeneratedFile,
  ComponentSpec,
  ExternalDependency,
  GeneratedSchema,
} from '@chronosops/shared';
import type { GeminiClient, CodeGenerationGeminiResponse } from '@chronosops/gemini';
import type { CodeGenerationResult, CodeGenerationConfig } from './types.js';
import { DEFAULT_CODE_GENERATION_CONFIG } from './types.js';
import { fastValidator, autoFixer } from './fast-validator.js';

/**
 * Options for code generation
 */
export interface CodeGenerationOptions {
  /** Pre-generated schema to constrain code output (V2 schema-first) */
  schema?: GeneratedSchema;
  /** Errors from previous build failure to avoid repeating */
  previousBuildErrors?: string[];
  /** Thought signature from previous AI reasoning for continuity */
  thoughtSignature?: string;
  /** Storage mode for database persistence: memory, sqlite, or postgres */
  storageMode?: 'memory' | 'sqlite' | 'postgres';
}

export class CodeGenerator {
  private geminiClient: GeminiClient;
  private config: CodeGenerationConfig;
  private logger = createChildLogger({ component: 'CodeGenerator' });
  private previousBuildErrors?: string[];
  private schema?: GeneratedSchema;
  private thoughtSignature?: string;

  constructor(
    geminiClient: GeminiClient,
    config: Partial<CodeGenerationConfig> = {}
  ) {
    this.geminiClient = geminiClient;
    this.config = { ...DEFAULT_CODE_GENERATION_CONFIG, ...config };
  }

  /**
   * Generate code from architecture design
   * @param design - Architecture design to generate code from
   * @param options - Optional generation options (schema, previous errors)
   */
  async generate(
    design: ArchitectureDesign,
    options?: CodeGenerationOptions | string[]  // Support legacy string[] for previousBuildErrors
  ): Promise<CodeGenerationResult> {
    const startTime = Date.now();

    // Handle both new options format and legacy string[] format
    if (Array.isArray(options)) {
      this.previousBuildErrors = options;
      this.schema = undefined;
      this.thoughtSignature = undefined;
    } else {
      this.previousBuildErrors = options?.previousBuildErrors;
      this.schema = options?.schema;
      this.thoughtSignature = options?.thoughtSignature;
      // storageMode is passed to the config for use in generation
      if (options?.storageMode) {
        this.config = { ...this.config, storageMode: options.storageMode };
      }
    }

    this.logger.info({
      componentCount: design.components.length,
      projectName: this.config.projectName,
      hasRetryContext: !!this.previousBuildErrors,
      retryErrorCount: this.previousBuildErrors?.length ?? 0,
      hasSchema: !!this.schema,
      hasThoughtSignature: !!this.thoughtSignature,
    }, 'Starting code generation');

    // Log retry context for debugging
    if (this.previousBuildErrors && this.previousBuildErrors.length > 0) {
      this.logger.info({
        errorCount: this.previousBuildErrors.length,
        errors: this.previousBuildErrors.slice(0, 5), // Log first 5 for brevity
      }, 'Code generation has retry context from previous failures');
    }

    try {
      // Generate code for each component
      const allFiles: GeneratedFile[] = [];
      const componentSummaries: string[] = [];
      let latestThoughtSignature: string | undefined;

      // Generate shared types first
      const sharedTypes = this.generateSharedTypes(design);
      allFiles.push(...sharedTypes);

      // Generate ALL components in a single Gemini call using 1M context
      // This ensures type consistency across components
      this.logger.info({
        componentCount: design.components.length,
      }, 'Generating all components in single Gemini call (1M context)');

      const componentFiles = await this.generateAllComponents(design);
      allFiles.push(...componentFiles.files);
      componentSummaries.push(...componentFiles.summaries);
      latestThoughtSignature = componentFiles.thoughtSignature;

      // Collect all TypeScript files for import scanning
      const codeFiles = [...sharedTypes, ...componentFiles.files];

      // Generate package configuration (scans code for imports to detect dependencies)
      const configFiles = this.generateProjectConfig(design, codeFiles);
      allFiles.push(...configFiles);

      // Generate entry point - pass generated files to filter out non-existent modules
      const entryPoint = this.generateEntryPoint(design, componentFiles.files);
      allFiles.push(entryPoint);

      // V2: Run FastValidator and auto-fix before returning
      // IMPORTANT: Validate and fix each file individually to avoid cross-file error contamination
      const tsFiles = allFiles.filter(f => f.language === 'typescript' || f.path.endsWith('.ts'));
      
      for (const file of tsFiles) {
        const fileValidation = fastValidator.validate(file.content, this.config.storageMode);
        // Use hasFixableErrors instead of fixable - this applies fixes even if some errors are non-fixable
        if (!fileValidation.valid && fileValidation.hasFixableErrors) {
          file.content = autoFixer.fix(file.content, fileValidation.errors);
        }
      }
      
      // Then run multi-file validation to check for cross-file issues (like duplicate exports)
      const fastValidation = fastValidator.validateMultiple(
        tsFiles.map(f => ({ path: f.path, content: f.content })),
        this.config.storageMode
      );

      if (!fastValidation.valid) {
        this.logger.warn({
          errorCount: fastValidation.errors.length,
          errors: fastValidation.errors.map(e => e.code),
        }, 'FastValidator found non-fixable errors after per-file fixes');
      }

      const generatedCode: GeneratedCode = {
        files: allFiles,
        dependencies: this.extractDependencies(design),
        explanation: `Generated ${allFiles.length} files for ${design.components.length} components based on the architecture design.`,
        integrationNotes: `Entry point: src/index.ts\nBuild: tsc\nTest: ${this.config.testFramework} run`,
      };

      this.logger.info({
        totalFiles: allFiles.length,
        components: componentSummaries,
        processingTimeMs: Date.now() - startTime,
        hasThoughtSignature: !!latestThoughtSignature,
      }, 'Code generation complete');

      return {
        success: true,
        code: generatedCode,
        design,
        processingTimeMs: Date.now() - startTime,
        thoughtSignature: latestThoughtSignature,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Code generation failed');

      return {
        success: false,
        error: errorMessage,
        design,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate shared types from the design
   */
  private generateSharedTypes(design: ArchitectureDesign): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    // Generate types for each interface in the design
    const interfaceDefinitions: string[] = [];

    for (const component of design.components) {
      for (const iface of component.interface) {
        // Build request interface only if there are parameters
        const hasParams = iface.parameters && iface.parameters.length > 0;
        const requestInterface = hasParams ? `
/**
 * ${iface.description ?? iface.name} - Request
 */
export interface ${this.pascalCase(iface.name)}Request {
  ${iface.parameters.map((p) => `/** ${p.description ?? p.name} */\n  ${p.name}${p.optional ? '?' : ''}: ${this.sanitizeType(p.type)};`).join('\n  ')}
}
` : '';

        // Use unknown for response data type - actual types are defined in component code
        interfaceDefinitions.push(`${requestInterface}
/**
 * ${iface.description ?? iface.name} - Response
 */
export interface ${this.pascalCase(iface.name)}Response<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
`);
      }
    }

    files.push({
      path: 'src/types/index.ts',
      language: 'typescript',
      purpose: 'Shared type definitions',
      isNew: true,
      content: `/**
 * Shared types for generated application
 * Auto-generated by ChronosOps Code Generator
 */

${interfaceDefinitions.join('\n')}

// Re-export common types
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
`,
    });

    return files;
  }

  /**
   * Generate ALL components in a single Gemini call using 1M context
   * This ensures type consistency across all components
   */
  private async generateAllComponents(
    design: ArchitectureDesign
  ): Promise<{ files: GeneratedFile[]; summaries: string[]; thoughtSignature?: string }> {
    const allFiles: GeneratedFile[] = [];
    const summaries: string[] = [];
    let capturedThoughtSignature: string | undefined;

    // Build constraints including any previous build errors to avoid
    const constraints: string[] = [];

    if (this.previousBuildErrors && this.previousBuildErrors.length > 0) {
      this.logger.info({
        errorCount: this.previousBuildErrors.length,
      }, 'Including previous build/verification errors as constraints for all components');

      // Categorize errors for better context
      const verificationErrors = this.previousBuildErrors.filter(e => e.startsWith('[VERIFICATION'));
      const buildErrors = this.previousBuildErrors.filter(e => e.startsWith('[BUILD'));
      const testErrors = this.previousBuildErrors.filter(e => e.startsWith('[TEST'));
      const otherErrors = this.previousBuildErrors.filter(e => 
        !e.startsWith('[VERIFICATION') && !e.startsWith('[BUILD') && !e.startsWith('[TEST')
      );

      constraints.push(
        '=== CRITICAL: PREVIOUS ATTEMPT FAILED - YOU MUST FIX THESE ISSUES ===',
        ''
      );

      // Add verification errors with context about what they mean
      if (verificationErrors.length > 0) {
        constraints.push(
          '### RUNTIME VERIFICATION FAILURES (Endpoints failed after deployment):',
          'These endpoints were tested after deployment and FAILED. The code runs but has bugs:',
          ...verificationErrors,
          '',
          'COMMON VERIFICATION FIXES:',
          '- Timeout errors: The endpoint is hanging - check for infinite loops, missing await, or unresolved promises',
          '- HTTP 500 errors: Check error handling, null/undefined access, and database operations',
          '- Missing response: Ensure all code paths return a response',
          '- Auth failures: Verify JWT handling, password hashing, and token validation',
          ''
        );
      }

      // Add build errors
      if (buildErrors.length > 0 || otherErrors.length > 0) {
        constraints.push(
          '### BUILD/TYPE ERRORS (Code failed to compile):',
          ...buildErrors,
          ...otherErrors,
          ''
        );
      }

      // Add test errors
      if (testErrors.length > 0) {
        constraints.push(
          '### TEST FAILURES:',
          ...testErrors,
          ''
        );
      }

      constraints.push(
        '=== COMMON ERROR FIXES ===',
        '',
        '1. DUPLICATE EXPORT ERROR ("has already exported a member named X"):',
        '   - Each module MUST export UNIQUE function names',
        '   - Use PREFIXED names: createProject, findProjectById, createTask, findTaskById',
        '   - NEVER have two modules that both export "create", "findById", "update", etc.',
        '',
        '2. TYPE MISMATCH ERROR ("not assignable to parameter of type"):',
        '   - NEVER cast req.body as { prop?: string } - this makes properties optional!',
        '   - ALWAYS use Zod .parse() to validate request body: const input = CreateSchema.parse(req.body)',
        '   - After .parse(), all required properties are guaranteed non-optional',
        '   - If CreateDTO has name: string, req.body must be validated through Zod, not casted',
        '   - ERROR EXAMPLE: Argument of type \'{ email?: string }\' is not assignable to parameter of type \'CreateUserInput\'.',
        '     This happens when you cast req.body with optional properties - use Zod .parse() instead!',
        '',
        '3. MISSING MODULE ERROR ("Cannot find module \'uuid\'"):',
        '   - DO NOT import from \'uuid\' package - use built-in Node.js crypto instead',
        '   - CORRECT: import { randomUUID } from \'crypto\'; const id = randomUUID();',
        '   - WRONG: import { v4 as uuidv4 } from \'uuid\';',
        '',
        '4. GENERAL RULES:',
        '   - Define ALL shared types in src/types/entities.ts',
        '   - Import types from "../types/entities" in ALL components',
        '   - Use consistent property names (always "passwordHash" OR "password", not both)',
        '   - Use relative imports like "../user-repository" not "src/user-repository"'
      );
    }

    // Generate all components in one call using the full context
    const response = await this.geminiClient.generateCode({
      requirementId: 'all-components',
      requirement: design.overview,
      // Pass ALL components as a single specification
      component: JSON.stringify({
        allComponents: design.components,
        sharedTypes: this.extractSharedTypesSpec(design),
      }),
      architecture: JSON.stringify(design),
      context: this.getAllComponentsGuidelines(design),
      targetLanguage: 'typescript',
      constraints: constraints.length > 0 ? constraints : undefined,
      thoughtSignature: this.thoughtSignature,
    });

    if (!response.success || !response.data) {
      this.logger.warn({
        error: response.error,
      }, 'Gemini all-components generation failed, falling back to individual generation');

      // Fall back to individual component generation
      for (const component of design.components) {
        const files = await this.generateComponent(component, design);
        allFiles.push(...files);
        summaries.push(`${component.name}: ${files.length} files (fallback)`);
      }
      return { files: allFiles, summaries };
    }

    // Capture thoughtSignature from successful response
    capturedThoughtSignature = response.thoughtSignature;

    // Parse files from the all-components response
    const data = response.data;
    if (data.files && Array.isArray(data.files)) {
      for (const file of data.files) {
        allFiles.push({
          path: file.path ?? 'src/unknown.ts',
          language: (file.language as GeneratedFile['language']) ?? 'typescript',
          purpose: file.purpose ?? 'Generated file',
          isNew: file.isNew ?? true,
          content: file.content ?? '',
        });
      }
    }

    // Post-process: Ensure index.ts files exist for each component
    for (const component of design.components) {
      const componentDir = `src/${this.kebabCase(component.name)}`;
      const hasIndexFile = allFiles.some(
        (f) => f.path === `${componentDir}/index.ts` || f.path === `src/${this.kebabCase(component.name)}.ts`
      );

      if (!hasIndexFile) {
        // Find files in this component's directory
        const componentFiles = allFiles.filter(f => f.path.startsWith(componentDir + '/'));
        if (componentFiles.length > 0) {
          const mainFile = componentFiles.find((f) =>
            f.content.includes('export async function start') ||
            f.content.includes('export function start')
          );
          const firstTsFile = componentFiles.find((f) =>
            f.path.endsWith('.ts') && !f.path.includes('.test.')
          );

          const fileToExport = mainFile ?? firstTsFile;
          if (fileToExport) {
            const relativePath = fileToExport.path.replace(`${componentDir}/`, './').replace('.ts', '');
            allFiles.push({
              path: `${componentDir}/index.ts`,
              language: 'typescript',
              purpose: `Index file for ${component.name}`,
              isNew: true,
              content: `/**
 * ${component.name} - Index file
 * Auto-generated by ChronosOps Code Generator
 */

export * from '${relativePath}';
`,
            });
            this.logger.info({ componentDir }, 'Created missing index.ts for component');
          }
        }
      }

      // Count files for this component
      const fileCount = allFiles.filter(f =>
        f.path.startsWith(componentDir + '/') ||
        f.path === `${componentDir}/index.ts`
      ).length;
      summaries.push(`${component.name}: ${fileCount} files`);
    }

    // Post-process: Inject Prometheus metrics for app components
    for (const component of design.components) {
      const isAppComponent = component.name.toLowerCase().includes('app') ||
        component.name.toLowerCase().includes('server') ||
        component.purpose.toLowerCase().includes('server') ||
        component.purpose.toLowerCase().includes('api');

      if (isAppComponent) {
        this.injectPrometheusMetrics(allFiles, component);
        if (this.config.enableFaultInjection) {
          this.injectFaultInjection(allFiles, component);
        }
      }
    }

    this.logger.info({
      totalFiles: allFiles.length,
      components: design.components.length,
      hasThoughtSignature: !!capturedThoughtSignature,
    }, 'All components generated in single call');

    return { files: allFiles, summaries, thoughtSignature: capturedThoughtSignature };
  }

  /**
   * Extract shared types specification from design for type consistency
   */
  private extractSharedTypesSpec(design: ArchitectureDesign): object {
    // Collect all entity-like types that should be shared
    const sharedEntities: string[] = [];

    for (const component of design.components) {
      // Look for common entity patterns in purpose/interface
      const purpose = component.purpose.toLowerCase();
      const entityPatterns = ['user', 'session', 'token', 'record', 'entity', 'model'];

      for (const pattern of entityPatterns) {
        if (purpose.includes(pattern)) {
          sharedEntities.push(pattern);
        }
      }

      // Look for entity types in interface definitions
      for (const iface of component.interface) {
        const returnType = iface.returnType.toLowerCase();
        for (const pattern of entityPatterns) {
          if (returnType.includes(pattern)) {
            sharedEntities.push(pattern);
          }
        }
      }
    }

    return {
      suggestedSharedTypes: [...new Set(sharedEntities)],
      note: 'Define these types in src/types/entities.ts and import in all components',
    };
  }

  /**
   * Get guidelines specific to generating all components together
   * V2: Now includes schema constraint for improved accuracy
   * V3: Now includes storage mode for database persistence
   */
  private getAllComponentsGuidelines(design: ArchitectureDesign): string {
    const componentList = design.components.map(c => `- ${c.name}: ${c.purpose}`).join('\n');

    // V3: Include storage mode context
    let storageModeSection = '';
    if (this.config.storageMode === 'memory' || !this.config.storageMode) {
      // CRITICAL: Explicit instructions for memory mode to prevent Redis/external dependencies
      storageModeSection = `
═══════════════════════════════════════════════════════════════════════════════
IN-MEMORY STORAGE (storageMode: memory)
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: This API runs in MEMORY MODE with NO external dependencies.

DO NOT USE:
❌ Redis (redis, ioredis, connect-redis)
❌ Memcached
❌ External session stores
❌ Any external database connections for sessions
❌ Any npm package that requires external infrastructure

YOU MUST USE:
✅ In-memory Map<string, T> for ALL data storage
✅ In-memory sessions (store JWT tokens client-side, sessions in Map)
✅ Node.js crypto for UUID generation (randomUUID)
✅ jsonwebtoken for JWT (tokens are self-contained, no server storage needed)

For AUTH APIs specifically:
- JWT tokens are STATELESS - the token itself contains the payload
- Store user data in Map<string, User>
- For session-based auth, store sessions in Map<string, Session>
- Do NOT connect to Redis or any external session store
- readyz endpoint should return 200 OK (no external deps to check)

`;
    } else if (this.config.storageMode === 'sqlite' || this.config.storageMode === 'postgres') {
      storageModeSection = `
═══════════════════════════════════════════════════════════════════════════════
DATABASE PERSISTENCE (storageMode: ${this.config.storageMode})
═══════════════════════════════════════════════════════════════════════════════

This API must use ${this.config.storageMode === 'sqlite' ? 'SQLite with better-sqlite3' : 'PostgreSQL with pg'} for data persistence.
Do NOT use in-memory Map storage. Follow the database patterns from the prompt instructions.

${this.config.storageMode === 'sqlite' ? `
SQLite REQUIREMENTS:
- Import: import Database from 'better-sqlite3';
- Import: import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
- CRITICAL: Add explicit type annotation to db variable to prevent TS4023 errors:
  const db: BetterSQLite3Database = drizzle(sqlite);
- Use SYNCHRONOUS Drizzle methods (NO await):
  ✅ const items = db.select().from(table).all();
  ✅ const item = db.select().from(table).where(eq(table.id, id)).get();
  ✅ db.insert(table).values(data).run();
  ✅ db.update(table).set(data).where(eq(table.id, id)).run();
  ✅ db.delete(table).where(eq(table.id, id)).run();
- Store timestamps as text (ISO strings)
- Create database directory: mkdirSync(dirname(DB_PATH), { recursive: true })
- Enable WAL mode: sqlite.pragma('journal_mode = WAL')
- Add graceful shutdown: process.on('SIGTERM', () => { sqlite.close(); process.exit(0); })
` : `
PostgreSQL REQUIREMENTS:
- Import: import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
- Import: import pg from 'pg';
- CRITICAL: Add explicit type annotation to db variable to prevent TS4023 errors:
  let db: NodePgDatabase;
- Use ASYNC Drizzle methods (MUST use await):
  ✅ const items = await db.select().from(table);
  ✅ const [item] = await db.select().from(table).where(eq(table.id, id));
  ✅ await db.insert(table).values(data);
  ✅ await db.update(table).set(data).where(eq(table.id, id));
  ✅ await db.delete(table).where(eq(table.id, id));
- All route handlers must be async: app.get('/path', async (req, res) => {...})
- Use native PostgreSQL types: uuid().defaultRandom(), timestamp().defaultNow()
- Connection URL: process.env.DATABASE_URL
- Add graceful shutdown: process.on('SIGTERM', async () => { await pool.end(); process.exit(0); })

⚠️ CRITICAL PostgreSQL TIMESTAMP SAFETY:
When returning Date objects from PostgreSQL, ALWAYS use optional chaining with fallback:
❌ WRONG: b.createdAt.toISOString()  // Crashes if createdAt is undefined
✅ CORRECT: b.createdAt?.toISOString() ?? new Date().toISOString()
❌ WRONG: b.updatedAt.toISOString()  // Crashes if updatedAt is undefined
✅ CORRECT: b.updatedAt?.toISOString() ?? new Date().toISOString()

⚠️ CRITICAL PostgreSQL MIGRATION REQUIREMENT:
You MUST create an initializeDatabase() function that:
1. Runs CREATE TABLE IF NOT EXISTS for ALL your tables
2. Is called BEFORE app.listen() in the start() function

Example:
\`\`\`typescript
async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(\\\`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    \\\`);
    console.log('Database migrations completed');
  } finally {
    client.release();
  }
}

export async function start(port = 8080): Promise<void> {
  await initializeDatabase();  // MUST call before listen!
  app.listen(port, () => console.log(\\\`Running on port \\\${port}\\\`));
}
\`\`\`
`}
`;
    }

    // V2: Include schema constraint if available
    let schemaSection = '';
    if (this.schema) {
      schemaSection = `
═══════════════════════════════════════════════════════════════════════════════
SCHEMA CONSTRAINT (MANDATORY - You MUST use these exact types)
═══════════════════════════════════════════════════════════════════════════════

The following Zod schemas have been pre-generated for this API.
You MUST use these EXACT schemas in your code - do NOT define your own types.

${this.schema.completeSchemaFile}

CRITICAL RULES:
1. Copy these schemas EXACTLY into src/types/entities.ts or the app file
2. Use z.infer<typeof Schema> to derive types - do NOT define separate interfaces
3. Use Schema.parse(req.body) for ALL request body validation
4. NEVER use 'req.body as Type' - this bypasses validation

`;
    }

    return `
CRITICAL: You are generating ALL ${design.components.length} components in a SINGLE response.
This ensures type consistency across all components.
${storageModeSection}${schemaSection}
Components to generate:
${componentList}

TYPE CONSISTENCY REQUIREMENTS:
1. Define ALL shared types (User, Session, Token, etc.) in a SINGLE file: src/types/entities.ts
2. ALL components MUST import shared types from '../types/entities'
3. Use CONSISTENT property names across all components
4. Export ALL types that any component needs to use
5. Use relative imports between components: '../user-repository', NOT 'src/user-repository'

FILE STRUCTURE REQUIREMENTS:
- src/types/entities.ts - ALL shared entity types
- src/<component-name>/index.ts - Each component's entry point
- Each component in its own directory

IMPORT PATTERN (REQUIRED):
\`\`\`typescript
// In src/auth-service/index.ts
import { User, Session } from '../types/entities';
import { UserRepository } from '../user-repository';
\`\`\`

${this.getCodeGuidelines()}`;
  }

  /**
   * Generate code for a single component (fallback only)
   */
  private async generateComponent(
    component: ComponentSpec,
    design: ArchitectureDesign
  ): Promise<GeneratedFile[]> {
    // Build constraints including any previous build errors to avoid
    const constraints: string[] = [];
    
    if (this.previousBuildErrors && this.previousBuildErrors.length > 0) {
      this.logger.info({
        componentName: component.name,
        errorCount: this.previousBuildErrors.length,
      }, 'Including previous build errors as constraints');
      
      constraints.push(
        'CRITICAL: The previous build attempt failed with TypeScript errors. You MUST fix these issues:',
        ...this.previousBuildErrors,
        'Ensure type compatibility and avoid using libraries that cause type conflicts.'
      );
    }

    const response = await this.geminiClient.generateCode({
      requirementId: component.name,
      requirement: component.purpose,
      component: JSON.stringify(component),
      architecture: JSON.stringify(design),
      context: this.getCodeGuidelines(),
      targetLanguage: 'typescript',
      constraints: constraints.length > 0 ? constraints : undefined,
      thoughtSignature: this.thoughtSignature,
    });

    if (!response.success || !response.data) {
      this.logger.warn({
        componentName: component.name,
        error: response.error,
      }, 'Gemini code generation failed, using template');

      // Fall back to template-based generation
      return this.generateComponentFromTemplate(component);
    }

    // Parse and validate the generated code
    const files = this.parseGeneratedCode(response.data, component);

    // Post-process: Inject Prometheus metrics if this is an app/server component
    const isAppComponent = component.name.toLowerCase().includes('app') ||
      component.name.toLowerCase().includes('server') ||
      component.purpose.toLowerCase().includes('server') ||
      component.purpose.toLowerCase().includes('api');

    if (isAppComponent) {
      this.injectPrometheusMetrics(files, component);
      if (this.config.enableFaultInjection) {
        this.injectFaultInjection(files, component);
      }
    }

    return files;
  }

  /**
   * Check if the code has balanced brackets/braces/parentheses
   * This helps detect if Gemini produced incomplete code
   */
  private hasBalancedSyntax(code: string): boolean {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    
    // Also check for unterminated template literals (odd number of backticks)
    const backticks = (code.match(/`/g) || []).length;
    
    return openBraces === closeBraces && 
           openBrackets === closeBrackets && 
           openParens === closeParens &&
           backticks % 2 === 0; // Even number of backticks means all are paired
  }

  /**
   * Check if a position in the code is inside a string literal
   * This prevents injecting code in the middle of strings
   */
  private isInsideString(code: string, position: number): boolean {
    // Count unescaped quotes before this position
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    
    for (let i = 0; i < position && i < code.length; i++) {
      const char = code[i];
      const prevChar = i > 0 ? code[i - 1] : '';
      
      // Skip escaped characters
      if (prevChar === '\\') continue;
      
      if (char === "'" && !inDoubleQuote && !inTemplateLiteral) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && !inTemplateLiteral) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inTemplateLiteral = !inTemplateLiteral;
      }
    }
    
    return inSingleQuote || inDoubleQuote || inTemplateLiteral;
  }

  /**
   * Inject Prometheus metrics into app component files
   * This ensures all deployed apps expose /metrics for ChronosOps monitoring
   */
  private injectPrometheusMetrics(files: GeneratedFile[], component: ComponentSpec): void {
    // Find the main app file (contains express or app.listen)
    const mainFile = files.find(f =>
      f.content.includes('express()') ||
      f.content.includes('app.listen') ||
      f.content.includes('.listen(')
    );

    if (!mainFile) {
      this.logger.debug({ componentName: component.name }, 'No app file found for metrics injection');
      return;
    }

    // CRITICAL: Check if the generated code has syntax issues before modifying
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ 
        componentName: component.name, 
        file: mainFile.path,
      }, 'Skipping Prometheus injection - generated code has unbalanced syntax (would corrupt further)');
      return;
    }

    // Check if metrics are already present
    if (mainFile.content.includes('prom-client') || mainFile.content.includes('/metrics')) {
      this.logger.debug({ componentName: component.name }, 'Prometheus metrics already present');
      return;
    }

    this.logger.info({ componentName: component.name, file: mainFile.path }, 'Injecting Prometheus metrics');

    // Save original content for rollback if injection corrupts the code
    const originalContent = mainFile.content;

    // Inject prom-client import and Express NextFunction type at the top
    // NOTE: Request and Response are NOT imported here because Gemini-generated code
    // already imports them via `import express, { Request, Response } from 'express'`
    // Adding duplicate type imports causes ESLint "unused" errors that AutoFixer can't fix
    const promImport = `import { collectDefaultMetrics, Registry, Counter, Histogram } from 'prom-client';
import type { NextFunction } from 'express';
`;

    // Find where to inject the import (after other imports or at top)
    const importRegex = /^import .+;?\n/gm;
    let lastImportMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(mainFile.content)) !== null) {
      lastImportMatch = match;
    }

    if (lastImportMatch) {
      const insertPos = lastImportMatch.index + lastImportMatch[0].length;
      // SAFETY CHECK: Don't inject if position is inside a string
      if (this.isInsideString(mainFile.content, insertPos)) {
        this.logger.warn({ componentName: component.name }, 'Import injection position is inside string - skipping');
        return;
      }
      mainFile.content =
        mainFile.content.slice(0, insertPos) +
        promImport +
        mainFile.content.slice(insertPos);
    } else {
      mainFile.content = promImport + mainFile.content;
    }

    // Validate syntax after import injection
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ componentName: component.name }, 'Import injection broke syntax - rolling back');
      mainFile.content = originalContent;
      return;
    }

    // Inject metrics setup code after express() initialization
    const metricsSetup = `
// Prometheus metrics setup for ChronosOps monitoring
const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});
`;

    // Find app initialization and inject metrics setup after it
    const expressInitRegex = /(const\s+app\s*=\s*express\(\);?)/;
    const expressMatch = mainFile.content.match(expressInitRegex);

    if (expressMatch && expressMatch.index !== undefined) {
      const insertPos = expressMatch.index + expressMatch[0].length;
      // SAFETY CHECK: Don't inject if position is inside a string
      if (this.isInsideString(mainFile.content, insertPos)) {
        this.logger.warn({ componentName: component.name }, 'Metrics setup injection position is inside string - skipping');
        mainFile.content = originalContent;
        return;
      }
      mainFile.content =
        mainFile.content.slice(0, insertPos) +
        metricsSetup +
        mainFile.content.slice(insertPos);
      
      // Validate syntax after metrics setup injection
      if (!this.hasBalancedSyntax(mainFile.content)) {
        this.logger.warn({ componentName: component.name }, 'Metrics setup injection broke syntax - rolling back');
        mainFile.content = originalContent;
        return;
      }
    }

    // Inject request timing middleware after app.use(express.json())
    const requestTimingMiddleware = `
// Request timing middleware for Prometheus metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    const routePath = (req as Request & { route?: { path?: string } }).route?.path ?? req.path;
    httpRequestCounter.inc({ method: req.method, path: routePath, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, path: routePath, status: res.statusCode }, duration);
  });
  next();
});
`;

    // Find app.use(express.json()) and inject middleware after it
    const jsonMiddlewareRegex = /(app\.use\(express\.json\(\)[^)]*\);?)/;
    const jsonMatch = mainFile.content.match(jsonMiddlewareRegex);

    if (jsonMatch && jsonMatch.index !== undefined) {
      const insertPos = jsonMatch.index + jsonMatch[0].length;
      // SAFETY CHECK: Don't inject if position is inside a string
      if (this.isInsideString(mainFile.content, insertPos)) {
        this.logger.warn({ componentName: component.name }, 'Middleware injection position is inside string - skipping');
        mainFile.content = originalContent;
        return;
      }
      mainFile.content =
        mainFile.content.slice(0, insertPos) +
        requestTimingMiddleware +
        mainFile.content.slice(insertPos);
      
      // Validate syntax after middleware injection
      if (!this.hasBalancedSyntax(mainFile.content)) {
        this.logger.warn({ componentName: component.name }, 'Middleware injection broke syntax - rolling back');
        mainFile.content = originalContent;
        return;
      }
    }

    // Inject /metrics endpoint before the first route or after middleware setup
    const metricsEndpoint = `
// Prometheus metrics endpoint (required for ChronosOps monitoring)
app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});
`;

    // Find /health endpoint and inject metrics endpoint before it
    const healthRouteRegex = /(app\.get\(['"]\/health['"])/;
    const healthMatch = mainFile.content.match(healthRouteRegex);

    if (healthMatch && healthMatch.index !== undefined) {
      // SAFETY CHECK: Don't inject if position is inside a string
      if (this.isInsideString(mainFile.content, healthMatch.index)) {
        this.logger.warn({ componentName: component.name }, 'Metrics endpoint injection position is inside string - skipping');
        mainFile.content = originalContent;
        return;
      }
      mainFile.content =
        mainFile.content.slice(0, healthMatch.index) +
        metricsEndpoint + '\n' +
        mainFile.content.slice(healthMatch.index);
    } else {
      // If no health route, find any app.get or app.post and insert before
      const anyRouteRegex = /(app\.(get|post|put|delete)\(['"]\/)/;
      const routeMatch = mainFile.content.match(anyRouteRegex);

      if (routeMatch && routeMatch.index !== undefined) {
        // SAFETY CHECK: Don't inject if position is inside a string
        if (this.isInsideString(mainFile.content, routeMatch.index)) {
          this.logger.warn({ componentName: component.name }, 'Metrics endpoint injection position is inside string - skipping');
          mainFile.content = originalContent;
          return;
        }
        mainFile.content =
          mainFile.content.slice(0, routeMatch.index) +
          metricsEndpoint + '\n' +
          mainFile.content.slice(routeMatch.index);
      }
    }

    // Inject root endpoint if missing (prevents "Cannot GET /" errors)
    // This happens when Gemini generates code without a root endpoint
    if (!mainFile.content.includes("app.get('/'") && !mainFile.content.includes('app.get("/')) {
      this.logger.info({ componentName: component.name }, 'Injecting missing root endpoint');

      const rootEndpoint = `
// Root endpoint (API information)
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: '${component.name}',
    version: '1.0.0',
    endpoints: { docs: '/docs', health: '/health', metrics: '/metrics' }
  });
});
`;

      // Insert root endpoint before the health endpoint or first route
      const healthRouteMatch = mainFile.content.match(/(app\.get\(['"]\/health['"])/);
      const metricsRouteMatch = mainFile.content.match(/(app\.get\(['"]\/metrics['"])/);

      // Insert before /health if it exists, otherwise before /metrics
      const insertTarget = healthRouteMatch || metricsRouteMatch;
      if (insertTarget && insertTarget.index !== undefined) {
        if (!this.isInsideString(mainFile.content, insertTarget.index)) {
          mainFile.content =
            mainFile.content.slice(0, insertTarget.index) +
            rootEndpoint + '\n' +
            mainFile.content.slice(insertTarget.index);
        }
      }
    }

    // Final validation - ensure we didn't break anything
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ componentName: component.name }, 'Final Prometheus injection broke syntax - rolling back completely');
      mainFile.content = originalContent;
    }
  }

  /**
   * Inject fault injection middleware into app component files for ChronosOps testing.
   * Adds:
   * - Chaos config state for controlling error rate, latency, memory leak
   * - Fault injection middleware that applies chaos based on config
   * - /bugs/* control endpoints for enabling/disabling faults
   */
  private injectFaultInjection(files: GeneratedFile[], component: ComponentSpec): void {
    // Find the main app file (contains express or app.listen)
    const mainFile = files.find(f =>
      f.content.includes('express()') ||
      f.content.includes('app.listen') ||
      f.content.includes('.listen(')
    );

    if (!mainFile) {
      this.logger.debug({ componentName: component.name }, 'No app file found for fault injection');
      return;
    }

    // CRITICAL: Check if the generated code has syntax issues before modifying
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({
        componentName: component.name,
        file: mainFile.path,
      }, 'Skipping fault injection - generated code has unbalanced syntax');
      return;
    }

    // Check if fault injection is already present
    if (mainFile.content.includes('chaosConfig') || mainFile.content.includes('/bugs/')) {
      this.logger.debug({ componentName: component.name }, 'Fault injection already present');
      return;
    }

    this.logger.info({ componentName: component.name, file: mainFile.path }, 'Injecting fault injection middleware');

    // Save original content for rollback if injection corrupts the code
    const originalContent = mainFile.content;

    // Inject fault injection state after metrics setup (look for metricsRegistry or httpRequestCounter)
    const chaosState = `
// Fault injection state for ChronosOps testing
const chaosConfig = {
  errorRate: 0,        // 0-1, percentage of requests to fail with 500
  latencyMs: 0,        // milliseconds to delay each request
  memoryLeak: false,   // whether to allocate memory on each request
  memoryLeakBytes: 0,  // total bytes allocated (for status)
};
const memoryLeaks: Buffer[] = [];
`;

    // Find metrics setup (httpRequestDuration) and inject after it
    const metricsRegex = /(const httpRequestDuration = new Histogram\([^;]+\);)/s;
    const metricsMatch = mainFile.content.match(metricsRegex);

    if (metricsMatch && metricsMatch.index !== undefined) {
      const insertPos = metricsMatch.index + metricsMatch[0].length;
      if (!this.isInsideString(mainFile.content, insertPos)) {
        mainFile.content =
          mainFile.content.slice(0, insertPos) +
          chaosState +
          mainFile.content.slice(insertPos);
      }
    }

    // Validate syntax after state injection
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ componentName: component.name }, 'Fault injection state broke syntax - rolling back');
      mainFile.content = originalContent;
      return;
    }

    // Inject fault injection middleware after request timing middleware
    const faultMiddleware = `
// Fault injection middleware for ChronosOps testing
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Skip fault injection for control endpoints
  if (req.path.startsWith('/bugs') || req.path === '/health' || req.path === '/metrics') {
    return next();
  }

  // Memory leak simulation - fill buffer to force actual memory allocation
  if (chaosConfig.memoryLeak) {
    const leak = Buffer.alloc(1024 * 1024, 0xff); // 1MB filled with 0xff to commit physical memory
    memoryLeaks.push(leak);
    chaosConfig.memoryLeakBytes = memoryLeaks.reduce((sum, buf) => sum + buf.length, 0);
  }

  // Latency injection
  if (chaosConfig.latencyMs > 0) {
    await new Promise(resolve => setTimeout(resolve, chaosConfig.latencyMs));
  }

  // Error spike - return 500 at configured rate
  if (chaosConfig.errorRate > 0 && Math.random() < chaosConfig.errorRate) {
    return res.status(500).json({
      error: 'Simulated server error',
      chaos: true,
      config: { errorRate: chaosConfig.errorRate }
    });
  }

  next();
});
`;

    // Find /metrics endpoint and inject fault middleware BEFORE it
    // This places the fault middleware after the timing middleware but before routes
    const metricsRouteRegex = /(\/\/ Prometheus metrics endpoint)/;
    const metricsRouteMatch = mainFile.content.match(metricsRouteRegex);

    if (metricsRouteMatch && metricsRouteMatch.index !== undefined) {
      if (!this.isInsideString(mainFile.content, metricsRouteMatch.index)) {
        mainFile.content =
          mainFile.content.slice(0, metricsRouteMatch.index) +
          faultMiddleware + '\n' +
          mainFile.content.slice(metricsRouteMatch.index);
      }
    } else {
      // Fallback: inject before /health endpoint if /metrics not found
      const healthRouteRegex = /(app\.get\(['"]\/health['"])/;
      const healthMatch = mainFile.content.match(healthRouteRegex);
      if (healthMatch && healthMatch.index !== undefined) {
        if (!this.isInsideString(mainFile.content, healthMatch.index)) {
          mainFile.content =
            mainFile.content.slice(0, healthMatch.index) +
            faultMiddleware + '\n' +
            mainFile.content.slice(healthMatch.index);
        }
      }
    }

    // Validate syntax after middleware injection
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ componentName: component.name }, 'Fault injection middleware broke syntax - rolling back');
      mainFile.content = originalContent;
      return;
    }

    // Inject /bugs/* endpoints after /metrics endpoint
    const bugEndpoints = `
// Bug control API for ChronosOps fault injection testing
app.get('/bugs/status', (_req: Request, res: Response) => {
  res.json({
    activeBugs: {
      error_spike: chaosConfig.errorRate > 0 ? { rate: chaosConfig.errorRate } : null,
      high_latency: chaosConfig.latencyMs > 0 ? { delayMs: chaosConfig.latencyMs } : null,
      memory_leak: chaosConfig.memoryLeak ? { bytesAllocated: chaosConfig.memoryLeakBytes } : null,
    },
    memoryAllocated: chaosConfig.memoryLeakBytes,
  });
});

app.post('/bugs/:bugId/enable', (req: Request, res: Response) => {
  const { bugId } = req.params;
  const config = req.body || {};

  switch (bugId) {
    case 'error_spike':
      chaosConfig.errorRate = config.rate ?? 0.5;
      break;
    case 'high_latency':
      chaosConfig.latencyMs = config.delayMs ?? 3000;
      break;
    case 'memory_leak':
      chaosConfig.memoryLeak = true;
      break;
    default:
      return res.status(400).json({ error: \`Invalid bugId: \${bugId}. Valid: error_spike, high_latency, memory_leak\` });
  }

  console.log(\`[CHAOS] Bug enabled: \${bugId}\`, config);
  res.json({ success: true, message: \`Bug \${bugId} enabled\`, bugId, config: chaosConfig });
});

app.post('/bugs/:bugId/disable', (req: Request, res: Response) => {
  const { bugId } = req.params;

  switch (bugId) {
    case 'error_spike':
      chaosConfig.errorRate = 0;
      break;
    case 'high_latency':
      chaosConfig.latencyMs = 0;
      break;
    case 'memory_leak':
      chaosConfig.memoryLeak = false;
      memoryLeaks.length = 0;
      chaosConfig.memoryLeakBytes = 0;
      break;
    default:
      return res.status(400).json({ error: \`Invalid bugId: \${bugId}\` });
  }

  console.log(\`[CHAOS] Bug disabled: \${bugId}\`);
  res.json({ success: true, message: \`Bug \${bugId} disabled\`, bugId });
});

app.post('/bugs/reset', (_req: Request, res: Response) => {
  chaosConfig.errorRate = 0;
  chaosConfig.latencyMs = 0;
  chaosConfig.memoryLeak = false;
  memoryLeaks.length = 0;
  chaosConfig.memoryLeakBytes = 0;

  console.log('[CHAOS] All bugs reset');
  res.json({ success: true, message: 'All bugs disabled' });
});
`;

    // Find /health endpoint and inject bug endpoints BEFORE it
    // This places them after /metrics but before other routes
    const healthEndpointRegex = /(app\.get\(['"]\/health['"])/;
    const healthEndpointMatch = mainFile.content.match(healthEndpointRegex);

    if (healthEndpointMatch && healthEndpointMatch.index !== undefined) {
      if (!this.isInsideString(mainFile.content, healthEndpointMatch.index)) {
        mainFile.content =
          mainFile.content.slice(0, healthEndpointMatch.index) +
          bugEndpoints + '\n' +
          mainFile.content.slice(healthEndpointMatch.index);
      }
    } else {
      // Fallback: find first API route (after /metrics) and inject before it
      const apiRouteRegex = /(app\.(get|post|put|delete)\(['"]\/(?!metrics|bugs)[^'"]+['"])/;
      const apiMatch = mainFile.content.match(apiRouteRegex);
      if (apiMatch && apiMatch.index !== undefined) {
        if (!this.isInsideString(mainFile.content, apiMatch.index)) {
          mainFile.content =
            mainFile.content.slice(0, apiMatch.index) +
            bugEndpoints + '\n' +
            mainFile.content.slice(apiMatch.index);
        }
      }
    }

    // Final validation - ensure we didn't break anything
    if (!this.hasBalancedSyntax(mainFile.content)) {
      this.logger.warn({ componentName: component.name }, 'Final fault injection broke syntax - rolling back completely');
      mainFile.content = originalContent;
    }
  }

  /**
   * Parse Gemini response into generated files
   */
  private parseGeneratedCode(
    data: CodeGenerationGeminiResponse,
    component: ComponentSpec
  ): GeneratedFile[] {
    if (!data.files || !Array.isArray(data.files)) {
      return this.generateComponentFromTemplate(component);
    }

    const componentDir = `src/${this.kebabCase(component.name)}`;
    const files: GeneratedFile[] = data.files.map((file, index) => ({
      path: file.path ?? `${componentDir}/${index}.ts`,
      language: (file.language as GeneratedFile['language']) ?? 'typescript',
      purpose: file.purpose ?? `Generated file for ${component.name}`,
      isNew: file.isNew ?? true,
      content: file.content ?? '',
    }));

    // Ensure there's an index.ts file for the component
    // This is required for the entry point imports to work
    const hasIndexFile = files.some(
      (f) => f.path === `${componentDir}/index.ts` || f.path === `src/${this.kebabCase(component.name)}.ts`
    );

    if (!hasIndexFile && files.length > 0) {
      // Find the main component file (has start function for app components, or just the first .ts file)
      const mainFile = files.find((f) => f.content.includes('export async function start') || f.content.includes('export function start'));
      const firstTsFile = files.find((f) => f.path.endsWith('.ts') && !f.path.includes('.test.'));

      const fileToExport = mainFile ?? firstTsFile;
      if (fileToExport) {
        const relativePath = fileToExport.path.replace(`${componentDir}/`, './').replace('.ts', '');
        files.push({
          path: `${componentDir}/index.ts`,
          language: 'typescript',
          purpose: `Index file for ${component.name}`,
          isNew: true,
          content: `/**
 * ${component.name} - Index file
 * Auto-generated by ChronosOps Code Generator
 */

export * from '${relativePath}';
`,
        });
        this.logger.info({ componentDir }, 'Created missing index.ts for component');
      }
    }

    return files;
  }

  /**
   * Generate component from template when Gemini fails
   */
  private generateComponentFromTemplate(component: ComponentSpec): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const componentDir = `src/${this.kebabCase(component.name)}`;

    // Check if this is an app/server component
    const isAppComponent = component.name.toLowerCase().includes('app') ||
      component.name.toLowerCase().includes('server') ||
      component.purpose.toLowerCase().includes('server') ||
      component.purpose.toLowerCase().includes('api');

    // Generate main component file
    const methods = component.interface.map((iface) => {
      const params = iface.parameters.map(
        (p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`
      ).join(', ');

      return `
  /**
   * ${iface.description ?? iface.name}
   */
  async ${this.camelCase(iface.name)}(${params}): Promise<${iface.returnType}> {
    // TODO: Implement ${iface.name}
    throw new Error('Not implemented: ${iface.name}');
  }`;
    }).join('\n');

    const dependencies = component.dependsOn ?? [];

    // Add start function for app/server components with Prometheus metrics
    const startFunction = isAppComponent ? `
/**
 * Start the application server
 * @param port - Port to listen on (default: 8080)
 */
export async function start(port: number = 8080): Promise<void> {
  const express = require('express');
  const { collectDefaultMetrics, Registry, Counter, Histogram } = require('prom-client');
  type Request = import('express').Request;
  type Response = import('express').Response;
  type NextFunction = import('express').NextFunction;

  const app = express();

  // Prometheus metrics setup for ChronosOps auto-discovery
  const register = new Registry();
  collectDefaultMetrics({ register });

  // Custom metrics for request tracking
  const httpRequestCounter = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [register],
  });

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  app.use(express.json());

  // Request timing middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const path = (req as Request & { route?: { path?: string } }).route?.path ?? req.path;
      httpRequestCounter.inc({ method: req.method, path, status: res.statusCode });
      httpRequestDuration.observe({ method: req.method, path, status: res.statusCode }, duration);
    });
    next();
  });

  // API metadata
  const API_INFO = { name: '${component.name}', version: '1.0.0', description: '${component.purpose}' };

  // OpenAPI specification
  const openApiSpec = {
    openapi: '3.0.0',
    info: API_INFO,
    paths: {
      '/': { get: { summary: 'API Information', responses: { '200': { description: 'API metadata' } } } },
      '/health': { get: { summary: 'Health check', responses: { '200': { description: 'Health status' } } } },
    },
  };

  // Swagger UI HTML (CDN-based, no npm package needed)
  // Includes error handling for CDN loading failures and spec fetch errors
  const swaggerHtml = \`<!DOCTYPE html>
<html><head><title>\${API_INFO.name} - API Docs</title>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
<style>.swagger-error{padding:20px;color:#721c24;background:#f8d7da;border:1px solid #f5c6cb;border-radius:4px;margin:20px;}</style>
</head>
<body><div id="swagger-ui"><div class="swagger-error" id="loading-msg">Loading API documentation...</div></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
<script>
(function initSwagger(retries) {
  if (typeof SwaggerUIBundle === 'undefined') {
    if (retries > 0) {
      setTimeout(function() { initSwagger(retries - 1); }, 500);
    } else {
      document.getElementById('swagger-ui').innerHTML = '<div class="swagger-error">Failed to load SwaggerUI. Please refresh the page or check your network connection.</div>';
    }
    return;
  }
  try {
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      onComplete: function() { document.getElementById('loading-msg')?.remove(); },
      onFailure: function(err) {
        document.getElementById('swagger-ui').innerHTML = '<div class="swagger-error">Failed to load API specification: ' + (err.message || 'Unknown error') + '</div>';
      }
    });
  } catch(e) {
    document.getElementById('swagger-ui').innerHTML = '<div class="swagger-error">Error initializing SwaggerUI: ' + e.message + '</div>';
  }
})(5);
</script>
</body></html>\`;

  // Root endpoint - API metadata
  app.get('/', (_req: Request, res: Response) => {
    res.json({ ...API_INFO, docs: '/docs', openapi: '/openapi.json', health: '/health', metrics: '/metrics' });
  });

  // OpenAPI specification endpoint
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });

  // Swagger UI documentation endpoint
  app.get('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(swaggerHtml);
  });

  // Prometheus metrics endpoint (for ChronosOps monitoring)
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.listen(port, () => {
    console.log(\`\${API_INFO.name} v\${API_INFO.version} running on port \${port}\`);
    console.log(\`  API Root:  http://localhost:\${port}/\`);
    console.log(\`  API Docs:  http://localhost:\${port}/docs\`);
    console.log(\`  OpenAPI:   http://localhost:\${port}/openapi.json\`);
    console.log(\`  Health:    http://localhost:\${port}/health\`);
    console.log(\`  Metrics:   http://localhost:\${port}/metrics\`);
  });
}
` : '';

    const mainContent = `/**
 * ${component.name}
 * ${component.purpose}
 *
 * Auto-generated by ChronosOps Code Generator
 */

${dependencies.map((d) => `import { ${d} } from '../${this.kebabCase(d)}';`).join('\n')}

export interface ${component.name}Config {
  // Add configuration options here
}

const DEFAULT_CONFIG: ${component.name}Config = {
  // Default configuration
};

export class ${component.name} {
  private config: ${component.name}Config;

  constructor(config: Partial<${component.name}Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
${methods}
}

// Export singleton for convenience
export const ${this.camelCase(component.name)} = new ${component.name}();
${startFunction}`;

    files.push({
      path: `${componentDir}/index.ts`,
      language: 'typescript',
      purpose: `Main implementation of ${component.name}`,
      isNew: true,
      content: mainContent,
    });

    // Generate types file for component
    files.push({
      path: `${componentDir}/types.ts`,
      language: 'typescript',
      purpose: `Type definitions for ${component.name}`,
      isNew: true,
      content: `/**
 * Types for ${component.name}
 */

export interface ${component.name}Options {
  // Component-specific options
}
`,
    });

    return files;
  }

  /**
   * Generate project configuration files
   * @param design - Architecture design
   * @param generatedCodeFiles - Generated code files to scan for import dependencies
   */
  private generateProjectConfig(design: ArchitectureDesign, generatedCodeFiles?: GeneratedFile[]): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    
    // Get base dependencies from design
    const allDeps = this.extractDependencies(design);
    
    // Scan generated code for additional imports (catches packages Gemini used but didn't declare)
    if (generatedCodeFiles) {
      const detectedDeps = this.scanCodeForImports(generatedCodeFiles);
      // Add detected deps that aren't already present
      const existingNames = new Set(allDeps.map(d => d.name));
      for (const dep of detectedDeps) {
        if (!existingNames.has(dep.name)) {
          allDeps.push(dep);
          existingNames.add(dep.name);
        }
      }
    }

    // Split into dependencies and devDependencies
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};
    for (const dep of allDeps) {
      if (dep.devOnly) {
        devDependencies[dep.name] = dep.version;
      } else {
        dependencies[dep.name] = dep.version;
      }
    }

    // Always include prom-client for Prometheus metrics (required for ChronosOps monitoring)
    if (!dependencies['prom-client']) {
      dependencies['prom-client'] = '^15.1.0';
    }

    // V3: Add database dependencies based on storage mode
    if (this.config.storageMode === 'sqlite') {
      // SQLite dependencies
      if (!dependencies['better-sqlite3']) {
        dependencies['better-sqlite3'] = '^11.7.0';
      }
      if (!dependencies['drizzle-orm']) {
        dependencies['drizzle-orm'] = '^0.38.3';
      }
      if (!devDependencies['@types/better-sqlite3']) {
        devDependencies['@types/better-sqlite3'] = '^7.6.11';
      }
      this.logger.info({}, 'Added SQLite dependencies for storageMode=sqlite');
    } else if (this.config.storageMode === 'postgres') {
      // PostgreSQL dependencies
      if (!dependencies['pg']) {
        dependencies['pg'] = '^8.13.1';
      }
      if (!dependencies['drizzle-orm']) {
        dependencies['drizzle-orm'] = '^0.38.3';
      }
      if (!devDependencies['@types/pg']) {
        devDependencies['@types/pg'] = '^8.11.10';
      }
      this.logger.info({}, 'Added PostgreSQL dependencies for storageMode=postgres');
    }

    // package.json - Use CommonJS (no type: 'module') for simpler generated code
    const packageJson = {
      name: this.config.projectName,
      version: '1.0.0',
      description: design.overview,
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      scripts: {
        build: 'tsc',
        start: 'node dist/index.js',
        dev: 'tsx watch src/index.ts',
        test: `${this.config.testFramework} run`,
        'test:coverage': `${this.config.testFramework} run --coverage`,
        lint: 'eslint "src/**/*.ts"',
        typecheck: 'tsc --noEmit',
      },
      dependencies,
      devDependencies,
    };

    files.push({
      path: 'package.json',
      language: 'json',
      purpose: 'Package configuration',
      isNew: true,
      content: JSON.stringify(packageJson, null, 2),
    });

    // tsconfig.json - Use CommonJS module + Node resolution for simpler generated code
    // NodeNext requires .js extensions in imports which complicates code generation
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        lib: ['ES2022'],
        outDir: './dist',
        rootDir: './src',
        strict: false, // Disable strict mode for generated code to avoid implicit any errors
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        noImplicitAny: false, // Allow implicit any for generated code
        resolveJsonModule: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '**/*.test.ts'],
    };

    files.push({
      path: 'tsconfig.json',
      language: 'json',
      purpose: 'TypeScript configuration',
      isNew: true,
      content: JSON.stringify(tsconfig, null, 2),
    });

    // Dockerfile - use port 8080 to avoid conflict with ChronosOps API on 3000
    // Includes /app/data directory for SQLite persistence when PVC is mounted
    files.push({
      path: 'Dockerfile',
      language: 'dockerfile',
      purpose: 'Container build configuration',
      isNew: true,
      content: `FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Create data directory for SQLite persistence (mounted as PVC volume)
RUN mkdir -p /app/data

COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
`,
    });

    return files;
  }

  /**
   * Generate entry point file
   * @param design - Architecture design
   * @param generatedFiles - Actually generated files (to filter out non-existent modules)
   */
  private generateEntryPoint(design: ArchitectureDesign, generatedFiles: GeneratedFile[]): GeneratedFile {
    // Build a set of existing module paths from generated files
    const existingModules = new Set<string>();
    for (const file of generatedFiles) {
      // Extract module path from file path (e.g., 'src/user-app/index.ts' -> 'user-app')
      const match = file.path.match(/^src\/([^/]+)\//);
      if (match && match[1]) {
        existingModules.add(match[1]);
      }
    }

    this.logger.info({
      designComponents: design.components.map(c => this.kebabCase(c.name)),
      existingModules: Array.from(existingModules),
    }, 'Filtering entry point exports based on actually generated files');

    // Only export components that have corresponding generated files
    const imports = design.components
      .filter((c) => existingModules.has(this.kebabCase(c.name)))
      .map((c) => `export * from './${this.kebabCase(c.name)}';`)
      .join('\n');

    // Find the main app component (usually has 'app' or 'server' in name)
    const appComponent = design.components.find(
      (c) => c.name.toLowerCase().includes('app') || c.name.toLowerCase().includes('server')
    );

    // Only import start if the app component file actually exists
    const appModuleName = appComponent ? this.kebabCase(appComponent.name) : null;
    const appExists = appModuleName && existingModules.has(appModuleName);

    const appImport = appExists
      ? `import { start } from './${appModuleName}';\n`
      : '';
    // Pass default port to start() - use 8080 to avoid conflict with ChronosOps API on 3000
    const startCall = appExists
      ? 'await start(Number(process.env.PORT) || 8080);'
      : '// No app component found';

    return {
      path: 'src/index.ts',
      language: 'typescript',
      purpose: 'Application entry point',
      isNew: true,
      content: `/**
 * Generated Application
 * ${design.overview}
 *
 * Auto-generated by ChronosOps Code Generator
 */

${appImport}${imports}

export * from './types';

// Main application startup
async function main() {
  const port = Number(process.env.PORT) || 8080;
  console.log(\`Starting application on port \${port}...\`);
  ${startCall}
}

// Run if executed directly (CommonJS)
if (require.main === module) {
  main().catch(console.error);
}
`,
    };
  }

  /**
   * Scan generated code for common imports and return dependencies to add
   * This catches cases where Gemini uses packages not explicitly listed in design
   */
  private scanCodeForImports(files: GeneratedFile[]): ExternalDependency[] {
    const detectedDeps: ExternalDependency[] = [];
    
    // Map of common packages that might be used in generated code
    // with their versions and whether they need @types
    const importPatterns: Record<string, { version: string; typesVersion?: string }> = {
      'uuid': { version: '^9.0.0', typesVersion: '^9.0.0' },
      'http-errors': { version: '^2.0.0', typesVersion: '^2.0.0' },
      'bcrypt': { version: '^5.1.0', typesVersion: '^5.0.0' },
      'bcryptjs': { version: '^2.4.3', typesVersion: '^2.4.0' },
      'jsonwebtoken': { version: '^9.0.0', typesVersion: '^9.0.0' },
      'axios': { version: '^1.6.0' }, // Has built-in types
      'lodash': { version: '^4.17.0', typesVersion: '^4.17.0' },
      'dayjs': { version: '^1.11.0' }, // Has built-in types
      'nanoid': { version: '^5.0.0' }, // Has built-in types
    };

    const addedPackages = new Set<string>();

    for (const file of files) {
      // Only scan TypeScript files
      if (!file.path.endsWith('.ts')) continue;
      
      for (const [pkg, info] of Object.entries(importPatterns)) {
        // Check for import statements: from 'pkg' or from "pkg"
        const importRegex = new RegExp(`from\\s+['"]${pkg}['"]`, 'g');
        if (importRegex.test(file.content) && !addedPackages.has(pkg)) {
          addedPackages.add(pkg);
          
          detectedDeps.push({
            name: pkg,
            version: info.version,
            purpose: `Auto-detected from code imports`,
            devOnly: false,
          });
          
          if (info.typesVersion) {
            detectedDeps.push({
              name: `@types/${pkg}`,
              version: info.typesVersion,
              purpose: `TypeScript types for ${pkg}`,
              devOnly: true,
            });
          }
        }
      }
    }

    if (detectedDeps.length > 0) {
      this.logger.info({
        detectedPackages: Array.from(addedPackages),
      }, 'Auto-detected dependencies from code imports');
    }

    return detectedDeps;
  }

  /**
   * Extract dependencies from design
   */
  private extractDependencies(design: ArchitectureDesign, _generatedFiles?: GeneratedFile[]): ExternalDependency[] {
    const deps: ExternalDependency[] = [];

    // Map of packages that need @types/* dev dependencies
    // Note: @types versions are independent from package versions
    const needsTypes: Record<string, string> = {
      'express': '^5.0.0',
      'cors': '^2.8.17',
      'body-parser': '^1.19.5',
      'uuid': '^9.0.0',
      'http-errors': '^2.0.0',
      // Note: fastify has built-in types, no @types needed
    };

    // Add dependencies from design
    for (const dep of design.externalDependencies ?? []) {
      deps.push(dep);
      // Auto-add @types/* for packages that need them
      const typesVersion = needsTypes[dep.name];
      if (typesVersion && !dep.devOnly) {
        deps.push({
          name: `@types/${dep.name}`,
          version: typesVersion,
          purpose: `TypeScript types for ${dep.name}`,
          devOnly: true,
        });
      }
    }

    // Always include common dependencies
    deps.push({
      name: 'pino',
      version: '^9.0.0',
      purpose: 'Logging library',
      devOnly: false,
    });

    // Always include Zod for schema validation and OpenAPI generation
    deps.push({
      name: 'zod',
      version: '^3.22.0',
      purpose: 'Schema validation and OpenAPI generation',
      devOnly: false,
    });

    // Always include prom-client for Prometheus metrics (required for ChronosOps monitoring)
    deps.push({
      name: 'prom-client',
      version: '^15.1.0',
      purpose: 'Prometheus metrics for ChronosOps auto-discovery',
      devOnly: false,
    });

    // Add dev dependencies
    deps.push(
      { name: 'typescript', version: '^5.4.0', purpose: 'TypeScript compiler', devOnly: true },
      { name: 'tsx', version: '^4.7.0', purpose: 'TypeScript execution', devOnly: true },
      { name: '@types/node', version: '^20.11.0', purpose: 'Node.js type definitions', devOnly: true },
      { name: 'eslint', version: '^8.57.0', purpose: 'Linting', devOnly: true },
      { name: '@typescript-eslint/eslint-plugin', version: '^7.0.0', purpose: 'TypeScript ESLint plugin', devOnly: true },
      { name: '@typescript-eslint/parser', version: '^7.0.0', purpose: 'TypeScript ESLint parser', devOnly: true },
    );

    // Add test framework dependencies
    if (this.config.testFramework === 'vitest') {
      deps.push(
        { name: 'vitest', version: '^1.3.0', purpose: 'Test framework', devOnly: true },
        { name: '@vitest/coverage-v8', version: '^1.3.0', purpose: 'Test coverage', devOnly: true },
        { name: 'supertest', version: '^6.3.0', purpose: 'HTTP testing library', devOnly: true },
        { name: '@types/supertest', version: '^6.0.0', purpose: 'Supertest type definitions', devOnly: true },
      );
    } else {
      deps.push(
        { name: 'jest', version: '^29.7.0', purpose: 'Test framework', devOnly: true },
        { name: '@types/jest', version: '^29.5.0', purpose: 'Jest type definitions', devOnly: true },
        { name: 'ts-jest', version: '^29.1.0', purpose: 'TypeScript Jest transformer', devOnly: true },
        { name: 'supertest', version: '^6.3.0', purpose: 'HTTP testing library', devOnly: true },
        { name: '@types/supertest', version: '^6.0.0', purpose: 'Supertest type definitions', devOnly: true },
      );
    }

    return deps;
  }

  /**
   * Get code generation guidelines
   */
  private getCodeGuidelines(): string {
    return `
Code Generation Guidelines:
1. Use TypeScript with strict mode enabled
2. Follow functional programming patterns where appropriate
3. Use async/await for asynchronous operations
4. Implement proper error handling with Result types
5. Add JSDoc comments for all public APIs
6. Use dependency injection for testability
7. Keep functions small and focused (max 30 lines)
8. Use meaningful variable and function names
9. Avoid magic numbers - use named constants
10. Export interfaces and types separately from implementations

CRITICAL - File Structure Requirements:
- Place all component files in src/{component-name}/ directory (kebab-case)
- ALWAYS create a src/{component-name}/index.ts file that exports the main component
- The index.ts file must export all public APIs including the 'start' function for servers
- Example: For component 'BlogApp', create src/blog-app/index.ts

CRITICAL - Server/App Components:
- If the component is a server or app, export a 'start' function with this EXACT signature:
  export async function start(port: number = 8080): Promise<void>
- The start function MUST accept a port parameter with default value 8080
- Use the port parameter to start the server, e.g., app.listen(port)
- Include a /health endpoint that returns { status: 'ok' }

CRITICAL - Prometheus Metrics (REQUIRED for ChronosOps monitoring):
- ALL server/app components MUST include Prometheus metrics using prom-client
- Import from 'prom-client': collectDefaultMetrics, Registry, Counter, Histogram
- Create a new Registry and call collectDefaultMetrics({ register })
- Create http_requests_total Counter with labels: method, path, status
- Create http_request_duration_seconds Histogram with labels: method, path, status
- Add middleware to track ALL requests: increment counter and observe duration
- Expose /metrics endpoint that returns register.metrics()
- Example middleware:
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      httpRequestCounter.inc({ method: req.method, path: req.path, status: res.statusCode });
      httpRequestDuration.observe({ method: req.method, path: req.path, status: res.statusCode }, duration);
    });
    next();
  });

CRITICAL - API Documentation Endpoints (REQUIRED for professional APIs):
- ALL server/app components MUST include API documentation endpoints:
  1. GET / - Root endpoint returning API metadata:
     res.json({ name: 'API Name', version: '1.0.0', docs: '/docs', openapi: '/openapi.json', health: '/health' })
  2. GET /openapi.json - OpenAPI 3.0 specification as JSON
  3. GET /docs - Swagger UI HTML page (load from CDN, no npm package needed)

- Define const API_INFO = { name: '...', version: '1.0.0', description: '...' };
- Define const openApiSpec = { openapi: '3.0.0', info: {...}, paths: {...}, components: {...} };
- Define const swaggerHtml = template with Swagger UI loading from unpkg.com CDN

- Swagger UI HTML template (use CDN, no npm package):
  const swaggerHtml = \\\`<!DOCTYPE html>
  <html>
  <head>
    <title>\\\${API_INFO.name} - API Docs</title>
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
  </html>\\\`;
`;
  }

  // String utility methods
  private pascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^(.)/, (c) => c.toUpperCase());
  }

  private camelCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^(.)/, (c) => c.toLowerCase());
  }

  private kebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  /**
   * Sanitize type references in shared types to avoid undefined type errors.
   * Replaces complex/custom types with safe primitives or unknown.
   */
  private sanitizeType(type: string): string {
    // Primitive types are safe
    const primitives = ['string', 'number', 'boolean', 'void', 'null', 'undefined', 'never', 'any', 'unknown'];
    const trimmed = type.trim();

    // Check if it's a simple primitive
    if (primitives.includes(trimmed)) {
      return trimmed;
    }

    // Arrays of primitives are safe
    const arrayMatch = trimmed.match(/^(string|number|boolean)\[\]$/);
    if (arrayMatch) {
      return trimmed;
    }

    // Record types with primitives are safe
    if (trimmed.startsWith('Record<') && !trimmed.includes(',')) {
      return trimmed;
    }

    // Simple Record<string, primitive> is safe
    const recordMatch = trimmed.match(/^Record<string,\s*(string|number|boolean|unknown)>$/);
    if (recordMatch) {
      return trimmed;
    }

    // Complex types like Partial<Todo>, Todo, Todo[], etc. - replace with unknown
    // This includes: custom types, generics with custom types, union types with custom types
    return 'unknown';
  }
}
