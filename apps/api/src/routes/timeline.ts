/**
 * Unified Timeline API Routes
 * 
 * Provides a consolidated view of all ChronosOps activities:
 * - Incidents and their lifecycle
 * - Development cycles
 * - Code evolutions
 * - Learned patterns
 * - Actions taken
 * - Reconstructions performed
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timelineAggregator } from '@chronosops/database';
import { createChildLogger } from '@chronosops/shared';
import type { TimelineEntityType } from '@chronosops/shared';

const logger = createChildLogger({ component: 'TimelineAPI' });

// Query parameter validation schema
const timelineQuerySchema = z.object({
  // Pagination
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
  
  // Date filters
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  
  // Entity type filters (comma-separated)
  entityTypes: z.string().optional(),
  
  // Status filter
  status: z.string().optional(),
  
  // Search query
  search: z.string().optional(),
});

type TimelineQuery = z.infer<typeof timelineQuerySchema>;

/**
 * Parse comma-separated entity types into validated array
 */
function parseEntityTypes(entityTypesStr?: string): TimelineEntityType[] | undefined {
  if (!entityTypesStr) return undefined;
  
  const validTypes: TimelineEntityType[] = [
    'incident',
    'development_cycle',
    'code_evolution',
    'learned_pattern',
    'action',
    'reconstruction',
  ];
  
  const requestedTypes = entityTypesStr.split(',').map(t => t.trim());
  const filtered = requestedTypes.filter((t): t is TimelineEntityType => 
    validTypes.includes(t as TimelineEntityType)
  );
  
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Register timeline routes
 */
export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/timeline
   * 
   * Get unified timeline of all ChronosOps activities
   * 
   * Query Parameters:
   * - limit: Number of items per page (1-100, default 50)
   * - cursor: Pagination cursor for next page
   * - startDate: Filter events after this ISO date
   * - endDate: Filter events before this ISO date
   * - entityTypes: Comma-separated list of entity types to include
   * - status: Filter by status
   * - search: Search in titles and descriptions
   */
  app.get(
    '/timeline',
    async (
      request: FastifyRequest<{ Querystring: TimelineQuery }>,
      reply: FastifyReply
    ) => {
      try {
        // Validate and parse query parameters
        const queryResult = timelineQuerySchema.safeParse(request.query);
        
        if (!queryResult.success) {
          return reply.status(400).send({
            error: 'Invalid query parameters',
            details: queryResult.error.flatten().fieldErrors,
          });
        }
        
        const query = queryResult.data;
        
        logger.debug(
          { 
            limit: query.limit,
            hasCursor: !!query.cursor,
            entityTypes: query.entityTypes,
            hasDateRange: !!(query.startDate || query.endDate),
          },
          'Fetching unified timeline'
        );
        
        // Build aggregator params
        const params = {
          limit: query.limit,
          cursor: query.cursor,
          startDate: query.startDate,
          endDate: query.endDate,
          entityTypes: parseEntityTypes(query.entityTypes),
          status: query.status,
          search: query.search,
        };
        
        // Fetch unified timeline
        const result = await timelineAggregator.getUnifiedTimeline(params);
        
        logger.debug(
          { 
            eventsReturned: result.events.length,
            hasMore: result.hasMore,
            totalCount: result.totalCount,
          },
          'Timeline fetch complete'
        );
        
        return reply.send(result);
      } catch (error) {
        logger.error({ error }, 'Failed to fetch unified timeline');
        return reply.status(500).send({
          error: 'Failed to fetch timeline',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/timeline/stats
   * 
   * Get statistics about timeline events
   */
  app.get(
    '/timeline/stats',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await timelineAggregator.getTimelineStats();
        return reply.send(stats);
      } catch (error) {
        logger.error({ error }, 'Failed to fetch timeline stats');
        return reply.status(500).send({
          error: 'Failed to fetch timeline statistics',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/timeline/entity/:entityType/:entityId
   * 
   * Get detailed timeline for a specific entity
   */
  app.get(
    '/timeline/entity/:entityType/:entityId',
    async (
      request: FastifyRequest<{
        Params: { entityType: string; entityId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { entityType, entityId } = request.params;
        
        // Validate entity type
        const validTypes: TimelineEntityType[] = [
          'incident',
          'development_cycle',
          'code_evolution',
          'learned_pattern',
          'action',
          'reconstruction',
        ];
        
        if (!validTypes.includes(entityType as TimelineEntityType)) {
          return reply.status(400).send({
            error: 'Invalid entity type',
            validTypes,
          });
        }
        
        logger.debug(
          { entityType, entityId },
          'Fetching entity timeline'
        );
        
        // Fetch specific entity's timeline events
        const result = await timelineAggregator.getUnifiedTimeline({
          entityTypes: [entityType as TimelineEntityType],
          limit: 100,
          // We'll need to add entity ID filtering support later
        });
        
        // Find the specific entity
        const entity = result.events.find((e: { id: string }) => e.id === entityId);
        
        if (!entity) {
          return reply.status(404).send({
            error: 'Entity not found',
            entityType,
            entityId,
          });
        }
        
        return reply.send(entity);
      } catch (error) {
        logger.error({ error }, 'Failed to fetch entity timeline');
        return reply.status(500).send({
          error: 'Failed to fetch entity timeline',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
