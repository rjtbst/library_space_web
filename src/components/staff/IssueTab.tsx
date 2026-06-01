'use client'

// src/app/(staff)/staff/books/_components/IssueTab.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import type { CatalogBook, BookIssue } from '@/lib/actions/staff-book-action'
import { searchBooks, issueBook } from '@/lib/actions/staff-book-action'
import { ACCENT } from '@/lib/constants/theme'

type Props = {
  libraryId: string
  catalog:   CatalogBook[]
  onIssued:  (updatedCatalog: CatalogBook[], newIssue: BookIssue) => void
}

// Default due date = today + 14 days
function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().split('T')[0]
}

export default function IssueTab({ libraryId, catalog, onIssued }: Props) {
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState<CatalogBook[]>([])
  const [searching,    setSearching]    = useState(false)
  const [selected,     setSelected]     = useState<CatalogBook | null>(null)
  const [selectedCopy, setSelectedCopy] = useState<string>('')
  const [name,         setName]         = useState('')
  const [phone,        setPhone]        = useState('')
  const [dueDate,      setDueDate]      = useState(defaultDueDate)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [success,      setSuccess]      = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search
  const handleQuery = useCallback((val: string) => {
    setQuery(val)
    setSelected(null)
    setError(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const res = await searchBooks(libraryId, val)
      setResults(res)
      setSearching(false)
    }, 350)
  }, [libraryId])

  const handleSelect = (book: CatalogBook) => {
    setSelected(book)
    setQuery(book.title)
    setResults([])
    const firstAvail = book.copies.find(c => c.status === 'available')
    setSelectedCopy(firstAvail?.copyId ?? '')
    setError(null)
  }

  const handleSubmit = async () => {
    if (!selected)        return setError('Select a book first')
    if (!selectedCopy)    return setError('No available copy selected')
    if (!name.trim())     return setError('Borrower name is required')
    if (!dueDate)         return setError('Due date is required')

    setLoading(true)
    setError(null)
    const res = await issueBook({
      libraryId,
      copyId:     selectedCopy,
      guestName:  name.trim(),
      guestPhone: phone.trim(),
      dueDate,
    })
    setLoading(false)

      if (res.success === false) {
        setError(res.error)
        return
      }

    // Build the new BookIssue for optimistic UI
    const now = new Date().toISOString()
    const newIssue: BookIssue = {
      issueId:     res.data!.issueId,
      bookId:      selected.bookId,
      copyId:      selectedCopy,
      title:       selected.title,
      author:      selected.author,
      issuedTo:    name.trim(),
      phone:       phone.trim() || null,
      isGuest:     true,
      userId:      null,
      issuedAt:    now,
      dueDate,
      isOverdue:   false,
      daysOverdue: 0,
    }

    // Update catalog optimistically
    const updatedCatalog = catalog.map(b =>
      b.bookId === selected.bookId
        ? {
            ...b,
            availableCopies: b.availableCopies - 1,
            issuedCopies:    b.issuedCopies + 1,
            copies: b.copies.map(c =>
              c.copyId === selectedCopy ? { ...c, status: 'issued' as const } : c
            ),
          }
        : b
    )

    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      setQuery('')
      setSelected(null)
      setName('')
      setPhone('')
      setDueDate(defaultDueDate())
      setSelectedCopy('')
      onIssued(updatedCatalog, newIssue)
    }, 900)
  }

  const availCopies = selected?.copies.filter(c => c.status === 'available') ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Book search */}
      <div>
        <label style={labelStyle}>Search Book</label>
        <div style={{ position: 'relative' }}>
          <input
            value={query}
            onChange={e => handleQuery(e.target.value)}
            placeholder="Title, author, or ISBN…"
            style={inputStyle}
          />
          {searching && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9AAAB8' }}>
              searching…
            </span>
          )}
        </div>

        {results.length > 0 && !selected && (
          <div style={{
            border: '1px solid #E2DDD4', borderRadius: 10, overflow: 'hidden',
            marginTop: 4, background: '#fff',
            boxShadow: '0 4px 16px rgba(10,13,18,.08)',
          }}>
            {results.map((book, i) => (
              <button
                key={book.bookId}
                onClick={() => handleSelect(book)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderTop: i > 0 ? '1px solid #F4F7FB' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0D12' }}>{book.title}</div>
                  {book.author && <div style={{ fontSize: 11, color: '#9AAAB8', marginTop: 1 }}>{book.author}</div>}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: book.availableCopies > 0 ? '#ECFDF5' : '#FEF2F2',
                  color: book.availableCopies > 0 ? '#059669' : '#DC2626',
                }}>
                  {book.availableCopies} avail
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected book info */}
      {selected && (
        <div style={{
          background: '#F4F7FB', borderRadius: 10, padding: '12px 14px',
          border: '1px solid #E2DDD4',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0A0D12', fontFamily: 'Syne, sans-serif' }}>
                {selected.title}
              </div>
              {selected.author && (
                <div style={{ fontSize: 11, color: '#9AAAB8', marginTop: 2 }}>{selected.author}</div>
              )}
            </div>
            <button
              onClick={() => { setSelected(null); setQuery('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AAAB8', fontSize: 16, padding: 0 }}
            >
              ✕
            </button>
          </div>

          {availCopies.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <label style={{ ...labelStyle, marginBottom: 4, display: 'block' }}>Copy</label>
              <select
                value={selectedCopy}
                onChange={e => setSelectedCopy(e.target.value)}
                style={{ ...inputStyle, paddingTop: 8, paddingBottom: 8 }}
              >
                {availCopies.map((c, i) => (
                  <option key={c.copyId} value={c.copyId}>Copy #{i + 1}</option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
              No copies available
            </div>
          )}
        </div>
      )}

      {/* Borrower details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>Borrower Name *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full name"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Phone (optional)</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="10-digit mobile"
            type="tel"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Due Date *</label>
          <input
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            type="date"
            style={inputStyle}
          />
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || success || !selected || availCopies.length === 0}
        style={{
          background:    success ? '#059669' : ACCENT,
          color:         '#fff',
          border:        'none',
          borderRadius:  10,
          padding:       '13px 0',
          fontSize:      14,
          fontWeight:    700,
          cursor:        loading || success ? 'default' : 'pointer',
          fontFamily:    'DM Sans, sans-serif',
          opacity:       (!selected || availCopies.length === 0) ? 0.5 : 1,
          transition:    'background .2s',
        }}
      >
        {success ? '✓ Issued!' : loading ? 'Issuing…' : '📤 Issue Book'}
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display:     'block',
  fontSize:    11,
  fontWeight:  600,
  color:       '#9AAAB8',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontFamily:  'DM Sans, sans-serif',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  boxSizing:    'border-box',
  padding:      '10px 12px',
  borderRadius: 8,
  border:       '1px solid #E2DDD4',
  background:   '#FDFCF9',
  fontSize:     13,
  color:        '#0A0D12',
  fontFamily:   'DM Sans, sans-serif',
  outline:      'none',
}