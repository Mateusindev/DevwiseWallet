// ── Leitura direta do Supabase (PostgREST + RLS) ─────────────────────────────
// As leituras quentes do app sem passar pelo servidor do Next: o navegador
// pede direto ao PostgREST, que roda colado no banco. Uma volta de rede por
// pedido (e pedidos em paralelo de verdade — o dispatcher de Server Actions é
// serial por cliente; HTTP comum não).
//
// Regras:
//   · Só LEITURA, só linhas do próprio dono (RLS em
//     `prisma/manual/20261028-rls-leitura-direta.sql`). Toda escrita segue nas
//     Server Actions.
//   · Mesmo shape das actions: a montagem é a MESMA função pura que o service
//     usa (`*.view.ts`). O que muda é só de onde vêm as linhas.
//   · Cada função devolve `null` quando a leitura direta não vale aqui (sem
//     env, sem token) — o `financeApi` então cai pra action. Erro de rede/RLS
//     vira ApiError como qualquer leitura.
//   · Fica de fora o que cruza donos (pessoas, convites, rateio, painel de
//     share) e o admin: isso exige regra de servidor.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { supabaseParaLeitura, usuarioDoToken } from "@/lib/supabase";
import { addMonths, currentMonth } from "@/server/lib/serialize";
import { orcamentoView, resumoPorEspacoView, espacoView, espacoAtivo } from "@/server/modules/espaco/espaco.view";
import {
  cartoesComAgregados,
  resumoPorMesView,
  faturaLinhasView,
  parceladasView,
} from "@/server/modules/cartao/cartao.view";
import { toView as caixinhaView } from "@/server/modules/caixinha/caixinha.view";
import { toView as movimentacaoView } from "@/server/modules/movimentacao/movimentacao.view";
import { categoriaView } from "@/server/modules/categoria/categoria.view";
import { ApiError } from "./apiError";

// Mesma janela do `espacoService.getOrcamento` (JANELA_ATRAS/JANELA_FRENTE).
const JANELA = 12;

// O PostgREST devolve snake_case; o alias (`novo:coluna`) entrega cada linha
// já no shape que a montagem do servidor recebe do Prisma.
const SHARE = "id, contatoId:contato_id, tipo, percentual, valor, mesRef:mes_ref, contato:contatos(id, nome, status)";
const PARCELA = "cartaoId:cartao_id, parcelado, parcelaAtual:parcela_atual, totalParcelas:total_parcelas, parcelaMesRef:parcela_mes_ref";
const FIXA = `id, espacoId:espaco_id, descricao, valor, diaVencimento:dia_vencimento, ativa, categoriaId:categoria_id, nota, abateShares:abate_shares, ${PARCELA}`;
const MES = "id, espacoId:espaco_id, mes, descricao, valor, data, paga, valorPago:valor_pago, cartaoId:cartao_id, categoriaId:categoria_id, nota, abateShares:abate_shares, fitid";
const RECEITA = "id, mes, descricao, valor, data, recorrente, mesFim:mes_fim";
const CARTAO = "id, nome, bandeira, limite, diaFechamento:dia_fechamento, diaVencimento:dia_vencimento, cor, ordem";
const CAIXINHA = "id, nome, tipo, aporteMensal:aporte_mensal, taxaJuros:taxa_juros, meta, saldo, cor, acumulaSobra:acumula_sobra, ordem";

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
// Mesma validação de `ym` que as actions fazem com zod (422 no formato errado).
function mes(ym: string | undefined, campo = "ym"): string {
  if (ym == null) return currentMonth();
  if (!YM.test(ym)) throw new ApiError("Validação falhou", 422, [{ path: [campo], message: "Use YYYY-MM" }]);
  return ym;
}

// O tipo das linhas é o do alias acima; o supabase-js não infere alias sem os
// tipos gerados do banco, então o cast mora num lugar só.
type Resposta = { data: unknown; error: PostgrestError | null };
async function linhas<T>(p: PromiseLike<Resposta>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiError(error.message || "Falha na leitura", Number(error.code) === 42501 ? 403 : 500);
  return data as T;
}

type Lista = Record<string, unknown>[];

async function comCliente<T>(fn: (db: SupabaseClient) => Promise<T>): Promise<T | null> {
  const db = await supabaseParaLeitura();
  return db ? fn(db) : null;
}

