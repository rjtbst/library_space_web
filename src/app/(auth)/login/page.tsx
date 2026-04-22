// src/app/(auth)/login/page.tsx
'use client'

import { useState, useTransition, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithGoogle, sendOtp, verifyOtp } from '@/lib/actions/auth'

// ── Shared helpers ───────────────────────────────────────────────────────────
function Logo() {
  return (
    <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 40 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: '#1246FF', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(18,70,255,.35)' }}>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="7" rx="1.5" fill="white" fillOpacity="0.9"/>
          <rect x="9" y="2" width="5" height="5" rx="1.5" fill="white" fillOpacity="0.6"/>
          <rect x="2" y="11" width="12" height="3" rx="1.5" fill="white" fillOpacity="0.4"/>
        </svg>
      </div>
      <span style={{ fontSize: 22, fontFamily: 'Instrument Serif, serif', color: '#0A0D12' }}>
        Library<span style={{ color: '#1246FF', fontFamily: 'Syne, sans-serif', fontWeight: 800 }}>Space</span>
      </span>
    </Link>
  )
}

function Spinner({ color = '#fff' }: { color?: string }) {
  return (
    <span style={{ width: 16, height: 16, border: `2px solid ${color}40`, borderTopColor: color, borderRadius: '50%', display: 'inline-block', animation: 'spin .65s linear infinite', flexShrink: 0 }} />
  )
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{ background: '#FDEAEA', border: '1px solid rgba(212,43,43,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}>⚠️</span>
      <p style={{ fontSize: 13, color: '#9B1C1C', margin: 0, lineHeight: 1.4 }}>{msg}</p>
    </div>
  )
}

// ── 6-box OTP input ──────────────────────────────────────────────────────────
function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')

  const focus = (idx: number) =>
    (document.getElementById(`otp-${idx}`) as HTMLInputElement | null)?.focus()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const val = e.target.value.replace(/\D/g, '').slice(-1)
    const next = digits.map((d, i) => (i === idx ? val : d)).join('')
    onChange(next)
    if (val && idx < 5) focus(idx + 1)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) focus(idx - 1)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    onChange(pasted)
    focus(Math.min(pasted.length, 5))
  }

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
      {digits.map((d, i) => (
        <input
          key={i} id={`otp-${i}`} type="text" inputMode="numeric" maxLength={1} value={d}
          onChange={e => handleChange(e, i)}
          onKeyDown={e => handleKey(e, i)}
          onPaste={handlePaste}
          style={{ width: 46, height: 54, textAlign: 'center', fontSize: 22, fontWeight: 700, border: `2px solid ${d ? '#1246FF' : '#E2DDD4'}`, borderRadius: 10, outline: 'none', color: '#0A0D12', background: d ? '#E8EFFE' : '#FDFCF9', fontFamily: 'DM Sans, sans-serif', transition: 'border-color .15s, background .15s', cursor: 'text' }}
          onFocus={e => (e.target.style.borderColor = '#1246FF')}
          onBlur={e => { if (!d) e.target.style.borderColor = '#E2DDD4' }}
        />
      ))}
    </div>
  )
}

