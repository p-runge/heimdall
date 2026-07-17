"use client";

import { useEffect, useRef, useState } from "react";

function initials(name: string | null, email: string | null) {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function UserMenuDropdown({
  name,
  email,
  image,
  onSignOut,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-mist-700 bg-void-raised text-xs font-medium text-mist-200 transition-colors hover:border-mist-500"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initials(name, email)
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-mist-800/70 bg-void-panel p-1.5 shadow-lg shadow-black/40"
        >
          <div className="border-b border-mist-800/60 px-2.5 py-2">
            {name && <p className="truncate text-sm text-mist-100">{name}</p>}
            {email && <p className="truncate text-xs text-mist-500">{email}</p>}
          </div>
          <form action={onSignOut}>
            <button
              type="submit"
              role="menuitem"
              className="mt-1 w-full rounded-md px-2.5 py-2 text-left text-sm text-mist-300 transition-colors hover:bg-void hover:text-mist-100"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
