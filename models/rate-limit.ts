import mongoose from 'mongoose'
import type { Model } from 'mongoose'

// Destructure from the default import so this module works under both
// Next.js and Node's native ESM loader (scripts/).
const { Schema, model, models } = mongoose

// Fixed window length for every limited route. Kept here (not in
// lib/rate-limit.ts) so the model has no import cycle with its accessor.
export const RATE_LIMIT_WINDOW_SECONDS = 60
export const RATE_LIMIT_MAX_ATTEMPTS = 5

export interface IRateLimit {
  _id: string
  key: string
  count: number
  windowStart: Date
}

const RateLimitSchema = new Schema({
  // e.g. "login:203.0.113.7" — one counter per key per window.
  key: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  windowStart: { type: Date, required: true },
})

// One document per key per window: the unique index is what makes the
// upsert in lib/rate-limit.ts atomic (a concurrent insert loses with 11000).
RateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true })

// Mongo reaps a window 60s after it started — exactly when it stops being
// consulted, because every query filters on the current windowStart.
RateLimitSchema.index(
  { windowStart: 1 },
  { expireAfterSeconds: RATE_LIMIT_WINDOW_SECONDS },
)

export const RateLimit: Model<IRateLimit> =
  (models.RateLimit as Model<IRateLimit>) ||
  model<IRateLimit>('RateLimit', RateLimitSchema)