// ── Orçamento de um espaço ──────────────────────────────────────────────────
// UMA requisição traz o espaço com fixas, mês (na janela), receitas, rendas e
// pagamentos — o embed do PostgREST é o `include` do repository. A outra, em
// paralelo, é a dos pontinhos do seletor de mês.
async function lerOrcamento(db: SupabaseClient, espacoId: string, ym: string) {
  const de = addMonths(ym, -JANELA);
  const ate = addMonths(ym, JANELA);
  const [esp, meses] = await Promise.all([
    linhas<Lista[number] | null>(
      db
        .from("espacos")
        .select(
          `rendaMensal:renda_mensal, moeda,
           despesasFixas:despesas_fixas(${FIXA}, shares:cartao_shares(${SHARE})),
           despesasMes:despesas_mes(${MES}, shares:cartao_shares(${SHARE})),
           receitasMes:receitas_mes(${RECEITA}, skips:receita_mes_skip(receitaId:receita_id, ym)),
           rendasMensais:rendas_mensais(ym, valor),
           pagamentosFixas:pagamentos_fixas(despesaFixaId:despesa_fixa_id, ym, valorPago:valor_pago)`
        )
        .eq("id", espacoId)
        .gte("despesasMes.mes", de)
        .lte("despesasMes.mes", ate)
        .gte("pagamentosFixas.ym", de)
        .lte("pagamentosFixas.ym", ate)
        .order("created_at", { referencedTable: "despesasFixas", ascending: true })
        .order("data", { referencedTable: "despesasMes", ascending: false })
        .order("data", { referencedTable: "receitasMes", ascending: false })
        .order("ym", { referencedTable: "rendasMensais", ascending: true })
        .maybeSingle()
    ),
    linhas<{ mesesComDespesa: string[]; mesesComFatura: string[] }>(
      db.rpc("meses_com_lancamento", { p_espaco: espacoId })
    ),
  ]);
  // espaço de outro dono e espaço inexistente são a mesma coisa pro RLS: 404
  if (!esp) throw new ApiError(`Espaço de despesa não encontrado: ${espacoId}`, 404);
  return { ...orcamentoView(esp as never), janela: { de, ate }, ...meses };
}

export async function getOrcamentoDireto(espacoId: string, ym?: string) {
  const m = mes(ym);
  return comCliente((db) => lerOrcamento(db, espacoId, m));
}

// ── Cartões ─────────────────────────────────────────────────────────────────
function lerFixasComCartao(db: SupabaseClient) {
  return linhas<Lista>(db.from("despesas_fixas").select(FIXA).eq("ativa", true).not("cartao_id", "is", null));
}
function lerAvulsasComCartao(db: SupabaseClient, de: string, ate: string) {
  return linhas<Lista>(
    db.from("despesas_mes").select(MES).not("cartao_id", "is", null).gte("mes", de).lte("mes", ate)
  );
}

async function lerCartoes(db: SupabaseClient, ym: string) {
  const [cartoes, fixas, avulsas] = await Promise.all([
    linhas<Lista>(db.from("cartoes").select(CARTAO).order("ordem", { ascending: true })),
    lerFixasComCartao(db),
    lerAvulsasComCartao(db, ym, ym),
  ]);
  return cartoesComAgregados(cartoes as never, fixas as never, avulsas as never, ym);
}

export async function getCartoesDireto(ym?: string) {
  const m = mes(ym);
  return comCliente((db) => lerCartoes(db, m));
}

export async function getResumoCartoesDireto(de?: string, ate?: string) {
  const fim = mes(ate, "ate");
  const ini = de == null ? addMonths(fim, -5) : mes(de, "de");
  return comCliente(async (db) => {
    const [fixas, avulsas] = await Promise.all([lerFixasComCartao(db), lerAvulsasComCartao(db, ini, fim)]);
    return resumoPorMesView(ini, fim, fixas as never, avulsas as never);
  });
}

