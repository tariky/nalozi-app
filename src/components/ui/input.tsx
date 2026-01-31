import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Lyra input: clean border, subtle focus
        "file:text-foreground placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-none border border-input bg-background px-3 py-2 text-sm transition-colors outline-none",
        // File input styling
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:mr-3",
        // Focus state
        "focus:border-foreground focus:ring-1 focus:ring-foreground",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid/error state
        "aria-invalid:border-destructive aria-invalid:focus:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
