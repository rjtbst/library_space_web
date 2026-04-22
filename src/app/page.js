import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import HeroSection from '@/components/sections/HeroSection'
import PageEffects from '@/components/shared/PageEffects'
import {  FeaturesSection, HowItWorksSection, RolesSection, TestimonialsSection, PricingSection, CtaSection } from '@/components/sections/LandingSection'

export const metadata = {
  title: 'LibrarySpace — Book Study Seats Online | Haldwani Study Libraries',
  description: 'Find study libraries near you in Haldwani UP. Check live seat availability, book online, pay via UPI, get WhatsApp confirmation in 60 seconds. UPSC SSC Bank exam library booking.',
  alternates: { canonical: '/' },
  openGraph: { url: '/', title: 'LibrarySpace — Book Study Seats Online | Haldwani', description: 'Book your study seat at the best libraries in Haldwani. Live seat availability, instant booking, QR check-in.' },
}

export default function HomePage() {
  return (
    <>
      {/* Client-side cursor + scroll reveal */}
      <PageEffects />

      <Navbar />
      <main>
        <HeroSection />
        {/* <StatsBand/> */}
        <FeaturesSection />
        <HowItWorksSection />
        <RolesSection />
        <TestimonialsSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </>
  )
}