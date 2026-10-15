import { normalizeMailProfile } from "./mailConfig.js";
import {
  selectFolderCache,
  upsertFolderCache,
} from "./repositories/raw/mailCache.repo.js";
import { getRedisClient } from "./infra/redis.js";

const LIST_CACHE_TTL_MS = Number(process.env.MAIL_LIST_CACHE_TTL_MS || 45_000);
const DETAIL_CACHE_TTL_MS = Number(process.env.MAIL_DETAIL_CACHE_TTL_MS || 5 * 60_000);
const DB_CACHE_MAX_AGE_MS = Number(process.env.MAIL_DB_CACHE_MAX_AGE_MS || 10 * 60_000);
const REDIS_LIST_TTL_SECONDS = Math.max(1, Math.ceil(LIST_CACHE_TTL_MS / 1000));
const REDIS_DETAIL_TTL_SECONDS = Math.max(1, Math.ceil(DETAIL_CACHE_TTL_MS / 1000));

const listCache = new Map();
const detailCache = new Map();
const refreshInFlight = new Map();

function listCacheKey(profile, folder, limit) {
  return `${normalizeMailProfile(profile)}:${folder}:${limit}`;
}

function detailCacheKey(profile, folder, uid) {
  return `${normalizeMailProfile(profile)}:${folder}:${uid}`;
}

function redisListKey(profile, folder, limit) {
  return `cache:mail:list:${normalizeMailProfile(profile)}:${folder}:${limit}`;
}

function redisDetailKey(profile, folder, uid) {
  return `cache:mail:detail:${normalizeMailProfile(profile)}:${folder}:${uid}`;
}

async function readRedisJson(key) {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeRedisJson(key, value, ttlSeconds) {
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }

  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function getRedisCachedMessageList(profile, folder, limit) {
  return readRedisJson(redisListKey(profile, folder, limit));
}

export function getCachedMessageList(profile, folder, limit) {
  const entry = listCache.get(listCacheKey(profile, folder, limit));
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.fetchedAt > LIST_CACHE_TTL_MS) {
    listCache.delete(listCacheKey(profile, folder, limit));
    return null;
  }

  return entry.messages;
}

export function setCachedMessageList(profile, folder, limit, messages) {
  listCache.set(listCacheKey(profile, folder, limit), {
    messages,
    fetchedAt: Date.now(),
  });

  void writeRedisJson(redisListKey(profile, folder, limit), messages, REDIS_LIST_TTL_SECONDS);
  void writeFolderCacheToDb(profile, folder, messages).catch(() => undefined);
}

export function peekCachedMessageList(profile, folder, limit) {
  return listCache.get(listCacheKey(profile, folder, limit))?.messages ?? null;
}

export function invalidateMessageListCache(profile, folder) {
  const role = normalizeMailProfile(profile);

  for (const key of listCache.keys()) {
    if (folder ? key.startsWith(`${role}:${folder}:`) : key.startsWith(`${role}:`)) {
      listCache.delete(key);
    }
  }

  void (async () => {
    const redis = await getRedisClient();
    if (!redis) {
      return;
    }

    const pattern = folder
      ? `cache:mail:list:${role}:${folder}:*`
      : `cache:mail:list:${role}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length) {
      await redis.del(...keys);
    }
  })();

  if (!folder) {
    for (const key of detailCache.keys()) {
      if (key.startsWith(`${role}:`)) {
        detailCache.delete(key);
      }
    }
  }
}

export function getCachedMessageDetail(profile, folder, uid) {
  const entry = detailCache.get(detailCacheKey(profile, folder, uid));
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.fetchedAt > DETAIL_CACHE_TTL_MS) {
    detailCache.delete(detailCacheKey(profile, folder, uid));
    return null;
  }

  return entry.message;
}

export function setCachedMessageDetail(profile, folder, uid, message) {
  detailCache.set(detailCacheKey(profile, folder, uid), {
    message,
    fetchedAt: Date.now(),
  });

  void writeRedisJson(redisDetailKey(profile, folder, uid), message, REDIS_DETAIL_TTL_SECONDS);
}

export async function readFolderCacheFromDb(profile, folder, limit, { allowStale = false } = {}) {
  try {
    const row = await selectFolderCache(normalizeMailProfile(profile), folder);

    if (!row) {
      return null;
    }

    const syncedAt = new Date(row.synced_at).getTime();
    if (!allowStale && Date.now() - syncedAt > DB_CACHE_MAX_AGE_MS) {
      return null;
    }

    const messages = Array.isArray(row.messages) ? row.messages : [];
    return messages.slice(0, limit);
  } catch {
    return null;
  }
}

async function writeFolderCacheToDb(profile, folder, messages) {
  try {
    await upsertFolderCache(
      normalizeMailProfile(profile),
      folder,
      JSON.stringify(messages),
    );
  } catch {
    // Database may be unavailable in mail-only dev setups.
  }
}

export function scheduleListRefresh(cacheKey, refreshTask) {
  if (refreshInFlight.has(cacheKey)) {
    return refreshInFlight.get(cacheKey);
  }

  const task = refreshTask()
    .catch(() => undefined)
    .finally(() => {
      refreshInFlight.delete(cacheKey);
    });

  refreshInFlight.set(cacheKey, task);
  return task;
}

export function isListRefreshInFlight(cacheKey) {
  return refreshInFlight.has(cacheKey);
}
