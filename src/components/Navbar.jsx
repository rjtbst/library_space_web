"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronDown, Phone, Search as SearchIcon } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/input";

// ── Config imports — single source of truth ──────────────────────────────────
import { navCourseLinks, searchCourses } from "@/config/coursesConfig";
import { navServiceLinks, searchServices } from "@/config/servicesConfig";

// ─────────────────────────────────────────────────────────────────────────────

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();

  // Derive search results reactively from both configs
  const courseResults = searchQuery.trim() ? searchCourses(searchQuery).slice(0, 3) : [];
  const serviceResults = searchQuery.trim() ? searchServices(searchQuery).slice(0, 4) : [];
  const hasResults = courseResults.length > 0 || serviceResults.length > 0;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setOpenDropdown(null);
  }, [pathname]);

  // ── Navigate to service: go to /it-services, then scroll + open accordion ──
  const handleServiceClick = (slug) => {
    setSearchQuery("");
    setIsSearchOpen(false);
    // If already on /it-services, just update the hash (ITServicesClient listens to hashchange)
    if (pathname === "/it-services") {
      window.location.hash = slug;
    } else {
      router.push(`/it-services#${slug}`);
    }
  };

  // ── Navigate to course page ──
  const handleCourseClick = (href) => {
    setSearchQuery("");
    setIsSearchOpen(false);
    router.push(href);
  };

  const DropdownMenu = ({ label, items }) => (
    <div
      className="relative group"
      onMouseEnter={() => setOpenDropdown(label)}
      onMouseLeave={() => setOpenDropdown(null)}
    >
      <button className="flex items-center gap-1.5 text-[15px] font-medium text-foreground hover:text-primary transition-colors py-2">
        {label}
        <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:rotate-180" />
      </button>

      <AnimatePresence>
        {openDropdown === label && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 w-64 bg-card rounded-xl p-2 z-50 border border-border shadow-lg"
          >
            {items.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className="block px-4 py-2.5 text-sm rounded-lg text-foreground hover:bg-primary/5 hover:text-primary"
              >
                {item.name}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-background shadow-sm border-b border-border/40" : "bg-background"
      }`}
    >
      <div className="container-main flex items-center justify-between h-[68px]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
           <img
  src="/logo.png"
  alt="Aartechus Logo"
  className="h-16 w-auto object-contain"
/>
          {/* <span className="text-[22px] font-bold">Aartechus</span> */}
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-8">
          <Link href="/courses" className="text-[15px] font-medium hover:text-primary">
            <DropdownMenu label="Courses" items={navCourseLinks} />
          </Link>
          <Link href="/it-services" className="text-[15px] font-medium hover:text-primary">
            Services
          </Link>
          <Link href="/blog" className="text-[15px] font-medium hover:text-primary">Blog</Link>
                      <Link href="/jobs" className="text-[15px] font-medium hover:text-primary">Jobs</Link>
          <Link href="/about" className="text-[15px] font-medium hover:text-primary">About</Link>

        </div>

        {/* CTA + Search */}
        <div className="hidden lg:flex items-center gap-3">
          {/* Live search box */}
          <div className="relative" ref={searchRef}>
            <div className="w-48">
              <Input
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchOpen(true)}
                onBlur={() => setTimeout(() => setIsSearchOpen(false), 200)}
                className="w-full"
              />
            </div>

            <AnimatePresence>
              {isSearchOpen && searchQuery.trim() && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full right-0 mt-2 w-96 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50"
                >
                  {hasResults ? (
                    <div className="max-h-[480px] overflow-y-auto">

                      {/* Courses group */}
                      {courseResults.length > 0 && (
                        <>
                          <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              Courses
                            </span>
                            <button
                              onMouseDown={() => handleCourseClick("/courses")}
                              className="text-[10px] text-primary hover:underline"
                            >
                              View all
                            </button>
                          </div>
                          {courseResults.map((course) => (
                            <button
                              key={course.id}
                              onMouseDown={() => handleCourseClick(course.href)}
                              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-primary/5 transition-colors border-b border-border/50 last:border-0 text-left"
                            >
                              <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                                style={{ background: course.color }}
                              >
                                {course.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-sm text-foreground truncate">
                                    {course.title}
                                  </h4>
                                  {course.badge && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold flex-shrink-0">
                                      {course.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {course.duration}  · {course.modes.map((m) => m === "live" ? "Live" : "Self-paced").join(", ")}
                                </p>
                              </div>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Services group */}
                      {serviceResults.length > 0 && (
                        <>
                          <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              IT Services
                            </span>
                            <button
                              onMouseDown={() => handleServiceClick("")}
                              className="text-[10px] text-primary hover:underline"
                            >
                              View all
                            </button>
                          </div>
                          {serviceResults.map((service) => (
                            <button
                              key={service.slug}
                              onMouseDown={() => handleServiceClick(service.slug)}
                              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-primary/5 transition-colors border-b border-border/50 last:border-0 text-left"
                            >
                              <div
                                className={`w-9 h-9 rounded-lg bg-gradient-to-br ${service.gradient} flex items-center justify-center text-lg flex-shrink-0`}
                              >
                                {service.emoji}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-sm text-foreground truncate">
                                    {service.title}
                                  </h4>
                                  {service.badge && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold flex-shrink-0">
                                      {service.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {service.description}
                                </p>
                              </div>
                            </button>
                          ))}
                        </>
                      )}

                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      <SearchIcon className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-sm font-medium">No results found</p>
                      <p className="text-xs mt-1 opacity-70">Try "react", "data science", or "AI"</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Link
            href="/contact"
            className="h-10 px-6 rounded-full bg-primary text-white text-sm flex items-center gap-2"
          >
            <Phone className="w-3.5 h-3.5" />
            Request Callback
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button className="lg:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-black/5 border-t border-border"
          >
            <div className="container-main flex flex-col py-4 space-y-2">
              <Link href="/courses" className="text-[15px] font-medium hover:text-primary">
                <DropdownMenu label="Courses" items={navCourseLinks} />
              </Link>
              <Link href="/it-services" className="text-[15px] font-medium hover:text-primary">
                Services
              </Link>
              <Link href="/about" className="text-[15px] font-medium hover:text-primary">About</Link>
              <Link href="/blog" className="text-[15px] font-medium hover:text-primary">Blog</Link>
              <Link href="/jobs" className="text-[15px] font-medium hover:text-primary">Jobs</Link>


              <div className="pt-3">
                <Link
                  href="/contact"
                  className="block w-full text-center h-10 px-6 rounded-full bg-primary text-white text-sm leading-10"
                >
                  Request Callback
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;