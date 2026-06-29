import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-white/20 bg-background/35 dark:border-white/10 dark:bg-input/25 h-10 w-full min-w-0 rounded-md border px-3.5 py-1.5 text-base shadow-xs backdrop-blur-md transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-base",
        "focus-visible:border-primary/70 focus-visible:shadow-[inset_0_0_0_2px_rgba(244,166,36,0.42),0_0_0_1px_rgba(244,166,36,0.18)]",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
