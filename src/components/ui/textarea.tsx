import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-white/20 bg-background/35 placeholder:text-muted-foreground focus-visible:border-primary/70 focus-visible:shadow-[inset_0_0_0_2px_rgba(244,166,36,0.42),0_0_0_1px_rgba(244,166,36,0.18)] aria-invalid:border-destructive dark:border-white/10 dark:bg-input/25 flex field-sizing-content min-h-20 w-full rounded-md border px-3.5 py-2.5 text-base shadow-xs backdrop-blur-md transition-[color,box-shadow,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-base",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