export async function getParceladasDireto(ym?: string) {
  const m = mes(ym);
  return comCliente(async (db) => {
    const [fixas, pagamentos] = await Promise.all([
      linhas<Lista>(
        db
          .from("despesas_fixas")
          .select(`${FIXA}, espaco:espacos(nome, emoji)`)
          .eq("parcelado", true)
          .eq("ativa", true)
          .order("descricao", { ascending: true })
      ),
      linhas<Lista>(
        db.from("pagamentos_fixas").select("despesaFixaId:despesa_fixa_id, ym, valorPago:valor_pago").eq("ym", m)
      ),
    ]);
    return parceladasView(m, fixas as never, pagamentos as never);
  });
}

export async function getFaturaLinhasDireto(cartaoId: string, ym?: string) {
  const m = mes(ym);
  return comCliente(async (db) => {
    const [cartao, fixas, avulsas] = await Promise.all([
      linhas<Lista[number] | null>(db.from("cartoes").select("id").eq("id", cartaoId).maybeSingle()),
      linhas<Lista>(db.from("despesas_fixas").select(FIXA).eq("cartao_id", cartaoId).eq("ativa", true)),
      linhas<Lista>(db.from("despesas_mes").select(MES).eq("cartao_id", cartaoId).eq("mes", m)),
    ]);
    if (!cartao) throw new ApiError(`Cartão não encontrado: ${cartaoId}`, 404);
    return faturaLinhasView(m, fixas as never, avulsas as never);
  });
}

// ── Gasto do mês por espaço (gráfico "por página" do Início) ────────────────
export async function getResumoEspacosDireto(ym?: string) {
  const m = mes(ym);
  return comCliente(async (db) => {
    const [espacos, fixas, avulsas] = await Promise.all([
      linhas<Lista>(db.from("espacos").select("id, nome, tipo, emoji").order("created_at", { ascending: true })),
      linhas<Lista>(db.from("despesas_fixas").select(`${FIXA}, shares:cartao_shares(${SHARE})`).eq("ativa", true)),
      linhas<Lista>(db.from("despesas_mes").select(`${MES}, shares:cartao_shares(${SHARE})`).eq("mes", m)),
    ]);
    return resumoPorEspacoView(m, espacos as never, fixas as never, avulsas as never);
  });
}

// ── Estado inteiro (refresh do boot) ────────────────────────────────────────
// Mesmo payload do `getState`, em duas levas: tudo o que não depende de nada,
// e o orçamento do espaço ativo. Conta nova (sem espaço ou sem categoria)
// precisa de ESCRITA (provisionamento) — devolve null e o financeApi usa a
// action, que provisiona.
export async function getBootstrapDireto(ym?: string) {
  const m = mes(ym);
  return comCliente(async (db) => {
    const userId = usuarioDoToken();
    if (!userId) return null;
    const [caixinhas, movimentacoes, espacos, settings, ocultos, cartoes, categorias] = await Promise.all([
      linhas<Lista>(db.from("caixinhas").select(CAIXINHA).order("ordem", { ascending: true })),
      linhas<Lista>(
        db
          .from("movimentacoes")
          .select("id, caixinhaId:caixinha_id, tipo, valor, descricao, data")
          .order("data", { ascending: false })
      ),
      linhas<Lista>(db.from("espacos").select("id, nome, tipo, emoji").order("created_at", { ascending: true })),
      linhas<{ activeEspacoId: string | null } | null>(
        db.from("app_settings").select("activeEspacoId:active_espaco_id").maybeSingle()
      ),
      linhas<{ espacoId: string; ym: string }[]>(db.from("espaco_mes_oculto").select("espacoId:espaco_id, ym")),
      lerCartoes(db, m),
      linhas<Lista>(db.from("categorias").select("id, nome, cor, ordem").order("ordem", { ascending: true })),
    ]);
    if (espacos.length === 0 || categorias.length === 0) return null;

    const activeEspacoId = espacoAtivo(espacos as { id: string }[], settings?.activeEspacoId ?? null);
    const orcamento = activeEspacoId ? await lerOrcamento(db, activeEspacoId, m) : null;

    return {
      userId,
      caixinhas: caixinhas.map((c) => caixinhaView(c as never)),
      movimentacoes: movimentacoes.map((mv) => movimentacaoView(mv as never)),
      espacos: espacos.map((e) => espacoView(e as never)),
      activeEspacoId,
      espacosOcultos: ocultos.map((o) => ({ espacoId: o.espacoId, ym: o.ym })),
      cartoes,
      categorias: categorias.map((c) => categoriaView(c as never)),
      orcamento,
    };
  });
}
