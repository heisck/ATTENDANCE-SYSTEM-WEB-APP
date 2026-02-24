import Redis from "ioredis";

// Initialize Redis client with connection pooling
const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!redisUrl) {
    console.warn("[v0] Redis not configured - caching disabled");
    return null;
  }

  if (!redis) {
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        enableOfflineQueue: true,
        lazyConnect: false,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        // Connection pooling
        connectionPoolSize: 10,
      });

      redis.on("error", (err) => {
        console.error("[v0] Redis connection error:", err);
        redis = null;
      });

      redis.on("connect", () => {
        console.log("[v0] Redis connected");
      });
    } catch (error) {
      console.error("[v0] Failed to initialize Redis:", error);
      return null;
    }
  }

  return redis;
}

// Cache key patterns
export const CACHE_KEYS = {
  // Session state cache (5 min TTL)
  SESSION_STATE: (sessionId: string) => `session:${sessionId}`,
  
  // Student attendance for session (5 min TTL)
  STUDENT_ATTENDANCE: (sessionId: string, studentId: string) =>
    `attendance:${sessionId}:${studentId}`,
  
  // Reverify selections (10 min TTL)
  REVERIFY_SELECTIONS: (sessionId: string) => `reverify:selections:${sessionId}`,
  
  // Rate limit counters (1 min TTL)
  RATE_LIMIT: (studentId: string, sessionId: string) =>
    `ratelimit:${studentId}:${sessionId}`,
  
  // Device fingerprint cache (1 hour TTL)
  DEVICE_FINGERPRINT: (studentId: string, deviceToken: string) =>
    `device:${studentId}:${deviceToken}`,
  
  // Course enrollment cache (1 hour TTL)
  COURSE_ENROLLMENTS: (courseId: string) => `enrollments:${courseId}`,
  
  // User credentials cache (30 min TTL)
  USER_CREDENTIALS: (userId: string) => `credentials:${userId}`,
  
  // Organization settings cache (1 hour TTL)
  ORG_SETTINGS: (orgId: string) => `org:settings:${orgId}`,
  
  // Analytics cache (5 min TTL)
  ANALYTICS: (orgId: string) => `analytics:${orgId}`,
  
  // Anomaly detection scoring (30 min TTL)
  ANOMALY_SCORE: (studentId: string) => `anomaly:${studentId}`,
};

export const CACHE_TTL = {
  SESSION_STATE: 300, // 5 minutes
  REVERIFY_SELECTIONS: 600, // 10 minutes
  RATE_LIMIT: 60, // 1 minute
  DEVICE_FINGERPRINT: 3600, // 1 hour
  COURSE_ENROLLMENTS: 3600, // 1 hour
  USER_CREDENTIALS: 1800, // 30 minutes
  ORG_SETTINGS: 3600, // 1 hour
  ANALYTICS: 300, // 5 minutes
  ANOMALY_SCORE: 1800, // 30 minutes
};

/**
 * Get from cache
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    console.error(`[v0] Cache get error for ${key}:`, error);
    return null;
  }
}

/**
 * Set in cache with TTL
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`[v0] Cache set error for ${key}:`, error);
    return false;
  }
}

/**
 * Delete from cache
 */
export async function cacheDel(key: string): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.del(key);
    return true;
  } catch (error) {
    console.error(`[v0] Cache del error for ${key}:`, error);
    return false;
  }
}

/**
 * Invalidate cache by pattern
 */
export async function cacheInvalidatePattern(pattern: string): Promise<number> {
  const client = getRedis();
  if (!client) return 0;

  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) return 0;
    const deleted = await client.del(...keys);
    return deleted;
  } catch (error) {
    console.error(`[v0] Cache pattern invalidation error for ${pattern}:`, error);
    return 0;
  }
}

/**
 * Increment counter (for rate limiting)
 */
export async function cacheIncrement(key: string, ttlSeconds: number): Promise<number> {
  const client = getRedis();
  if (!client) return 0;

  try {
    const exists = await client.exists(key);
    const count = await client.incr(key);
    
    if (exists === 0) {
      await client.expire(key, ttlSeconds);
    }
    
    return count;
  } catch (error) {
    console.error(`[v0] Cache increment error for ${key}:`, error);
    return 0;
  }
}

/**
 * Check rate limit
 */
export async function checkRateLimit(
  studentId: string,
  sessionId: string,
  maxAttempts: number = 10,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const key = CACHE_KEYS.RATE_LIMIT(studentId, sessionId);
  
  try {
    const count = await cacheIncrement(key, windowSeconds);
    const allowed = count <= maxAttempts;
    const remaining = Math.max(0, maxAttempts - count);
    
    return { allowed, remaining };
  } catch (error) {
    console.error("[v0] Rate limit check error:", error);
    // Fail open - allow request if cache unavailable
    return { allowed: true, remaining: maxAttempts };
  }
}

/**
 * Batch get multiple keys
 */
export async function cacheGetBatch<T>(keys: string[]): Promise<(T | null)[]> {
  const client = getRedis();
  if (!client) return keys.map(() => null);

  try {
    const values = await client.mget(...keys);
    return values.map((val) => {
      if (!val) return null;
      try {
        return JSON.parse(val) as T;
      } catch {
        return null;
      }
    });
  } catch (error) {
    console.error("[v0] Cache batch get error:", error);
    return keys.map(() => null);
  }
}

/**
 * Batch set multiple key-value pairs
 */
export async function cacheSetBatch<T>(
  items: Array<{ key: string; value: T; ttl: number }>
): Promise<number> {
  const client = getRedis();
  if (!client) return 0;

  try {
    if (items.length === 0) return 0;

    const pipeline = client.pipeline();
    
    items.forEach(({ key, value, ttl }) => {
      pipeline.setex(key, ttl, JSON.stringify(value));
    });

    await pipeline.exec();
    return items.length;
  } catch (error) {
    console.error("[v0] Cache batch set error:", error);
    return 0;
  }
}

/**
 * Get or compute (compute-on-miss)
 */
export async function cacheGetOrCompute<T>(
  key: string,
  ttl: number,
  computeFn: () => Promise<T>
): Promise<T | null> {
  try {
    // Try cache first
    const cached = await cacheGet<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Compute if not in cache
    const computed = await computeFn();
    
    // Store in cache
    await cacheSet(key, computed, ttl);
    
    return computed;
  } catch (error) {
    console.error(`[v0] Cache compute error for ${key}:`, error);
    return null;
  }
}

/**
 * Health check
 */
export async function cacheHealthCheck(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
