/**
 * @chronosops/gemini
 * Gemini 3 API client for ChronosOps
 */

export { GeminiClient } from './client/index.js';
export * from './client/types.js';
export * from './prompts/index.js';

// V2: Golden templates for template-driven code generation
export {
  GOLDEN_TEMPLATES,
  selectTemplates,
  buildTemplateContext,
  USER_API_TEMPLATE,
  TASK_API_TEMPLATE,
  PRODUCT_API_TEMPLATE,
  COMMENT_API_TEMPLATE,
  SETTINGS_API_TEMPLATE,
} from './templates/golden-templates.js';
export type { GoldenTemplate } from './templates/golden-templates.js';
