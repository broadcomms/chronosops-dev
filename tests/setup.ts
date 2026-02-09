/**
 * Vitest global test setup
 */
import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { geminiHandlers } from './mocks/gemini-handlers.js';

// Create MSW server with handlers
export const server = setupServer(...geminiHandlers);

// Start server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-api-key';
process.env.GEMINI_MODEL = 'gemini-3-flash-preview';
process.env.GEMINI_PRO_MODEL = 'gemini-3-pro-preview';
process.env.EXECUTION_MODE = 'simulated';
process.env.DATABASE_PATH = ':memory:';
