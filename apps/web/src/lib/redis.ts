import Redis from "ioredis"
import { isHipaaHostedMode } from "./hipaa-config"

let client: Redis | null = null

export function getRedisClient(): Redis {
  if (client) return client

  const url = (process.env.REDIS_URL || "").trim()
  if (!url) {
    if (!isHipaaHostedMode()) {
      throw new Error("REDIS_URL is required only in HIPAA hosted mode")
    }
    throw new Error("Missing REDIS_URL")
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  })

  return client
}

export async function ensureRedisConnection(redis: Redis): Promise<void> {
  if (redis.status === "ready") return
  await redis.connect()
}
