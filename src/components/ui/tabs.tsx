"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "liquid-glass text-muted-foreground inline-flex min-h-12 w-fit items-center justify-center rounded-2xl p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "data-[state=active]:border-transparent data-[state=active]:bg-white/[0.075] data-[state=active]:!text-primary data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_18px_rgba(244,166,36,0.18),0_6px_18px_rgba(0,0,0,0.18)] data-[state=active]:[&_svg]:!text-primary focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/75 dark:text-muted-foreground inline-flex h-10 flex-1 items-center justify-center gap-2.5 rounded-xl border border-transparent px-5 text-base font-semibold leading-none whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 hover:bg-white/[0.035] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-current [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
