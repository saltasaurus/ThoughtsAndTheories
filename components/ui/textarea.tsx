import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-soft focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
