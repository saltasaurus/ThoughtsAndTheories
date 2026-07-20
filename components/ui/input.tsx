import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-soft focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
