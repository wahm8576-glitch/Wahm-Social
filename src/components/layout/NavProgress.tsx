"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top progress bar shown whenever something is loading:
 *  - page navigations (internal link clicks, back/forward) until the new route renders,
 *  - form submissions (admin actions, login) until the next page arrives,
 *  - client fetches to /api/* (watchlist, compare, …) while they are in flight.
 * Background polls can opt out with the `x-no-progress` request header.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const navigating = useRef(false);
  const inflight = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = () => {
    setVisible(true);
    setWidth((w) => (w > 0 && w < 90 ? w : 8));
    if (timer.current) return;
    timer.current = setInterval(() => setWidth((w) => (w < 90 ? w + Math.max(0.6, (90 - w) * 0.06) : w)), 200);
  };
  const done = () => {
    if (navigating.current || inflight.current > 0) return;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWidth(100);
    setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 250);
  };

  // Route rendered → finish the navigation part.
  useEffect(() => {
    navigating.current = false;
    done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      navigating.current = true;
      start();
      // Same pathname with a new query string does not change `pathname`: stop after a while.
      if (url.pathname === location.pathname) setTimeout(() => ((navigating.current = false), done()), 4000);
    };
    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      navigating.current = true;
      start();
      const btn = (e.submitter as HTMLButtonElement | null) ?? (e.target as HTMLFormElement).querySelector("button[type=submit],button:not([type])");
      if (btn && !btn.dataset.loading) {
        btn.dataset.loading = "1";
        btn.setAttribute("aria-busy", "true");
        btn.classList.add("opacity-70", "cursor-wait");
        const spin = document.createElement("span");
        spin.className = "ms-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-middle";
        btn.appendChild(spin);
      }
    };
    const onPop = () => {
      navigating.current = true;
      start();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit as EventListener);
    window.addEventListener("popstate", onPop);

    const orig = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const track = /^\/api\/|^https?:\/\/[^/]+\/api\//.test(u) && !u.includes("_rsc") && !h.has("x-no-progress");
      if (!track) return orig(input, init);
      inflight.current++;
      start();
      try {
        return await orig(input, init);
      } finally {
        inflight.current--;
        done();
      }
    };
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit as EventListener);
      window.removeEventListener("popstate", onPop);
      window.fetch = orig;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms" }}>
      <div
        className="h-full bg-gradient-to-r from-accent-400 via-sky-400 to-accent-500 shadow-[0_0_8px_rgba(56,189,248,0.7)]"
        style={{ width: `${width}%`, transition: "width 200ms ease-out" }}
      />
    </div>
  );
}
