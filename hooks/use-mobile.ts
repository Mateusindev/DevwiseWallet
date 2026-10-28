import * as React from "react"

// Abaixo do `md` do Tailwind a app troca a barra lateral pela barra inferior.
const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// useSyncExternalStore em vez de useState + efeito (o padrão do shadcn): o
// valor é do navegador, e a assinatura evita o render em cascata do setState
// dentro do efeito. No servidor é "desktop" — a barra móvel é `md:hidden` em
// CSS, então o HTML do SSR já sai certo nas duas larguras.
function assina(cb: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    assina,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
