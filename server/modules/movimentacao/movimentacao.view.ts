// Movimentação serializada (formato do front). Pura: roda no servidor e no
// navegador (leitura direta do Supabase) — ver `espaco.view.ts`.
import { num, isoDate } from "@/server/lib/serialize";

export type MovimentacaoLinha = {
  id: string;
  caixinhaId: string;
  tipo: "aporte" | "despesa";
  valor: Parameters<typeof num>[0];
  descricao: string;
  data: Date | string;
};

export function toView(mv: MovimentacaoLinha) {
  return {
    id: mv.id,
    caixinhaId: mv.caixinhaId,
    tipo: mv.tipo,
    valor: num(mv.valor),
    descricao: mv.descricao,
    data: isoDate(mv.data),
  };
}
