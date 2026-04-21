
import { Syne, Instrument_Serif, DM_Sans } from 'next/font/google'
import './globals.css'

/* ─── Font Loading ─── */
const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-dm',
  display: 'swap',
})

/* ─── Metadata ─── */
export const metadata = {
  title: {
    default: 'LibrarySpace — Book Your Study Seat',
    template: '%s | LibrarySpace',
  },
  description:
    'Find the perfect study library near you, see live seat availability, and reserve your spot — all before you leave home.',
  keywords: [
    'library booking',
    'study seat',
    'seat reservation',
    'UPSC study library',
     'Haldwani library',
    'study room booking',
    'library management',
  ],
  authors: [{ name: 'LibrarySpace' }],
  creator: 'LibrarySpace',
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: 'https://libraryspace.in',
    siteName: 'LibrarySpace',
    title: 'LibrarySpace — Book Your Study Seat',
    description:
      'Find the perfect study library near you, see live seat availability, and reserve your spot — all before you leave home.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LibrarySpace — Book Your Study Seat',
    description:
      'Find the perfect study library near you, see live seat availability, and reserve your spot.',
  },
  
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#FDFCF9',
}

/* ─── Root Layout ─── */
export default function RootLayout({
  children,
}) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${instrumentSerif.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <body className="font-dm bg-surface text-ink antialiased overflow-x-hidden">
        {/* Custom cursor — rendered only on pointer:fine devices via CSS */}
        <div id="cursor-dot" aria-hidden="true" />
        <div id="cursor-ring" aria-hidden="true" />

        {children}
      </body>
    </html>
  )
}