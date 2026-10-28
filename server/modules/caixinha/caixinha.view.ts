// Caixinha serializada (formato do front). Pura: roda no servidor e no
// navegador (leitura direta do Supabase) — ver `espaco.view.ts`.
import { num, numOrNull } from "@/server/lib/serialize";

type Dec = Parameters<typeof num>[0];

export type CaixinhaLinha = {
  id: string;
  nome: string;
  tipo: string | null;
  aporteMensal: Dec;
  taxaJuros: Dec;
  meta: Dec;
  saldo: Dec;
  cor: string;
  acumulaSobra: boolean;
  ordem: number;
};

export function toView(cx: CaixinhaLinha) {
  return {
    id: cx.id,
    nome: cx.nome,
    tipo: cx.tipo ?? null,
    aporteMensal: num(cx.aporteMensal),
    taxaJuros: num(cx.taxaJuros),
    meta: numOrNull(cx.meta),
    saldo: num(cx.saldo),
    cor: cx.cor,
    acumulaSobra: cx.acumulaSobra,
    ordem: cx.ordem,
  };
}
