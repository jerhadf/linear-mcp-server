import { RateLimiterMetrics } from '../interfaces/linear';

export class RateLimiter {
  public readonly requestsPerHour = 1400;
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private readonly minDelayMs = 3600000 / this.requestsPerHour;
  private requestTimes: number[] = [];
  private requestTimestamps: number[] = [];

  async enqueue<T>(fn: () => Promise<T>, operation?: string): Promise<T> {
    const startTime = Date.now();
    const queuePosition = this.queue.length;

    console.error(`[Linear API] Enqueueing request${operation ? ` for ${operation}` : ''} (Queue position: ${queuePosition})`);

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          console.error(`[Linear API] Starting request${operation ? ` for ${operation}` : ''}`);
          const result = await fn();
          const endTime = Date.now();
          const duration = endTime - startTime;

          console.error(`[Linear API] Completed request${operation ? ` for ${operation}` : ''} (Duration: ${duration}ms)`);
          this.trackRequest(startTime, endTime, operation);
          resolve(result);
        } catch (error) {
          console.error(`[Linear API] Error in request${operation ? ` for ${operation}` : ''}: `, error);
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      const requestsInLastHour = this.requestTimestamps.filter(t => t > now - 3600000).length;
      if (requestsInLastHour >= this.requestsPerHour * 0.9 && timeSinceLastRequest < this.minDelayMs) {
        const waitTime = this.minDelayMs - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const fn = this.queue.shift();
      if (fn) {
        this.lastRequestTime = Date.now();
        await fn();
      }
    }

    this.processing = false;
  }

  async batch<T>(items: any[], batchSize: number, fn: (item: any) => Promise<T>, operation?: string): Promise<T[]> {
    const batches: Promise<T[]>[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises: Promise<T>[] = batch.map(item => this.enqueue(() => fn(item), operation));
      batches.push(Promise.all(batchPromises));
    }

    const results = await Promise.all(batches);
    return results.flat();
  }

  private trackRequest(startTime: number, endTime: number, operation?: string) {
    const duration = endTime - startTime;
    this.requestTimes.push(duration);
    this.requestTimestamps.push(startTime);

    // Keep only last hour of requests
    const oneHourAgo = Date.now() - 3600000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneHourAgo);
    this.requestTimes = this.requestTimes.slice(-this.requestTimestamps.length);
  }

  getMetrics(): RateLimiterMetrics {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentRequests = this.requestTimestamps.filter(t => t > oneHourAgo);

    return {
      totalRequests: this.requestTimestamps.length,
      requestsInLastHour: recentRequests.length,
      averageRequestTime: this.requestTimes.length > 0
        ? this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length
        : 0,
      queueLength: this.queue.length,
      lastRequestTime: this.lastRequestTime
    };
  }
} 