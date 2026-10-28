// Categoria serializada (formato do front). Pura: roda no servidor e no
// navegador (leitura direta do Supabase) — ver `espaco.view.ts`.
export type CategoriaLinha = { id: string; nome: string; cor: string; ordem: number };

export function categoriaView(c: CategoriaLinha) {
  return { id: c.id, nome: c.nome, cor: c.cor, ordem: c.ordem };
}
