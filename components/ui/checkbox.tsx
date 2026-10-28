"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

// Checkbox do shadcn no desenho da casa: 18px, traço de 1.5px, marcado em
// tinta. A área de toque cresce além do desenho (`before:`) sem inflar a
// linha, e o estado indeterminado ("algumas selecionadas") vira um traço.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] border-[1.5px] border-veu/30 bg-transparent transition-colors outline-none hover:border-veu/50",
        "before:absolute before:-inset-2.5 before:content-['']",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-[13px] group-data-[state=indeterminate]/checkbox:hidden" strokeWidth={3} />
        <span className="hidden h-0.5 w-2 rounded bg-current group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
