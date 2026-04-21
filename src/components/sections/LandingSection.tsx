'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useCountUp } from '@/hooks'
import {
  STATS, FEATURES, STEPS_STUDENT, ROLES, PRICING_PLANS, TESTIMONIALS,
  type Feature, type Step, type RoleCard, type PricingPlan, type Testimonial,
} from '@/lib/config'

/* ══════════════════════════════════════════
   STATS BAND
══════════════════════════════════════════ */
function StatItem({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const ref = useCountUp(value)
  return (
    <div className="flex-1 max-w-[220px] text-center px-6" style={{ borderRight: '1px solid rgba(255,255,255,.1)' }}>
      <div className="font-syne font-extrabold text-white" style={{ fontSize: 40, letterSpacing: -2, lineHeight: 1 }}>
        <span ref={ref}>0</span>
        <span className="text-blue">{suffix}</span>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6 }}>
        {label}
      </div>
    </div>
  )
}

export function StatsBand() {
  return (
    <div className="bg-ink py-10 px-10 flex justify-center overflow-hidden">
      <div className="flex justify-center [&>*:last-child]:border-r-0 flex-wrap gap-y-6 max-w-[900px] w-full">
        {STATS.map((s) => (
          <StatItem key={s.label} {...s} />
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   FEATURES
══════════════════════════════════════════ */
const accentColors = {
  blue:  { icon: 'rgba(18,70,255,.1)',  hover: 'rgba(18,70,255,.04)' },
  green: { icon: 'rgba(13,124,84,.1)',  hover: 'rgba(13,124,84,.04)' },
  gold:  { icon: 'rgba(200,168,75,.12)', hover: 'rgba(200,168,75,.05)' },
}

function FeatureCard({ feature }: { feature: Feature }) {
  const ac = accentColors[feature.accent]
  return (
    <div
      className={cn(
        'reveal rounded-[20px] p-7 border border-divider bg-surface cursor-pointer relative overflow-hidden group',
        'transition-all duration-250 hover:-translate-y-1',
        feature.large && 'md:col-span-2'
      )}
      style={{ boxShadow: 'none' }}
    >
      <div className="absolute inset-0 rounded-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-250"
        style={{ background: `linear-gradient(135deg, ${ac.hover}, transparent)` }}
      />
      <div className="relative z-10">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[22px] mb-4" style={{ background: ac.icon }}>
          {feature.icon}
        </div>
        <h3 className="font-syne font-bold text-ink mb-2" style={{ fontSize: 18, letterSpacing: -0.3 }}>
          {feature.title}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.65, fontWeight: 300 }}>
          {feature.description}
        </p>
      </div>
    </div>
  )
}

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-10 max-w-[1200px] mx-auto">
      <div className="reveal">
        <div className="section-eyebrow">Everything you need</div>
        <h2 className="section-title">
          Built for <em>serious</em><br />study culture
        </h2>
        <p className="section-sub">
          From real-time seat grids to book lending and owner dashboards — every feature is designed for Indian study libraries.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-14">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} feature={f} />
        ))}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════
   HOW IT WORKS
══════════════════════════════════════════ */
function StepItem({ step }: { step: Step }) {
  return (
    <div className="reveal text-center px-5 relative z-10 group">
      <div className="w-[60px] h-[60px] rounded-full border-2 border-white/15 flex items-center justify-center font-syne font-extrabold text-white/40 mx-auto mb-5 bg-ink group-hover:border-blue group-hover:text-blue group-hover:bg-blue/10 transition-all duration-300"
        style={{ fontSize: 20 }}
      >
        {step.num}
      </div>
      <span className="text-[28px] block mb-3">{step.icon}</span>
      <h3 className="font-syne font-bold text-white mb-2" style={{ fontSize: 16, letterSpacing: -0.2 }}>
        {step.title}
      </h3>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.6, fontWeight: 300 }}>
        {step.description}
      </p>
    </div>
  )
}

