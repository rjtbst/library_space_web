'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProfile } from '@/lib/actions/auth'
import { STATE_CITY_MAP } from '@/lib/config'

export default function StaffProfilePage() {
  const router = useRouter()

  const [name, setName] = useState('')
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
        city
      })

      if (res.success === false) {
        setError(res.error)
        return
      }

      router.push(res.data.redirectTo)
    })
  }

  const cities = state ? STATE_CITY_MAP[state] || [] : []

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#F4F7FB,#EDE8DC)', fontFamily: 'DM Sans, sans-serif', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#C8A84B', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>🔑</div>
          <h1 style={{ fontSize: 26 }}>Staff profile</h1>
          <p style={{ fontSize: 14, color: '#6B7689' }}>Your library owner will link you to their library.</p>
        </div>

        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 20, padding: '32px 28px' }}>
          
          <form onSubmit={handleSubmit}>

            {/* Name */}
            <div style={{ marginBottom: 16 }}>
              <label>Your name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ width: '100%', padding: 12, border: '1px solid #E2DDD4', borderRadius: 10 }}
              />
            </div>

            {/* State */}
            <div style={{ marginBottom: 16 }}>
              <label>State *</label>
              <select
                value={state}
                onChange={e => {
                  setState(e.target.value)
                  setCity('')
                }}
                style={{ width: '100%', padding: 12, border: '1px solid #E2DDD4', borderRadius: 10 }}
              >
                <option value="">Select state</option>
                {Object.keys(STATE_CITY_MAP).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* City */}
            <div style={{ marginBottom: 20 }}>
              <label>City *</label>
              <select
                value={city}
                onChange={e => setCity(e.target.value)}
                disabled={!state}
                style={{
                  width: '100%',
                  padding: 12,
                  border: '1px solid #E2DDD4',
                  borderRadius: 10,
                  opacity: state ? 1 : 0.6
                }}
              >
                <option value="">Select city</option>
                {cities.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}

            <button type="submit" disabled={!valid || isPending}
              style={{
                width: '100%',
                padding: 14,
                background: valid ? '#C8A84B' : '#9AAAB8',
                color: '#fff',
                borderRadius: 10
              }}>
              {isPending ? 'Setting up...' : 'Go to scanner →'}
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}