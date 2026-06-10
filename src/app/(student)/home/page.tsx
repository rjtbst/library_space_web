"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { MapPin, Star, Wifi, Wind, Volume2, Zap, Car, Coffee, SlidersHorizontal, Map, List, Search } from "lucide-react";

type Library = {
  id: string;
  name: string;
  city: string;
  area: string;
  address: string;
  rating: number;
  total_reviews: number;
  base_price: number;
  open_time: string;
  close_time: string;
  is_active: boolean;
  latitude: number | null;
  longitude: number | null;
  library_amenities: { amenities: { name: string } }[];
  library_images: { image_url: string; is_cover: boolean }[];
  _seat_count?: number;
  _free_seats?: number;
};

const AMENITY_ICONS: Record<string, { icon: React.ElementType; label: string }> = {
  "WiFi": { icon: Wifi, label: "WiFi" },
  "AC": { icon: Wind, label: "AC" },
  "Quiet Zone": { icon: Volume2, label: "Quiet" },
  "Power Sockets": { icon: Zap, label: "Power" },
  "Parking": { icon: Car, label: "Parking" },
  "Cafe": { icon: Coffee, label: "Cafe" },
};

const FILTER_AMENITIES = ["WiFi", "AC", "Quiet Zone", "Power Sockets", "Parking", "Cafe"];

const LIB_EMOJI = ["📚", "🌿", "📖", "🏫", "✏️", "🏛", "📓", "🔬"];
const LIB_GRADS = [
  "linear-gradient(135deg,#E0E8FF,#C7D4F7)",
  "linear-gradient(135deg,#D4EDD4,#B8DDB8)",
  "linear-gradient(135deg,#F0E8FF,#DDD0F7)",
  "linear-gradient(135deg,#FFF0E0,#FFE0C0)",
  "linear-gradient(135deg,#E0FFEE,#C0FFD8)",
  "linear-gradient(135deg,#FFE8E8,#FFD0D0)",
];

