// Marca: um cofre com a moeda entrando — é o que o produto faz (caixinhas).
// Tinta no corpo, cobalto na moeda; sem gradiente, vale nos dois temas.
/** @param {{ className?: string }} props */
export function Marca({ className = "h-7 w-7" }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <circle cx="14" cy="8" r="5.5" fill="var(--color-brand)" />
      <rect x="2" y="10" width="24" height="16" rx="6" fill="var(--color-ink)" />
      <rect x="8.5" y="14.5" width="11" height="2.5" rx="1.25" fill="var(--color-bg)" />
    </svg>
  );
}
