import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  ref,
  ...props
}: React.ComponentProps<"div"> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={`rounded-xl border border-mist-800/70 bg-void-panel/60 p-6 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-mist-300">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-mist-700 bg-void px-3 py-2 text-sm text-mist-100 placeholder:text-mist-500 outline-none focus:border-aurora-violet focus:ring-1 focus:ring-aurora-violet transition-colors";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "aurora-gradient text-void hover:brightness-110",
    ghost:
      "border border-mist-700 text-mist-100 hover:border-mist-500 hover:bg-void-raised",
    danger: "border border-crimson/50 text-crimson hover:bg-crimson/10",
  } as const;
  return (
    <button {...props} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Callout({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "neutral" | "crimson";
}) {
  const tones = {
    gold: "border-horn-gold/40 bg-horn-gold/5 text-horn-gold",
    neutral: "border-mist-700 bg-mist-800/20 text-mist-400",
    crimson: "border-crimson/40 bg-crimson/5 text-crimson",
  } as const;
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>{children}</div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "crimson" | "aurora";
  title?: string;
}) {
  const tones = {
    neutral: "border-mist-700 text-mist-300",
    gold: "border-horn-gold/50 text-horn-gold",
    crimson: "border-crimson/50 text-crimson",
    aurora: "border-aurora-violet/50 text-aurora-violet",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
