// src/app/(auth)/onboarding/owner-profile/page.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProfile } from '@/lib/actions/auth'
import { STATE_CITY_MAP } from '@/lib/config'

export default function OwnerProfilePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const valid = name.trim().length >= 2 && state && city

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    startTransition(async () => {
      const res = await updateProfile({
        full_name: name.trim(),
        state,
        city,
        phone: phone ? `+91${phone}` : undefined
      })

      if (res.success === false) {
        setError(res.error)
        return
      }

      router.push(res.data.redirectTo)
    })
  }

  const cities = state ? STATE_CITY_MAP[state] || [] : []

  const inp: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    border: '1.5px solid #E2DDD4',
    borderRadius: 10,
    fontSize: 15,
    color: '#0A0D12',
    outline: 'none',
    fontFamily: 'DM Sans, sans-serif',
    background: '#FDFCF9',
    boxSizing: 'border-box',
    transition: 'border-color .15s, box-shadow .15s'
  }

  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = '#1246FF'
    e.target.style.boxShadow = '0 0 0 3px rgba(18,70,255,.1)'
  }

  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = '#E2DDD4'
    e.target.style.boxShadow = 'none'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#F4F7FB,#EDE8DC)', fontFamily: 'DM Sans, sans-serif', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#0D7C54', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 4px 16px rgba(13,124,84,.3)', fontSize: 22 }}>🏛️</div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 26, color: '#0A0D12', letterSpacing: '-0.04em', marginBottom: 6 }}>Set up your owner profile</h1>
          <p style={{ fontSize: 14, color: '#6B7689', fontWeight: 300 }}>You can add your library in the next step.</p>
        </div>

        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 20, padding: '32px 28px', boxShadow: '0 4px 24px rgba(10,13,18,.08)' }}>
          <form onSubmit={handleSubmit}>

            {/* Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3A4A5C', display: 'block', marginBottom: 6 }}>Your name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={inp} onFocus={onFocus} onBlur={onBlur} />
            </div>

            {/* Phone */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3A4A5C', display: 'block', marginBottom: 6 }}>
                Phone number <span style={{ color: '#9AAAB8' }}>(optional)</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ padding: '12px 14px', background: '#F4F7FB', border: '1.5px solid #E2DDD4', borderRadius: 10 }}>🇮🇳 +91</div>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  style={{ ...inp, flex: 1 }}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            </div>

            {/* State */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>State *</label>
              <select
                value={state}
                onChange={e => {
                  setState(e.target.value)
                  setCity('') // reset city when state changes
                }}
                style={inp}
                onFocus={onFocus}
                onBlur={onBlur}
              >
                <option value="">Select state</option>
                {Object.keys(STATE_CITY_MAP).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* City */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>City *</label>
              <select
                value={city}
                onChange={e => setCity(e.target.value)}
                disabled={!state}
                style={{ ...inp, cursor: state ? 'pointer' : 'not-allowed', opacity: state ? 1 : 0.6 }}
                onFocus={onFocus}
                onBlur={onBlur}
              >
                <option value="">Select city</option>
                {cities.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {error && <div style={{ background: '#FDEAEA', padding: 10, marginBottom: 16 }}>{error}</div>}

            <button type="submit" disabled={!valid || isPending}
              style={{ width: '100%', padding: 14, background: valid ? '#0D7C54' : '#9AAAB8', color: '#fff', borderRadius: 10 }}>
              {isPending ? 'Setting up...' : 'Go to dashboard →'}
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}