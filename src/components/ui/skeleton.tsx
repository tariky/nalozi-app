import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // Lyra skeleton: clean, minimal
        "rounded-none bg-muted relative overflow-hidden",
        // Animated shimmer effect
        "after:absolute after:inset-0 after:translate-x-[-100%] after:animate-[shimmer_1.5s_infinite] after:bg-gradient-to-r after:from-transparent after:via-background/60 after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
