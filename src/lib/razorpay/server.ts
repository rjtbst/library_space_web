// lib/razorpay/server.ts
/**
 * Razorpay server utilities.
 *
 * FLOW
 * ────
 * 1. Library owner connects their Razorpay account during onboarding.
 *    Their linked account ID is stored in libraries.razorpay_account_id.
 * 2. When a student books or subscribes, we create a Razorpay order.
 *    If the library has a linked account, we add a Route transfer so the
 *    money goes directly to the owner.  If not, the order still works —
 *    no transfer is added (fallback mode).
 * 3. After payment, the client sends razorpay_payment_id + signature
 *    back to the server.  We verify the signature before confirming.
 * 4. A webhook at /api/payment/razorpay-webhook handles async events
 *    (payment.captured, payment.failed) as a safety net.
 *
 * ENV VARS
 * ────────
 * RAZORPAY_KEY_ID          — platform key (also used as NEXT_PUBLIC_RAZORPAY_KEY_ID)
 * RAZORPAY_KEY_SECRET      — platform secret (server only)
 * RAZORPAY_WEBHOOK_SECRET  — webhook secret from Razorpay dashboard
 */

import crypto from 'crypto'

const KEY_ID     = process.env.RAZORPAY_KEY_ID     ?? ''
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? ''
const API_BASE   = 'https://api.razorpay.com/v1'

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')
}

/* ─── Types ──────────────────────────────────────────────────────────── */

export type CreateOrderParams = {
  amountINR:          number
  razorpayAccountId:  string | null   // null = no Route transfer
  currency?:          string
  notes?:             Record<string, string>
}

// Discriminated union — callers must narrow with .success before reading
export type CreateOrderResult =
  | { success: true;  data: { orderId: string; keyId: string } }
  | { success: false; error: string }

/* ─── Create order ───────────────────────────────────────────────────── */

export async function createRazorpayOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  if (!KEY_ID || !KEY_SECRET) {
    return {
      success: false,
      error: 'Payment gateway is not configured. Please contact support.',
    }
  }

  const { amountINR, razorpayAccountId, currency = 'INR', notes = {} } = params

  const body: Record<string, unknown> = {
    amount:          Math.round(amountINR * 100),  // paise
    currency,
    notes,
    payment_capture: 1,
  }

  // Add Route transfer only when owner has a linked account
  if (razorpayAccountId) {
    body.transfers = [
      {
        account:  razorpayAccountId,
        amount:   Math.round(amountINR * 100),
        currency,
        notes,
        on_hold:  0,
      },
    ]
  }

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': basicAuth(),
      },
      body: JSON.stringify(body),
      // Next.js: no caching for payment calls
      cache: 'no-store',
    })

    if (!res.ok) {
      const err  = (await res.json().catch(() => ({}))) as any
      const desc = err?.error?.description ?? `Razorpay returned HTTP ${res.status}`
      return { success: false, error: desc }
    }

    const order = (await res.json()) as { id: string }
    return { success: true, data: { orderId: order.id, keyId: KEY_ID } }
  } catch (e) {
    return {
      success: false,
      error: 'Failed to connect to payment gateway. Please check your internet connection.',
    }
  }
}

/* ─── Verify payment signature ───────────────────────────────────────── */

export function verifyRazorpaySignature(
  orderId:   string,
  paymentId: string,
  signature: string,
): boolean {
  if (!KEY_SECRET) return false
  try {
    const expected = crypto
      .createHmac('sha256', KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')
    // Constant-time compare to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    )
  } catch {
    return false
  }
}

/* ─── Verify webhook signature ───────────────────────────────────────── */

export function verifyWebhookSignature(
  rawBody:  string,
  header:   string,
  secret:   string,
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(header,   'hex'),
    )
  } catch {
    return false
  }
}