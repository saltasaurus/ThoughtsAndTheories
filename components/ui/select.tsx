import { cn } from "@/lib/utils";

/** Styled native select — no JS, keyboard/mobile behavior for free. */
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
