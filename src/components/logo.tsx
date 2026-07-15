import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <svg
        viewBox="0 0 64 64"
        width="26"
        height="26"
        className="shrink-0"
        aria-hidden
      >
        <path
          d="M8 32C14 18 23 11 32 11C41 11 50 18 56 32C50 46 41 53 32 53C23 53 14 46 8 32Z"
          fill="none"
          stroke="url(#logo-aurora)"
          strokeWidth="3.6"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="32" r="10" fill="url(#logo-aurora)" />
        <circle cx="32" cy="32" r="4" fill="var(--color-void)" />
        <defs>
          <linearGradient id="logo-aurora" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-aurora-teal)" />
            <stop offset="35%" stopColor="var(--color-aurora-violet)" />
            <stop offset="70%" stopColor="var(--color-aurora-magenta)" />
            <stop offset="100%" stopColor="var(--color-aurora-gold)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="aurora-text font-display text-lg tracking-wide">
        HEIMDALL
      </span>
    </Link>
  );
}
