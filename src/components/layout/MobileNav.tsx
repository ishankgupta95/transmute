"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { categories } from "@/data/categories";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (open) {
      rafRef.current = requestAnimationFrame(() => setVisible(true));
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.body.style.overflow = "";
    };
  }, [open]);

  const overlay = open ? (
    <div
      className={`fixed inset-0 top-16 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ zIndex: 9999, backgroundColor: "#08080a" }}
    >
      <nav className="px-4 py-6">
        <div className="flex flex-col gap-0.5">
          {categories.map((cat, i) => (
            <Link
              key={cat.slug}
              href={`/${cat.slug}`}
              onClick={() => { setVisible(false); setOpen(false); }}
              className={`group flex items-center gap-3 rounded-lg px-4 py-3.5 text-lg font-medium text-text-secondary hover:text-text-primary hover:bg-[rgba(86,184,230,0.06)] transition-all duration-300 ${
                visible
                  ? "opacity-100 translate-x-0"
                  : "opacity-0 -translate-x-3"
              }`}
              style={{ transitionDelay: visible ? `${i * 50}ms` : "0ms" }}
            >
              <span className="h-1 w-1 rounded-full bg-accent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              {cat.name}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  ) : null;

  return (
    <div className="md:hidden">
      <button
        onClick={() => {
          if (open) setVisible(false);
          setOpen(!open);
        }}
        className="relative p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        aria-label="Toggle menu"
      >
        <span
          className={`block transition-all duration-300 ${open ? "rotate-90 scale-110 text-accent" : ""}`}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </span>
      </button>
      {mounted && overlay && createPortal(overlay, document.body)}
    </div>
  );
}
