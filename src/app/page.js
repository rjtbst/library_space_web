import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import HeroSection from '@/components/sections/HeroSection'
import PageEffects from '@/components/shared/PageEffects'
import {  FeaturesSection, HowItWorksSection, RolesSection, TestimonialsSection, PricingSection, CtaSection } from '@/components/sections/LandingSection'

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