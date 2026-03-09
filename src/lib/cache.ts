import Redis from "ioredis";

type MemoryCacheEntry = {
  value: string;
  expiresAt: number;
};

const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
const memoryCache = new Map<string, MemoryCacheEntry>();
let redis: Redis | null = null;

function nowMs() {
  return Date.now();
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

function memoryGetRaw(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memorySetRaw(key: string, value: string, ttlSeconds: number) {
  memoryCache.set(key, {
    value,
    expiresAt: nowMs() + ttlSeconds * 1000,
  });
}

function memoryDelKey(key: string): boolean {
  return memoryCache.delete(key);
}

function memoryKeysByPattern(pattern: string): string[] {
  const regex = patternToRegex(pattern);
  const keys: string[] = [];
  for (const key of memoryCache.keys()) {
    if (memoryGetRaw(key) === null) continue;
    if (regex.test(key)) keys.push(key);
  }
  return keys;
}

function memoryIncrement(key: string, ttlSeconds: number): number {
  const currentRaw = memoryGetRaw(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0;
  const next = current + 1;
  memorySetRaw(key, String(next), ttlSeconds);
  return next;
}

function useMemoryFallback() {
  return !redisUrl;
}

export function getRedis(): Redis | null {
  if (!redisUrl) {
    return null;
  }

  if (!redis) {
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        enableOfflineQueue: true,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 50, 2000),
      });

      redis.on("error", (err) => {
        console.error("[v0] Redis connection error:", err);
        redis = null;
      });
    } catch (error) {
      console.error("[v0] Failed to initialize Redis:", error);
      return null;
    }
  }

  return redis;
}

export const CACHE_KEYS = {
  SESSION_STATE: (sessionId: string) => `session:${sessionId}`,
  STUDENT_ATTENDANCE: (sessionId: string, studentId: string) =>
    `attendance:${sessionId}:${studentId}`,
  REVERIFY_SELECTIONS: (sessionId: string) => `reverify:selections:${sessionId}`,
  RATE_LIMIT: (studentId: string, sessionId: string) => `ratelimit:${studentId}:${sessionId}`,
  DEVICE_FINGERPRINT: (studentId: string, deviceToken: string) =>
    `device:${studentId}:${deviceToken}`,
  COURSE_ENROLLMENTS: (courseId: string) => `enrollments:${courseId}`,
  USER_CREDENTIALS: (userId: string) => `credentials:${userId}`,
  ORG_SETTINGS: (orgId: string) => `org:settings:${orgId}`,
  ANALYTICS: (orgId: string) => `analytics:${orgId}`,
  ANOMALY_SCORE: (studentId: string) => `anomaly:${studentId}`,
};

export const CACHE_TTL = {
  SESSION_STATE: 300,
  REVERIFY_SELECTIONS: 600,
  RATE_LIMIT: 60,
  DEVICE_FINGERPRINT: 3600,
  COURSE_ENROLLMENTS: 3600,
  USER_CREDENTIALS: 1800,
  ORG_SETTINGS: 3600,
  ANALYTICS: 300,
  ANOMALY_SCORE: 1800,
};

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client || useMemoryFallback()) {
    const data = memoryGetRaw(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      memoryDelKey(key);
      return null;
    }
  }

  try {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    console.error(`[v0] Cache get error for ${key}:`, error);
    const data = memoryGetRaw(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      memoryDelKey(key);
      return null;
    }
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  const payload = JSON.stringify(value);
  const client = getRedis();

  if (!client || useMemoryFallback()) {
    memorySetRaw(key, payload, ttlSeconds);
    return true;
  }

  try {
    await client.setex(key, ttlSeconds, payload);
    return true;
  } catch (error) {
    console.error(`[v0] Cache set error for ${key}:`, error);
    memorySetRaw(key, payload, ttlSeconds);
    return true;
  }
}

export async function cacheDel(key: string): Promise<boolean> {
  const client = getRedis();
  const memoryDeleted = memoryDelKey(key);

  if (!client || useMemoryFallback()) {
    return memoryDeleted;
  }

  try {
    const redisDeleted = await client.del(key);
    return memoryDeleted || redisDeleted > 0;
  } catch (error) {
    console.error(`[v0] Cache del error for ${key}:`, error);
    return memoryDeleted;
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<number> {
  const client = getRedis();
  const memoryKeys = memoryKeysByPattern(pattern);
  let memoryDeleted = 0;
  for (const key of memoryKeys) {
    if (memoryDelKey(key)) memoryDeleted += 1;
  }

  if (!client || useMemoryFallback()) {
    return memoryDeleted;
  }

  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) return memoryDeleted;
    const deleted = await client.del(...keys);
    return memoryDeleted + deleted;
  } catch (error) {
    console.error(`[v0] Cache pattern invalidation error for ${pattern}:`, error);
    return memoryDeleted;
  }
}

export async function cacheIncrement(key: string, ttlSeconds: number): Promise<number> {
  const client = getRedis();
  if (!client || useMemoryFallback()) {
    return memoryIncrement(key, ttlSeconds);
  }

  try {
    const exists = await client.exists(key);
    const count = await client.incr(key);
    if (exists === 0) {
      await client.expire(key, ttlSeconds);
    }
    return count;
  } catch (error) {
    console.error(`[v0] Cache increment error for ${key}:`, error);
    return memoryIncrement(key, ttlSeconds);
  }
}

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
    return { allowed: true, remaining: maxAttempts };
  }
}

export async function cacheGetBatch<T>(keys: string[]): Promise<(T | null)[]> {
  const client = getRedis();
  if (!client || useMemoryFallback()) {
    return keys.map((key) => {
      const raw = memoryGetRaw(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        memoryDelKey(key);
        return null;
      }
    });
  }

  try {
    const values = await client.mget(...keys);
    return values.map((val, index) => {
      if (!val) return null;
      try {
        return JSON.parse(val) as T;
      } catch {
        memoryDelKey(keys[index]);
        return null;
      }
    });
  } catch (error) {
    console.error("[v0] Cache batch get error:", error);
    return keys.map((key) => {
      const raw = memoryGetRaw(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        memoryDelKey(key);
        return null;
      }
    });
  }
}

export async function cacheSetBatch<T>(
  items: Array<{ key: string; value: T; ttl: number }>
): Promise<number> {
  const client = getRedis();
  if (!client || useMemoryFallback()) {
    items.forEach(({ key, value, ttl }) => {
      memorySetRaw(key, JSON.stringify(value), ttl);
    });
    return items.length;
  }

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
    items.forEach(({ key, value, ttl }) => {
      memorySetRaw(key, JSON.stringify(value), ttl);
    });
    return items.length;
  }
}

export async function cacheGetOrCompute<T>(
  key: string,
  ttl: number,
  computeFn: () => Promise<T>
): Promise<T | null> {
  try {
    const cached = await cacheGet<T>(key);
    if (cached !== null) {
      return cached;
    }

    const computed = await computeFn();
    await cacheSet(key, computed, ttl);
    return computed;
  } catch (error) {
    console.error(`[v0] Cache compute error for ${key}:`, error);
    return null;
  }
}

export async function cacheHealthCheck(): Promise<boolean> {
  const client = getRedis();
  if (!client || useMemoryFallback()) {
    return true;
  }

  try {
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return memoryCache.size >= 0;
  }
}
