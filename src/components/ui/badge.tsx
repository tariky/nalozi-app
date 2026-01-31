import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Lyra badge: pill shape, outline style
  "inline-flex items-center justify-center rounded-none border px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-colors",
  {
    variants: {
      variant: {
        // Default: Solid black
        default:
          "bg-primary text-primary-foreground border-transparent",
        // Secondary: Light gray
        secondary:
          "bg-secondary text-secondary-foreground border-transparent",
        // Destructive: Red
        destructive:
          "bg-destructive text-white border-transparent",
        // Outline: Border only
        outline:
          "bg-transparent text-foreground border-border",
        // Success: Green outline
        success:
          "bg-transparent text-status-success border-status-success",
        // Warning: Yellow/amber outline
        warning:
          "bg-transparent text-status-warning border-status-warning",
        // Error: Red outline
        error:
          "bg-transparent text-status-error border-status-error",
        // Info: Blue outline
        info:
          "bg-transparent text-status-info border-status-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
