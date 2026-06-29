import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'border border-primary/70 bg-primary text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_26px_rgba(244,166,36,0.22)] hover:border-primary hover:bg-primary/90 hover:text-zinc-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_12px_30px_rgba(244,166,36,0.28)] disabled:border-primary/45 disabled:bg-primary/65 disabled:text-zinc-950 disabled:opacity-80 [&_svg]:text-zinc-950',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border border-white/12 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_18px_rgba(0,0,0,0.16)] backdrop-blur-md hover:border-white/18 hover:bg-white/[0.06] hover:text-accent-foreground dark:bg-input/25 dark:border-white/10 dark:hover:bg-input/40',
        secondary:
          'border border-white/10 bg-white/[0.055] text-secondary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_18px_rgba(0,0,0,0.14)] backdrop-blur-md hover:border-white/16 hover:bg-white/[0.08]',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-5 py-2 text-base font-semibold has-[>svg]:px-4 [&_svg:not([class*=size-])]:size-5',
        sm: 'h-9 rounded-md gap-2 px-3.5 text-sm font-semibold has-[>svg]:px-3',
        lg: 'h-12 rounded-xl px-6 text-base font-semibold has-[>svg]:px-5 [&_svg:not([class*=size-])]:size-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
