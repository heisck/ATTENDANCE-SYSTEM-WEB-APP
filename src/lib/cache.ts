import Redis from "ioredis";

type MemoryCacheEntry = {
  value: string;
  expiresAt: number;
};

type RedisCommandArgument = string | number;

type UpstashPipelineResponse<T = unknown> = {
  result?: T;
  error?: string;
};

type UpstashRestConfig = {
  url: string;
  token: string;
};

const SHARED_REDIS_REQUIRED_MESSAGE =
  "Shared Redis is required in production. Set REDIS_URL, UPSTASH_REDIS_URL, KV_URL, or Upstash REST credentials.";

const memoryCache = new Map<string, MemoryCacheEntry>();
let redis: Redis | null = null;
let upstashRestClient: UpstashRestClient | null = null;
let memoryCleanupStarted = false;

const MEMORY_CACHE_CLEANUP_INTERVAL_MS = 60_000;

export class SharedRedisRequiredError extends Error {
  constructor(message: string = SHARED_REDIS_REQUIRED_MESSAGE) {
    super(message);
    this.name = "SharedRedisRequiredError";
  }
}

class UpstashRestClient {
  constructor(private readonly config: UpstashRestConfig) {}

  matches(config: UpstashRestConfig) {
    return this.config.url === config.url && this.config.token === config.token;
  }

