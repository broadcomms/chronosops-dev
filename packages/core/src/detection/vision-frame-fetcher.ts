/**
 * Vision Frame Fetcher
 *
 * Adapter that implements the FrameFetcher interface using the VisionService
 * for server-side rendered dashboard frames.
 *
 * This replaces the old screen-capture dependency with the unified vision pipeline.
 */

import { createChildLogger } from '@chronosops/shared';
import type { VisionService } from '../vision/vision-service.js';
import type { FrameFetcher } from './anomaly-detector.js';

const logger = createChildLogger({ component: 'VisionFrameFetcher' });

/**
 * VisionFrameFetcher - Implements FrameFetcher using VisionService
 */
export class VisionFrameFetcher implements FrameFetcher {
  private visionService: VisionService;
  private serviceName: string;
  private namespace: string;

  /**
   * Create a VisionFrameFetcher
   * @param visionService - The VisionService instance
   * @param serviceName - Service name to monitor (optional - can be set later via setServiceName)
   * @param namespace - Kubernetes namespace (optional - can be set later via setServiceName)
   */
  constructor(visionService: VisionService, serviceName?: string, namespace?: string) {
    this.visionService = visionService;
    this.serviceName = serviceName ?? '';
    this.namespace = namespace ?? '';
  }

  /**
   * Check if the fetcher is configured with a service
   */
  isConfigured(): boolean {
    return this.serviceName !== '' && this.namespace !== '';
  }

  /**
   * Get the latest frame from the vision service
   */
  async getLatestFrame(): Promise<{ data: string; timestamp: Date; mimeType: string } | null> {
    // Return null if not configured yet
    if (!this.isConfigured()) {
      logger.debug('VisionFrameFetcher not configured - no service name set');
      return null;
    }

    try {
      // Ensure monitoring is active
      if (!this.visionService.isMonitoring(this.serviceName)) {
        logger.debug({ serviceName: this.serviceName }, 'Starting monitoring for frame capture');
        await this.visionService.startMonitoring(this.serviceName, this.namespace);
        // Wait a bit for first frame
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      // Get the latest frame
      const frameData = this.visionService.getLatestFrame(this.serviceName);

      if (!frameData) {
        logger.debug({ serviceName: this.serviceName }, 'No frame available yet');
        return null;
      }

      // Convert Buffer to base64
      const base64Data = frameData.frame.toString('base64');

      return {
        data: base64Data,
        timestamp: frameData.timestamp,
        mimeType: 'image/jpeg',
      };
    } catch (error) {
      logger.error(
        { serviceName: this.serviceName, error: (error as Error).message },
        'Error fetching latest frame from VisionService'
      );
      return null;
    }
  }

  /**
   * Check if the vision service is available and monitoring
   */
  async isAvailable(): Promise<boolean> {
    // Return false if not configured yet
    if (!this.isConfigured()) {
      return false;
    }

    // VisionService is always available as it's part of the local system
    // We just need to check if we can start monitoring
    try {
      if (!this.visionService.isMonitoring(this.serviceName)) {
        // Start monitoring if not already
        await this.visionService.startMonitoring(this.serviceName, this.namespace);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the service name being monitored
   */
  getServiceName(): string {
    return this.serviceName;
  }

  /**
   * Update the service being monitored
   */
  setServiceName(serviceName: string, namespace: string): void {
    this.serviceName = serviceName;
    this.namespace = namespace;
    logger.info({ serviceName, namespace }, 'VisionFrameFetcher configured for service');
  }
}

/**
 * Create VisionFrameFetcher from VisionService
 *
 * @param visionService - The VisionService instance
 * @param serviceName - Optional service name (can be set later via setServiceName)
 * @param namespace - Optional namespace (can be set later via setServiceName)
 */
export function createVisionFrameFetcher(
  visionService: VisionService,
  serviceName?: string,
  namespace?: string
): VisionFrameFetcher {
  return new VisionFrameFetcher(visionService, serviceName, namespace);
}