export function HowItWorksSection() {
  return (
    <section id="howitworks" className="relative overflow-hidden py-24 px-10 bg-ink">
      {/* Background text */}
    <div className="absolute pointer-events-none font-syne font-extrabold text-white/[0.05] select-none text-center 
   whitespace-normal md:whitespace-nowrap
  text-[clamp(48px,12vw,160px)] tracking-[-0.5vw] leading-[0.9]
  top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
  HOW IT WORKS
</div>

      <div className="max-w-[1200px] mx-auto relative z-10">
        <div className="reveal mb-14">
          <h2 className="font-syne font-extrabold text-white mb-2" style={{ fontSize: 'clamp(36px,5vw,60px)', letterSpacing: -2, lineHeight: 0.95 }}>
            Simple as <em style={{ fontFamily: 'Instrument Serif, serif', fontWeight: 400, color: 'var(--blue)', fontStyle: 'italic' }}>1, 2, 3</em>
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.4)', fontWeight: 300 }}>
            From searching to sitting — 60 seconds flat.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 relative">
          {/* Connector line */}
          <div className="absolute hidden md:block" style={{ top: 30, left: 60, right: 60, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.15), rgba(255,255,255,.15), transparent)', zIndex: 0 }} />
          {STEPS_STUDENT.map((step) => (
            <StepItem key={step.num} step={step} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════
   ROLES
══════════════════════════════════════════ */
function RoleCard({ role }: { role: RoleCard }) {
  return (
    <div
      className={cn(
        'reveal rounded-[24px] p-9 border-2 border-divider bg-surface overflow-hidden relative group',
        'transition-all duration-250 hover:-translate-y-1.5',
        `role-card-${role.variant}`
      )}
      style={{ boxShadow: 'none' }}
    >
      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 rounded-b-[24px] scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
        style={{ background: role.accent }}
      />
      <span className="text-[40px] block mb-4">{role.emoji}</span>
      <h3 className="font-syne font-extrabold text-ink mb-1.5" style={{ fontSize: 22, letterSpacing: -0.4 }}>
        {role.title}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.55, fontWeight: 300 }}>
        {role.subtitle}
      </p>
      {role.features.map((f) => (
        <div key={f} className="flex items-center gap-2 py-1.5 border-b border-divider last:border-0 text-[13px] text-ink">
          <div className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[10px] flex-shrink-0"
            style={{ background: `${role.accent}1A`, color: role.accent }}
          >✓</div>
          {f}
        </div>
      ))}
      <Link
        href={role.variant === 'owner' ? '/login?mode=signup&role=owner' : '/login?mode=signup'}
        className="block w-full text-center mt-5 py-3 rounded-[10px] text-[13px] font-bold font-syne transition-all duration-200"
        style={{ background: `${role.accent}15`, color: role.accent, border: `1.5px solid ${role.accent}30` }}
        onMouseEnter={e => { e.currentTarget.style.background = `${role.accent}25` }}
        onMouseLeave={e => { e.currentTarget.style.background = `${role.accent}15` }}
      >
        {role.variant === 'student' ? 'Find a library →' : role.variant === 'owner' ? 'Add your library →' : 'Learn more →'}
      </Link>
    </div>
  )
}

export function RolesSection() {
  return (
    <section id="roles" className="py-24 px-10 max-w-[1200px] mx-auto">
      <div className="reveal">
        <div className="section-eyebrow">Who it's for</div>
        <h2 className="section-title">
          Built for <em>everyone</em><br />in the library
        </h2>
        <p className="section-sub">
          Whether you study, run, or staff a library — LibrarySpace has a dedicated experience for you.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-14">
        {ROLES.map((r) => (
          <RoleCard key={r.variant} role={r} />
        ))}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════
   TESTIMONIALS
══════════════════════════════════════════ */
function TestCard({ t }: { t: Testimonial }) {
  return (
    <div className="flex-shrink-0 bg-surface rounded-2xl p-6 border border-divider" style={{ width: 300 }}>
      <div style={{ color: 'var(--gold)', fontSize: 14, letterSpacing: 2, marginBottom: 12 }}>★★★★★</div>
      <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.65, marginBottom: 16, fontWeight: 300 }}>
        "{t.text}"
      </p>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0"
          style={{ background: t.color }}
        >
          {t.name[0]}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.role}</div>
        </div>
      </div>
    </div>
  )
}

export function TestimonialsSection() {
  const doubled = [...TESTIMONIALS, ...TESTIMONIALS]
  return (
    <section id="testimonials" className="py-24 overflow-hidden" style={{ background: 'var(--warm)' }}>
      <div className="max-w-[1200px] mx-auto px-10 mb-10 reveal">
        <div className="section-eyebrow">Loved by students & owners</div>
        <h2 className="section-title">
          What they <em>say</em>
        </h2>
      </div>
      {/* Scrolling track */}
      <div className="overflow-hidden">
        <div className="flex gap-5 animate-scroll-left hover:[animation-play-state:paused]"
          style={{ width: 'max-content' }}
        >
          {doubled.map((t, i) => (
            <TestCard key={i} t={t} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════
   PRICING
══════════════════════════════════════════ */
function PriceCard({ plan }: { plan: PricingPlan }) {
  return (
    <div className={cn(
      'reveal rounded-[24px] p-8 border-2 relative transition-all duration-250 hover:-translate-y-1',
      plan.featured
        ? 'border-blue bg-ink text-white -translate-y-2 hover:-translate-y-3'
        : 'border-divider bg-surface'
    )}>
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue text-white text-[10px] font-bold px-3.5 py-1 rounded-full font-syne tracking-wide">
          {plan.badge}
        </div>
      )}
      <div className={cn('text-[14px] font-bold uppercase tracking-[0.1em] mb-2.5', plan.featured ? 'text-white/50' : 'text-muted')}>
        {plan.name}
      </div>
      <div className={cn('font-syne font-extrabold', plan.featured ? 'text-white' : 'text-ink')} style={{ fontSize: 42, letterSpacing: -2, lineHeight: 1 }}>
        {plan.price}
      </div>
      <div className={cn('text-[13px] mt-1 mb-5', plan.featured ? 'text-white/40' : 'text-muted')}>
        {plan.period}
      </div>
      <p className={cn('text-[13px] mb-5', plan.featured ? 'text-white/50' : 'text-muted')}>
        {plan.description}
      </p>
      <div className={cn('h-px mb-5', plan.featured ? 'bg-white/10' : 'bg-divider')} />
      {plan.features.map((f) => (
        <div key={f} className={cn('flex items-center gap-2 py-1.5 text-[13px] border-b last:border-0', plan.featured ? 'text-white/60 border-white/8' : 'text-muted border-divider')}>
          <span className={plan.featured ? 'text-green-2' : 'text-green'}style={{ fontSize: 14, flexShrink: 0 }}>✓</span>
          {f}
        </div>
      ))}
      <Link
        href={plan.name === 'Enterprise' ? '/contact' : '/login?mode=signup'}
        className={cn(
          'w-full py-3.5 rounded-[10px] text-[14px] font-bold mt-6 transition-all duration-200 font-syne block text-center',
          plan.featured
            ? 'bg-blue border-2 border-blue text-white shadow-blue hover:bg-blue-dk'
            : 'bg-transparent border-2 border-divider text-ink hover:bg-warm hover:border-ink'
        )}
      >
        {plan.cta}
      </Link>
    </div>
  )
}

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 px-10 max-w-[1200px] mx-auto">
      <div className="reveal text-center mb-14">
        <div className="section-eyebrow">Simple pricing</div>
        <h2 className="section-title">
          Start free, <em>grow</em> as you scale
        </h2>
        <p className="section-sub mx-auto text-center">
          No hidden fees. Cancel anytime. First 14 days free on all paid plans.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {PRICING_PLANS.map((p) => (
          <PriceCard key={p.name} plan={p} />
        ))}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════
   CTA
══════════════════════════════════════════ */
export function CtaSection() {
  return (
    <section id="cta" className="py-28 px-10 bg-ink text-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(18,70,255,.12), transparent)' }} />
      <div className="relative z-10 max-w-[800px] mx-auto">
        <h2 className="reveal font-syne font-extrabold text-white mb-5" style={{ fontSize: 'clamp(40px,6vw,80px)', letterSpacing: -3, lineHeight: 0.95 }}>
          Your seat is{' '}
          <em style={{ color: 'var(--blue)', fontFamily: 'Instrument Serif, serif', fontWeight: 400, fontStyle: 'italic' }}>waiting</em>
        </h2>
        <p className="reveal delay-200 text-white/40 font-light mb-10" style={{ fontSize: 18 }}>
          Join 2,400+ students who never waste a trip to a full library.
        </p>
        <div className="reveal delay-300 flex gap-3 justify-center flex-wrap">
          <Link
            href="/login?mode=signup"
            style={{ padding: '18px 40px', borderRadius: 12, fontSize: 16, fontWeight: 700, background: 'var(--blue)', color: '#fff', fontFamily: 'Syne, sans-serif', boxShadow: '0 4px 32px rgba(18,70,255,.4)', display: 'inline-block' }}
          >
            Get started free →
          </Link>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ padding: '18px 32px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: 'transparent', color: 'rgba(255,255,255,.7)', border: '2px solid rgba(255,255,255,.15)', cursor: 'pointer' }}
          >
            See all features
          </button>
        </div>
        <p className="reveal delay-400 text-white/25 mt-5" style={{ fontSize: 13 }}>
          Free forever for 1 library · No credit card needed
        </p>
      </div>
    </section>
  )
}