  private async pipeline(
    commands: RedisCommandArgument[][]
  ): Promise<UpstashPipelineResponse[]> {
    const response = await fetch(`${this.config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000), // 5s timeout for Redis operations
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `Upstash REST request failed with status ${response.status}${
          details ? `: ${details.slice(0, 200)}` : ""
        }`
      );
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Unexpected Upstash REST pipeline response");
    }

    return payload as UpstashPipelineResponse[];
  }

  private async command<T>(
    command: string,
    ...args: RedisCommandArgument[]
  ): Promise<T> {
    const [entry] = await this.pipeline([[command, ...args]]);
    if (!entry) {
      throw new Error(`Empty Upstash REST response for ${command}`);
    }
    if (entry.error) {
      throw new Error(entry.error);
    }
    return entry.result as T;
  }

  async get(key: string) {
    return this.command<string | null>("GET", key);
  }

  async setex(key: string, ttlSeconds: number, value: string) {
    await this.command("SETEX", key, ttlSeconds, value);
  }

  async del(key: string) {
    return this.command<number>("DEL", key);
  }

  async exists(key: string) {
    return this.command<number>("EXISTS", key);
  }

  async incr(key: string) {
    return this.command<number>("INCR", key);
  }

  async expire(key: string, ttlSeconds: number) {
    return this.command<number>("EXPIRE", key, ttlSeconds);
  }

  async mget(...keys: string[]) {
    if (keys.length === 0) {
      return [] as (string | null)[];
    }
    return this.command<(string | null)[]>("MGET", ...keys);
  }

  async ping() {
    return this.command<string>("PING");
  }

  async setexMany(items: Array<{ key: string; value: string; ttl: number }>) {
    if (items.length === 0) {
      return 0;
    }

    const responses = await this.pipeline(
      items.map(({ key, value, ttl }) => ["SETEX", key, ttl, value])
    );

    for (const response of responses) {
      if (response.error) {
        throw new Error(response.error);
      }
    }

    return items.length;
  }

  async delMany(keys: string[]) {
    if (keys.length === 0) {
      return 0;
    }

    const responses = await this.pipeline(keys.map((key) => ["DEL", key]));
    let deleted = 0;

    for (const response of responses) {
      if (response.error) {
        throw new Error(response.error);
      }

      deleted += Number(response.result || 0);
    }

    return deleted;
  }
}

type CacheClient = Redis | UpstashRestClient;

function getRedisConnectionUrl() {
  return (
    process.env.REDIS_URL ||
    process.env.UPSTASH_REDIS_URL ||
    process.env.KV_URL ||
    null
  );
}

function getUpstashRestConfig(): UpstashRestConfig | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || null;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null;

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

function hasSharedCacheConfig() {
  return Boolean(getRedisConnectionUrl() || getUpstashRestConfig());
}

function nowMs() {
  return Date.now();
}

function canUseMemoryFallback() {
  return process.env.NODE_ENV !== "production";
}

function startMemoryCleanupIfNeeded() {
  if (memoryCleanupStarted || !canUseMemoryFallback()) {
    return;
  }

  const timer = setInterval(() => {
    const now = nowMs();
    for (const [key, entry] of memoryCache.entries()) {
      if (entry.expiresAt <= now) {
        memoryCache.delete(key);
      }
    }
  }, MEMORY_CACHE_CLEANUP_INTERVAL_MS);

  timer.unref?.();
  memoryCleanupStarted = true;
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
  startMemoryCleanupIfNeeded();
  memoryCache.set(key, {
    value,
    expiresAt: nowMs() + ttlSeconds * 1000,
  });
}

function memoryDelKey(key: string): boolean {
  return memoryCache.delete(key);
}

function memoryIncrement(key: string, ttlSeconds: number): number {
  const currentRaw = memoryGetRaw(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0;
  const next = current + 1;
  memorySetRaw(key, String(next), ttlSeconds);
  return next;
}

function shouldUseMemoryFallback() {
  return canUseMemoryFallback() && !hasSharedCacheConfig();
}

export function getRedis(): CacheClient | null {
  const redisUrl = getRedisConnectionUrl();
  if (redisUrl) {
    if (!redis) {
      try {
        redis = new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          enableOfflineQueue: true,
          lazyConnect: false,
          connectTimeout: 5_000,
          commandTimeout: 3_000,
          retryStrategy: (times) => Math.min(times * 50, 2000),
          keepAlive: 30_000,
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

  const restConfig = getUpstashRestConfig();
  if (!restConfig) {
    return null;
  }

  if (!upstashRestClient || !upstashRestClient.matches(restConfig)) {
    try {
      upstashRestClient = new UpstashRestClient(restConfig);
    } catch (error) {
      console.error("[v0] Failed to initialize Upstash REST client:", error);
      return null;
    }
  }

  return upstashRestClient;
}

export const CACHE_KEYS = {
  SESSION_STATE: (sessionId: string) => `session:${sessionId}`,
  STUDENT_ATTENDANCE: (sessionId: string, studentId: string) =>
    `attendance:${sessionId}:${studentId}`,
  RATE_LIMIT: (studentId: string, sessionId: string) => `ratelimit:${studentId}:${sessionId}`,
  LOGIN_RATE_LIMIT: (identifier: string) => `login-ratelimit:${identifier}`,
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
  if (shouldUseMemoryFallback()) {
    const data = memoryGetRaw(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      memoryDelKey(key);
      return null;
    }
  }

  if (!client) {
    return null;
  }

  try {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    console.error(`[v0] Cache get error for ${key}:`, error);
    if (canUseMemoryFallback()) {
      const data = memoryGetRaw(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch {
        memoryDelKey(key);
        return null;
      }
    }
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  const payload = JSON.stringify(value);
  const client = getRedis();

  if (shouldUseMemoryFallback()) {
    memorySetRaw(key, payload, ttlSeconds);
    return true;
  }

  if (!client) {
    return false;
  }

  try {
    await client.setex(key, ttlSeconds, payload);
    return true;
  } catch (error) {
    console.error(`[v0] Cache set error for ${key}:`, error);
    if (canUseMemoryFallback()) {
      memorySetRaw(key, payload, ttlSeconds);
      return true;
    }
    return false;
  }
}

export async function cacheDel(key: string): Promise<boolean> {
  const client = getRedis();
  const memoryDeleted = canUseMemoryFallback() ? memoryDelKey(key) : false;

  if (shouldUseMemoryFallback()) {
    return memoryDeleted;
  }

  if (!client) {
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

export async function cacheDelBatch(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  const uniqueKeys = Array.from(new Set(keys));
  const client = getRedis();
  let memoryDeleted = 0;

  if (canUseMemoryFallback()) {
    for (const key of uniqueKeys) {
      if (memoryDelKey(key)) {
        memoryDeleted += 1;
      }
    }
  }

  if (shouldUseMemoryFallback()) {
    return memoryDeleted;
  }

  if (!client) {
    return memoryDeleted;
  }

  try {
    if (client instanceof UpstashRestClient) {
      const redisDeleted = await client.delMany(uniqueKeys);
      return memoryDeleted + redisDeleted;
    }

    const redisDeleted = await client.del(...uniqueKeys);
    return memoryDeleted + redisDeleted;
  } catch (error) {
    console.error("[v0] Cache batch del error:", error);
    return memoryDeleted;
  }
}

export async function cacheIncrement(key: string, ttlSeconds: number): Promise<number> {
  const client = getRedis();
  if (shouldUseMemoryFallback()) {
    return memoryIncrement(key, ttlSeconds);
  }

  if (!client) {
    throw new SharedRedisRequiredError();
  }

  try {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ttlSeconds);
    }
    return count;
  } catch (error) {
    console.error(`[v0] Cache increment error for ${key}:`, error);
    if (canUseMemoryFallback()) {
      return memoryIncrement(key, ttlSeconds);
    }
    throw new SharedRedisRequiredError();
  }
}

export async function checkRateLimit(
  studentId: string,
  sessionId: string,
  maxAttempts: number = 10,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  return checkRateLimitKey(
    CACHE_KEYS.RATE_LIMIT(studentId, sessionId),
    maxAttempts,
    windowSeconds
  );
}

export async function checkRateLimitKey(
  key: string,
  maxAttempts: number = 10,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const count = await cacheIncrement(key, windowSeconds);
    const allowed = count <= maxAttempts;
    const remaining = Math.max(0, maxAttempts - count);
    return { allowed, remaining };
  } catch (error) {
    console.error("[v0] Rate limit check error:", error);
    if (error instanceof SharedRedisRequiredError) {
      throw error;
    }

    if (process.env.NODE_ENV === "production") {
      throw new SharedRedisRequiredError();
    }

    return { allowed: true, remaining: maxAttempts };
  }
}

export async function resetRateLimitKey(key: string): Promise<boolean> {
  try {
    return await cacheDel(key);
  } catch (error) {
    console.error("[v0] Rate limit reset error:", error);
    return false;
  }
}

export async function cacheGetBatch<T>(keys: string[]): Promise<(T | null)[]> {
  const client = getRedis();
  if (shouldUseMemoryFallback()) {
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

  if (!client) {
    return keys.map(() => null);
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
    if (!canUseMemoryFallback()) {
      return keys.map(() => null);
    }
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
  if (shouldUseMemoryFallback()) {
    items.forEach(({ key, value, ttl }) => {
      memorySetRaw(key, JSON.stringify(value), ttl);
    });
    return items.length;
  }

  if (!client) {
    return 0;
  }

  try {
    if (items.length === 0) return 0;
    if (client instanceof UpstashRestClient) {
      await client.setexMany(
        items.map(({ key, value, ttl }) => ({
          key,
          ttl,
          value: JSON.stringify(value),
        }))
      );
      return items.length;
    }

    const pipeline = client.pipeline();
    items.forEach(({ key, value, ttl }) => {
      pipeline.setex(key, ttl, JSON.stringify(value));
    });
    await pipeline.exec();
    return items.length;
  } catch (error) {
    console.error("[v0] Cache batch set error:", error);
    if (!canUseMemoryFallback()) {
      return 0;
    }
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
  if (shouldUseMemoryFallback()) {
    return true;
  }

  if (!client) {
    return false;
  }

  try {
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return canUseMemoryFallback() ? memoryCache.size >= 0 : false;
  }
}
