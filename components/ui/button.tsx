import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Botão do shadcn ajustado ao sistema da app: raio de controle (10px),
// primário em tinta (não em cor de marca), tons pálidos com tinta do mesmo
// matiz pra ação que diz o que faz (entrada de dinheiro, exclusão). Foco é o
// anel global de `globals.css`, então não há `focus-visible:ring` aqui.
//
// Quem usa a app importa `Button` de `primitives.jsx`, que embrulha este com a
// pendência automática do clique.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "bg-veu/[0.07] text-ink hover:bg-veu/[0.11]",
        outline: "border border-[var(--color-line-strong)] bg-transparent text-ink hover:bg-accent",
        ghost: "text-slate-300 hover:bg-accent hover:text-ink",
        growth: "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
        destructive: "bg-rose-600 text-white hover:bg-rose-500",
        "destructive-soft": "bg-rose-500/12 text-rose-300 hover:bg-rose-500/20",
        link: "h-auto px-0 text-blue-400 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 gap-1.5 px-3 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-10",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
