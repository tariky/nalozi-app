import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Lyra textarea: clean border, subtle focus
        "placeholder:text-muted-foreground flex field-sizing-content min-h-20 w-full rounded-none border border-input bg-background px-3 py-2 text-sm transition-colors outline-none",
        // Focus state
        "focus:border-foreground focus:ring-1 focus:ring-foreground",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid/error state
        "aria-invalid:border-destructive aria-invalid:focus:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