// ── Main content ─────────────────────────────────────────────────────────────
function LoginContent() {
  const params     = useSearchParams()
  const router     = useRouter()
  const isSignup   = params.get('mode') === 'signup'
  const isOwner    = params.get('role') === 'owner'
  const redirectTo = params.get('redirect') ?? undefined

  const [tab,      setTab]      = useState<'google' | 'phone'>('google')
  const [step,     setStep]     = useState<'phone' | 'otp'>('phone')
  const [phone,    setPhone]    = useState('')
  const [otp,      setOtp]      = useState('')
  const [errMsg,   setErrMsg]   = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [isPending, start]      = useTransition()

  const resetError = () => setErrMsg('')

  const startCountdown = () => {
    setResendIn(60)
    const t = setInterval(() =>
      setResendIn(s => { if (s <= 1) { clearInterval(t); return 0 } return s - 1 }), 1000)
  }

  // Google
  const handleGoogle = () => {
    resetError()
    start(async () => {
      const res = await signInWithGoogle(redirectTo)
      if (res.success === false) {
  setErrMsg(res.error)
  return
}
      window.location.href = res.data.url
    })
  }

  // Send OTP
  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault(); resetError()
    start(async () => {
      const res = await sendOtp(`+91${phone}`)
      if (res.success === false) {
  setErrMsg(res.error)
  return
}
      setStep('otp'); startCountdown()
    })
  }

  // Verify OTP
  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault(); resetError()
    start(async () => {
      const res = await verifyOtp(`+91${phone}`, otp)
if (res.success === false) {
  const { error } = res
  setErrMsg(error)
  setOtp('')
  return
}

const { data } = res
router.push(data.redirectTo)
router.refresh()
     
    })
  }

  // Resend OTP
  const handleResend = () => {
    setOtp(''); resetError()
    start(async () => {
      const res = await sendOtp(`+91${phone}`)
      if (res.success === false) {
  setErrMsg(res.error)
  return
}
      startCountdown()
    })
  }

  const switchTab = (t: 'google' | 'phone') => {
    setTab(t); setStep('phone'); resetError(); setOtp('')
  }

  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '14px 0', borderRadius: 10, fontSize: 15, fontWeight: 700,
    fontFamily: 'Syne, sans-serif', border: 'none', cursor: 'pointer',
    background: '#1246FF', color: '#fff', boxShadow: '0 4px 16px rgba(18,70,255,.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all .15s',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#F4F7FB 0%,#EDE8DC 100%)', fontFamily: 'DM Sans, sans-serif', padding: '24px 16px', position: 'relative' }}>
      {/* Decorative blobs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', width: 500, height: 500, top: -150, right: -100, borderRadius: '50%', background: 'radial-gradient(circle,rgba(18,70,255,.07),transparent 70%)' }} />
        <div style={{ position: 'absolute', width: 400, height: 400, bottom: -100, left: -80, borderRadius: '50%', background: 'radial-gradient(circle,rgba(13,124,84,.05),transparent 70%)' }} />
      </div>

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        <Logo />

        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 20, padding: '36px 32px', boxShadow: '0 4px 32px rgba(10,13,18,.08)' }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 26, color: '#0A0D12', letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: 8 }}>
              {isSignup ? (isOwner ? '📚 List your library' : '🎓 Start studying smarter') : '👋 Welcome back'}
            </h1>
            <p style={{ fontSize: 14, color: '#6B7689', fontWeight: 300, lineHeight: 1.5, margin: 0 }}>
              {isSignup
                ? (isOwner ? 'Create your owner account in 60 seconds.' : 'Book your study seat in 60 seconds.')
                : 'Sign in to your LibrarySpace account.'}
            </p>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: '#F4F7FB', borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {(['google', 'phone'] as const).map(t => (
              <button key={t} onClick={() => switchTab(t)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all .15s', background: tab === t ? '#FDFCF9' : 'transparent', color: tab === t ? '#0A0D12' : '#9AAAB8', boxShadow: tab === t ? '0 1px 6px rgba(10,13,18,.09)' : 'none', fontFamily: 'DM Sans, sans-serif' }}>
                {t === 'google' ? '🌐  Google' : '📱  Phone OTP'}
              </button>
            ))}
          </div>

          {errMsg && <ErrorBanner msg={errMsg} />}

          {/* ── Google ── */}
          {tab === 'google' && (
            <div>
              <button onClick={handleGoogle} disabled={isPending}
                style={{ ...primaryBtn, background: isPending ? '#F4F7FB' : '#fff', color: '#0A0D12', boxShadow: 'none', border: '1.5px solid #E2DDD4', cursor: isPending ? 'wait' : 'pointer' }}
                onMouseEnter={e => { if (!isPending) e.currentTarget.style.background = '#F4F7FB' }}
                onMouseLeave={e => { if (!isPending) e.currentTarget.style.background = '#fff' }}
              >
                {isPending ? <Spinner color="#1246FF" /> : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.075 17.64 11.767 17.64 9.2z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                )}
                {isPending ? 'Redirecting...' : 'Continue with Google'}
              </button>
              <div style={{ margin: '18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: '#E2DDD4' }} />
                <span style={{ fontSize: 12, color: '#9AAAB8', whiteSpace: 'nowrap' }}>or use phone number</span>
                <div style={{ flex: 1, height: 1, background: '#E2DDD4' }} />
              </div>
              <button onClick={() => switchTab('phone')}
                style={{ width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'transparent', color: '#1246FF', border: '1.5px solid rgba(18,70,255,.25)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', transition: 'background .15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E8EFFE')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Use phone number instead →
              </button>
            </div>
          )}

          {/* ── Phone — enter number ── */}
          {tab === 'phone' && step === 'phone' && (
            <form onSubmit={handleSendOtp}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3A4A5C', display: 'block', marginBottom: 6 }}>Mobile number</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <div style={{ padding: '12px 14px', background: '#F4F7FB', border: '1.5px solid #E2DDD4', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A4A5C', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
                  🇮🇳 +91
                </div>
                <input type="tel" placeholder="98765 43210" value={phone} autoFocus
                  onChange={e => { resetError(); setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)) }}
                  style={{ flex: 1, padding: '12px 14px', border: '1.5px solid #E2DDD4', borderRadius: 10, fontSize: 15, color: '#0A0D12', outline: 'none', fontFamily: 'DM Sans, sans-serif', background: '#FDFCF9', transition: 'border-color .15s, box-shadow .15s', cursor: 'text' }}
                  onFocus={e => { e.target.style.borderColor = '#1246FF'; e.target.style.boxShadow = '0 0 0 3px rgba(18,70,255,.1)' }}
                  onBlur={e => { e.target.style.borderColor = '#E2DDD4'; e.target.style.boxShadow = 'none' }}
                />
              </div>
              <button type="submit" disabled={isPending || phone.length < 10}
                style={{ ...primaryBtn, opacity: phone.length < 10 ? 0.5 : 1, cursor: phone.length < 10 ? 'not-allowed' : 'pointer', boxShadow: phone.length >= 10 ? '0 4px 16px rgba(18,70,255,.3)' : 'none' }}>
                {isPending ? <Spinner /> : null}
                {isPending ? 'Sending OTP...' : 'Send OTP →'}
              </button>
            </form>
          )}

          {/* ── Phone — OTP entry ── */}
          {tab === 'phone' && step === 'otp' && (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <p style={{ fontSize: 14, color: '#6B7689', marginBottom: 6 }}>
                  OTP sent to <strong style={{ color: '#0A0D12' }}>+91 {phone}</strong>
                </p>
                <button type="button" onClick={() => { setStep('phone'); setOtp(''); resetError() }}
                  style={{ fontSize: 12, color: '#1246FF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'DM Sans, sans-serif' }}>
                  ← Change number
                </button>
              </div>
              <OtpBoxes value={otp} onChange={v => { setOtp(v); resetError() }} />
              <button type="submit" disabled={isPending || otp.length < 6}
                style={{ ...primaryBtn, opacity: otp.length < 6 ? 0.5 : 1, cursor: otp.length < 6 ? 'not-allowed' : 'pointer', boxShadow: otp.length >= 6 ? '0 4px 16px rgba(18,70,255,.3)' : 'none' }}>
                {isPending ? <Spinner /> : null}
                {isPending ? 'Verifying...' : 'Verify & Continue →'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                {resendIn > 0
                  ? <p style={{ fontSize: 13, color: '#9AAAB8', margin: 0 }}>Resend in <strong style={{ color: '#6B7689' }}>{resendIn}s</strong></p>
                  : <button type="button" onClick={handleResend} disabled={isPending}
                      style={{ fontSize: 13, color: '#1246FF', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'DM Sans, sans-serif' }}>
                      Resend OTP
                    </button>
                }
              </div>
            </form>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: '#9AAAB8', marginTop: 20, lineHeight: 1.6 }}>
            By continuing you agree to our{' '}
            <Link href="/terms" style={{ color: '#6B7689', textDecoration: 'underline' }}>Terms</Link>
            {' & '}
            <Link href="/privacy" style={{ color: '#6B7689', textDecoration: 'underline' }}>Privacy Policy</Link>
          </p>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: '#6B7689' }}>
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
          <Link href={isSignup ? '/login' : '/login?mode=signup'} style={{ color: '#1246FF', fontWeight: 700, textDecoration: 'none' }}>
            {isSignup ? 'Sign in' : 'Sign up free'}
          </Link>
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F7FB' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E2DDD4', borderTopColor: '#1246FF', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}