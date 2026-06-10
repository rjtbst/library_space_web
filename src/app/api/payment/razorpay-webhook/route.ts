// app/api/payment/razorpay-webhook/route.ts
/**
 * Razorpay webhook handler.
 *
 * Configure in Razorpay Dashboard → Webhooks:
 *   URL: https://yourdomain.com/api/payment/razorpay-webhook
 *   Events: payment.captured, payment.failed
 *   Secret: set RAZORPAY_WEBHOOK_SECRET env var to match
 *
 * This is a safety net — the client-side confirmation flow handles
 * the happy path. This webhook catches edge cases where the user
 * closes the browser before the success callback fires.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/razorpay/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Must use nodejs runtime — crypto is not available in edge
export const runtime = 'nodejs'

// Disable body parsing — we need the raw body for signature verification
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''

  if (!secret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Read raw body for signature verification
  const rawBody = await req.text()

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn('[webhook] Signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { event: string; payload: any }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  try {
    switch (event.event) {
      case 'payment.captured': {
        const payment  = event.payload?.payment?.entity
        if (!payment) break

        const orderId   = payment.order_id  as string
        const paymentId = payment.id        as string

        // Find our payment record by Razorpay order ID
        const { data: payRecord } = await (supabase as any)
          .from('payments')
          .select('id, booking_id, subscription_id')
          .eq('razorpay_order_id', orderId)
          .maybeSingle() as {
            data: {
              id: string
              booking_id:      string | null
              subscription_id: string | null
            } | null
          }

        if (!payRecord) {
          console.warn('[webhook] payment.captured — no payment record for order:', orderId)
          break
        }

        // Update payment status
        await (supabase as any)
          .from('payments')
          .update({ status: 'paid', razorpay_payment_id: paymentId })
          .eq('id', payRecord.id)

        // Confirm booking if applicable
        if (payRecord.booking_id) {
          const { error: bErr } = await supabase
            .from('bookings')
            .update({ status: 'confirmed' as never, hold_expires_at: null } as never)
            .eq('id', payRecord.booking_id)
            .eq('status', 'held' as never)

          if (bErr) {
            console.error('[webhook] Failed to confirm booking:', payRecord.booking_id, bErr.message)
          } else {
            console.log('[webhook] Booking confirmed:', payRecord.booking_id)
          }
        }

        // Activate subscription if applicable
        if (payRecord.subscription_id) {
          const { error: sErr } = await supabase
            .from('subscriptions')
            .update({ status: 'active' as never } as never)
            .eq('id', payRecord.subscription_id)
            .eq('status', 'pending' as never)

          if (sErr) {
            console.error('[webhook] Failed to activate subscription:', payRecord.subscription_id, sErr.message)
          } else {
            console.log('[webhook] Subscription activated:', payRecord.subscription_id)
          }
        }

        break
      }

      case 'payment.failed': {
        const payment = event.payload?.payment?.entity
        if (!payment) break

        const orderId = payment.order_id as string

        // Mark payment as failed
        await (supabase as any)
          .from('payments')
          .update({ status: 'failed' })
          .eq('razorpay_order_id', orderId)

        // Cancel the held booking (if any)
        const { data: payRecord } = await (supabase as any)
          .from('payments')
          .select('booking_id')
          .eq('razorpay_order_id', orderId)
          .maybeSingle() as { data: { booking_id: string | null } | null }

        if (payRecord?.booking_id) {
          await supabase
            .from('bookings')
            .update({ status: 'cancelled' as never } as never)
            .eq('id', payRecord.booking_id)
            .eq('status', 'held' as never)

          console.log('[webhook] Booking cancelled (payment.failed):', payRecord.booking_id)
        }

        break
      }

      default:
        // Acknowledge but don't process unknown events
        console.log('[webhook] Unhandled event type:', event.event)
        break
    }
  } catch (err) {
    // Always return 200 to prevent Razorpay from retrying indefinitely
    console.error('[webhook] Handler error:', err)
  }

  // Return 200 so Razorpay marks the event as delivered
  return NextResponse.json({ received: true })
}