function isOpenNow(open_time: string, close_time: string): boolean {
  const now = new Date();
  const [oh, om] = open_time.split(":").map(Number);
  const [ch, cm] = close_time.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  return nowMin >= openMin && nowMin < closeMin;
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""} ${ampm}`;
}

function LibrarySkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[#E4EAF2] flex overflow-hidden animate-pulse">
      <div className="w-[110px] min-h-[90px] bg-gray-100 flex-shrink-0" />
      <div className="flex-1 p-3.5">
        <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
        <div className="flex gap-2 mb-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-5 bg-gray-100 rounded-md w-14" />)}
        </div>
        <div className="flex gap-2">
          <div className="h-4 bg-gray-100 rounded w-16" />
          <div className="h-4 bg-gray-100 rounded w-20 ml-auto" />
          <div className="h-7 bg-gray-100 rounded w-20" />
        </div>
      </div>
    </div>
  );
}

export default function StudentHome() {
  const router = useRouter();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [openOnly, setOpenOnly] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [priceMax, setPriceMax] = useState(200);

  const fetchLibraries = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    let query = supabase
      .from("libraries")
      .select(`
        id, name, city, area, address, rating, total_reviews,
        base_price, open_time, close_time, is_active, latitude, longitude,
        library_amenities(amenities(name)),
        library_images(image_url, is_cover)
      `)
      .eq("is_active", true)
      .order("rating", { ascending: false });

    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) { console.error(error); setLoading(false); return; }

    // Fetch seat counts
    const enriched = await Promise.all(
      (data || []).map(async (lib: Library) => {
        const { count: totalSeats } = await supabase
          .from("seats")
          .select("*", { count: "exact", head: true })
          .eq("library_id", lib.id)
          .eq("is_active", true);

        // Count booked seats for current hour
        const now = new Date();
        const { count: bookedSeats } = await supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("library_id", lib.id)
          .in("status", ["confirmed", "checked_in"])
          .lte("start_time", now.toISOString())
          .gte("end_time", now.toISOString());

        return {
          ...lib,
          _seat_count: totalSeats || 0,
          _free_seats: Math.max(0, (totalSeats || 0) - (bookedSeats || 0)),
        };
      })
    );

    let filtered = enriched;
    if (activeFilters.length > 0) {
      filtered = filtered.filter((lib) => {
        const libAmenities = lib.library_amenities.map((la) => la.amenities?.name);
        return activeFilters.every((f) => libAmenities.includes(f));
      });
    }
    if (openOnly) filtered = filtered.filter((lib) => isOpenNow(lib.open_time, lib.close_time));
    filtered = filtered.filter((lib) => lib.base_price <= priceMax);

    setLibraries(filtered);
    setLoading(false);
  }, [search, activeFilters, openOnly, priceMax]);

  useEffect(() => { fetchLibraries(); }, [fetchLibraries]);

  const toggleFilter = (f: string) => {
    setActiveFilters((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  };

  return (
    <div className="p-5 pb-10 max-w-3xl mx-auto lg:max-w-none">
      {/* Page Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-[#0D1117] tracking-[-0.4px]">Libraries near you</h1>
          <p className="text-[13px] text-[#6E7F94] mt-0.5">
            {loading ? "Loading..." : `${libraries.length} librar${libraries.length === 1 ? "y" : "ies"} found`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`flex items-center gap-1.5 px-3 py-[7px] rounded-[9px] text-[13px] font-semibold border-[1.5px] transition-all ${showFilter ? "bg-[#E8EFFE] border-[#1E5CFF] text-[#1447D4]" : "bg-white border-[#E4EAF2] text-[#3A4A5C] hover:bg-[#F4F7FB] hover:border-[#C0CDD9]"}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters {activeFilters.length > 0 && <span className="bg-[#1E5CFF] text-white text-[9px] rounded-full px-1.5">{activeFilters.length}</span>}
          </button>
          <Link href="/student/map" className="flex items-center gap-1.5 px-3 py-[7px] rounded-[9px] text-[13px] font-semibold bg-white border-[1.5px] border-[#E4EAF2] text-[#3A4A5C] hover:bg-[#F4F7FB] hover:border-[#C0CDD9] transition-all">
            <Map className="w-3.5 h-3.5" />
            Map View
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9AACBE]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search libraries, areas..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border-[1.5px] border-[#E4EAF2] rounded-[10px] text-[13px] text-[#0D1117] placeholder-[#9AACBE] outline-none focus:border-[#1E5CFF] focus:shadow-[0_0_0_3px_rgba(30,92,255,.1)] transition-all"
        />
      </div>

      {/* Filters panel */}
      {showFilter && (
        <div className="bg-white border border-[#E4EAF2] rounded-xl p-4 mb-4 shadow-[0_4px_20px_rgba(13,17,23,.06)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-semibold text-[#3A4A5C]">Filter Options</span>
            <button onClick={() => { setActiveFilters([]); setOpenOnly(false); setPriceMax(200); }} className="text-[11px] text-[#1E5CFF] font-medium">Reset all</button>
          </div>
          <div className="mb-3">
            <div className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-wide mb-2">Amenities</div>
            <div className="flex flex-wrap gap-2">
              {FILTER_AMENITIES.map((f) => (
                <button
                  key={f}
                  onClick={() => toggleFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border-[1.5px] transition-all ${activeFilters.includes(f) ? "bg-[#E8EFFE] border-[#1E5CFF] text-[#1447D4]" : "bg-white border-[#E4EAF2] text-[#6E7F94] hover:border-[#C0CDD9]"}`}
                >
                  {AMENITY_ICONS[f] ? f : f}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3">
            <div className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-wide mb-2">Max Price — ₹{priceMax}/hr</div>
            <input
              type="range" min={10} max={200} step={10} value={priceMax}
              onChange={(e) => setPriceMax(Number(e.target.value))}
              className="w-full accent-[#1E5CFF]"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-[#1E5CFF]" />
            <span className="text-[13px] text-[#3A4A5C] font-medium">Open now only</span>
          </label>
        </div>
      )}

      {/* Active filter chips */}
      {(activeFilters.length > 0 || openOnly) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {openOnly && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E8EFFE] text-[#1447D4]">⚡ Open now</span>}
          {activeFilters.map((f) => (
            <button key={f} onClick={() => toggleFilter(f)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E8EFFE] text-[#1447D4]">
              {f} ×
            </button>
          ))}
        </div>
      )}

      {/* Library list */}
      <div className="flex flex-col gap-3">
        {loading
          ? [1, 2, 3, 4].map((i) => <LibrarySkeleton key={i} />)
          : libraries.length === 0
            ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">🏛</div>
                <div className="text-[15px] font-semibold text-[#0D1117] mb-1">No libraries found</div>
                <div className="text-[13px] text-[#6E7F94]">Try adjusting your filters or search query</div>
              </div>
            )
            : libraries.map((lib, idx) => {
              const open = isOpenNow(lib.open_time, lib.close_time);
              const amenityNames = lib.library_amenities.map((la) => la.amenities?.name).filter(Boolean);
              const freeSeats = lib._free_seats ?? 0;
              const seatStatus = !open ? "closed" : freeSeats === 0 ? "full" : freeSeats <= 5 ? "low" : "avail";

              return (
                <Link
                  key={lib.id}
                  href={`/student/library/${lib.id}`}
                  className="bg-white rounded-xl border border-[#E4EAF2] flex overflow-hidden cursor-pointer transition-all duration-150 hover:shadow-[0_4px_20px_rgba(13,17,23,.08)] hover:border-[#C0CDD9] hover:-translate-y-px group"
                >
                  {/* Thumb */}
                  <div
                    className="w-[110px] min-h-[90px] flex items-center justify-center text-4xl flex-shrink-0"
                    style={{ background: LIB_GRADS[idx % LIB_GRADS.length] }}
                  >
                    {lib.library_images.find((i) => i.is_cover) ? (
                      <img src={lib.library_images.find((i) => i.is_cover)!.image_url} alt={lib.name} className="w-full h-full object-cover" />
                    ) : LIB_EMOJI[idx % LIB_EMOJI.length]}
                  </div>

                  {/* Body */}
                  <div className="flex-1 p-3.5 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <div className="text-[14px] font-bold text-[#0D1117] truncate">{lib.name}</div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${open ? "bg-[#E2F5EE] text-[#065F46]" : "bg-[#FDEAEA] text-[#9B1C1C]"}`}>
                        <span className="text-[8px]">●</span>
                        {open ? "Open" : "Closed"}
                      </span>
                    </div>

                    <div className="text-[11px] text-[#6E7F94] flex flex-wrap items-center gap-1.5 mb-2">
                      <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{lib.area}, {lib.city}</span>
                      <span className="w-[3px] h-[3px] rounded-full bg-[#9AACBE]" />
                      <span className="flex items-center gap-0.5"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{lib.rating.toFixed(1)} ({lib.total_reviews})</span>
                      <span className="w-[3px] h-[3px] rounded-full bg-[#9AACBE]" />
                      <span>{formatTime(lib.open_time)} – {formatTime(lib.close_time)}</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {amenityNames.slice(0, 4).map((a) => (
                        <span key={a} className="text-[10px] text-[#3A4A5C] bg-[#F4F7FB] border border-[#E4EAF2] px-1.5 py-0.5 rounded-[5px]">{a}</span>
                      ))}
                      {amenityNames.length > 4 && <span className="text-[10px] text-[#9AACBE] px-1.5 py-0.5">+{amenityNames.length - 4}</span>}
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                      <div className="text-[15px] font-extrabold text-[#1E5CFF]">
                        ₹{lib.base_price} <span className="text-[11px] font-medium text-[#6E7F94]">/hr</span>
                      </div>
                      {seatStatus === "avail" && <span className="text-[12px] font-semibold text-[#12A87A]">● {freeSeats} seats free</span>}
                      {seatStatus === "low" && <span className="text-[12px] font-semibold text-amber-600">⚠ {freeSeats} left</span>}
                      {seatStatus === "full" && <span className="text-[12px] text-[#6E7F94]">Full</span>}
                      {seatStatus === "closed" && <span className="text-[12px] text-[#6E7F94]">Opens {formatTime(lib.open_time)}</span>}
                      <button
                        className="ml-auto flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-[7px] text-[12px] font-semibold bg-[#1E5CFF] text-white shadow-[0_4px_24px_rgba(30,92,255,.25)] hover:bg-[#1447D4] hover:-translate-y-px transition-all"
                        onClick={(e) => { e.preventDefault(); router.push(`/student/library/${lib.id}`); }}
                      >
                        {seatStatus === "closed" ? "View Details" : "Book Now"} →
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
      </div>
    </div>
  );
}