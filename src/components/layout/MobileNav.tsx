"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { categories } from "@/data/categories";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

const ITEM =
  "group flex items-center gap-3 rounded-lg px-4 py-3.5 text-lg font-medium text-text-secondary transition-colors duration-200 hover:bg-accent/8 hover:text-text-primary motion-reduce:animate-none animate-tm-rise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    // Move focus into the panel so the menu is reachable by keyboard and is
    // announced as the current context.
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  const links = [
    ...categories.map((c) => ({ href: `/${c.slug}`, label: c.name })),
    { href: "/blog", label: "Blog" },
  ];

  /*
    Entry motion is a CSS animation rather than a JS-toggled class: an
    rAF-gated reveal never fires while the tab is hidden, which would leave an
    invisible overlay holding the scroll lock.
  */
  const overlay = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      className="fixed inset-0 top-[58px] animate-tm-drawer bg-bg-primary motion-reduce:animate-none"
      style={{ zIndex: 9999 }}
    >
      <nav className="px-4 py-6">
        <div className="flex flex-col gap-0.5">
          {links.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={close}
              className={ITEM}
              style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}
            >
              <span className="h-1 w-1 rounded-full bg-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  ) : null;

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-text-primary/5 hover:text-text-primary motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <span
          className={`block transition-all duration-300 motion-reduce:transition-none ${open ? "rotate-90 scale-110 text-accent" : ""}`}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </span>
      </button>
      {mounted && overlay && createPortal(overlay, document.body)}
    </div>
  );
}
