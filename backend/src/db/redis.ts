import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = createClient({ url: REDIS_URL });
export const redisSub = createClient({ url: REDIS_URL }); // dedicated sub client

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redisSub.on('error', (err) => console.error('[Redis-Sub] Error:', err.message));

export async function connectRedis() {
  await redis.connect();
  await redisSub.connect();
  console.log('[Redis] Connected');
}

export async function cacheGet(key: string) {
  try { return await redis.get(key); } catch { return null; }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 60) {
  try { await redis.setEx(key, ttlSeconds, value); } catch {}
}

export async function cacheDel(key: string) {
  try { await redis.del(key); } catch {}
}

// Publish event to all subscribers
export async function publishEvent(channel: string, data: any) {
  try {
    await redis.publish(channel, JSON.stringify(data));
  } catch (e) {
    console.error('[Redis] Publish error:', e);
  }
}
