/**
 * Template Injector
 *
 * Selects and injects relevant golden templates into the code generation context.
 * Uses the 1M token context window to include complete working examples.
 *
 * Flow:
 * 1. Analyze requirement to identify relevant templates
 * 2. Select up to 3 most relevant templates
 * 3. Build context string for prompt injection
 */

import { createChildLogger } from '@chronosops/shared';
import {
  GOLDEN_TEMPLATES,
  selectTemplates,
  buildTemplateContext,
  type GoldenTemplate,
} from '@chronosops/gemini';

const logger = createChildLogger({ component: 'TemplateInjector' });

export interface TemplateInjectionResult {
  /** Template context string to inject into prompt */
  context: string;
  /** Selected template names */
  selectedTemplates: string[];
  /** Approximate token count of injected context */
  estimatedTokens: number;
}

export interface TemplateInjectorConfig {
  /** Maximum tokens to allocate for templates (default: 50000) */
  maxTokens: number;
  /** Maximum number of templates to include (default: 3) */
  maxTemplates: number;
  /** Whether to always include at least one template (default: true) */
  includeDefault: boolean;
}

const DEFAULT_CONFIG: TemplateInjectorConfig = {
  maxTokens: 50000,
  maxTemplates: 3,
  includeDefault: true,
};

/**
 * Template Injector class for selecting and injecting golden templates
 */
export class TemplateInjector {
  private config: TemplateInjectorConfig;

  constructor(config: Partial<TemplateInjectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inject relevant templates based on requirement
   * @param requirement The requirement description
   * @param acceptanceCriteria Optional acceptance criteria for better matching
   * @returns Template injection result with context and metadata
   */
  inject(
    requirement: string,
    acceptanceCriteria: string[] = []
  ): TemplateInjectionResult {
    // Combine requirement with acceptance criteria for better matching
    const fullContext = [
      requirement,
      ...acceptanceCriteria,
    ].join(' ');

    // Select relevant templates
    const templates = selectTemplates(fullContext, this.config.maxTemplates);

    // If no templates matched and we want a default, add the first template
    if (templates.length === 0 && this.config.includeDefault) {
      const defaultTemplate = GOLDEN_TEMPLATES[0];
      if (defaultTemplate) {
        templates.push(defaultTemplate);
      }
    }

    // Build the context string
    const context = this.buildContext(templates);

    // Estimate tokens (rough approximation: 1 token ~= 4 chars)
    const estimatedTokens = Math.ceil(context.length / 4);

    logger.info(
      {
        selectedCount: templates.length,
        templateNames: templates.map(t => t.name),
        estimatedTokens,
      },
      'Templates injected into context'
    );

    return {
      context,
      selectedTemplates: templates.map(t => t.name),
      estimatedTokens,
    };
  }

  /**
   * Build context string from selected templates
   */
  private buildContext(templates: GoldenTemplate[]): string {
    if (templates.length === 0) {
      return '';
    }

    let context = `
═══════════════════════════════════════════════════════════════════════════════
GOLDEN TEMPLATES - Copy these patterns EXACTLY
═══════════════════════════════════════════════════════════════════════════════

The following are COMPLETE, WORKING API examples. Your generated code MUST:
1. Follow the same import patterns
2. Use the same Zod validation patterns
3. Include all required endpoints (/health, list, CRUD)
4. Use the same error handling patterns
5. Include the same exports (app, start)

Only change resource names and schema fields to match the requirements.

`;

    for (const template of templates) {
      context += `
────────────────────────────────────────────────────────────────────────────────
TEMPLATE: ${template.name.toUpperCase()}
${template.description}
────────────────────────────────────────────────────────────────────────────────
${template.template}

`;
    }

    return context;
  }

  /**
   * Get all available templates (for debugging/UI)
   */
  getAllTemplates(): GoldenTemplate[] {
    return [...GOLDEN_TEMPLATES];
  }

  /**
   * Check if requirement matches any templates
   */
  hasRelevantTemplates(requirement: string): boolean {
    const templates = selectTemplates(requirement, 1);
    return templates.length > 0;
  }
}

// Export a default instance for convenience
export const templateInjector = new TemplateInjector();

// Re-export utilities from gemini package
export { selectTemplates, buildTemplateContext, GOLDEN_TEMPLATES };
export type { GoldenTemplate };
