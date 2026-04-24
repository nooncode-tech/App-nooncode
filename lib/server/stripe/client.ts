import Stripe from 'stripe'
import { ApiError } from '@/lib/server/api/errors'

let stripeClient: Stripe | null = null
let stripeClientKey: string | null = null

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim()

  if (!key) {
    throw new ApiError(
      'STRIPE_NOT_CONFIGURED',
      'STRIPE_SECRET_KEY is not set.',
      503
    )
  }

  return key
}

export function getStripeClient(): Stripe {
  const key = getStripeSecretKey()

  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key, {
      apiVersion: '2025-03-31.basil',
    })
    stripeClientKey = key
  }

  return stripeClient
}
