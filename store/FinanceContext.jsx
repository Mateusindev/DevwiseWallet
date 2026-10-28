import { createContext, use, useContext, useCallback, useEffect, useReducer, useRef, useState } from "react";
import * as api from "../services/financeApi";
import { useAuth } from "../components/AuthGate";
import { currentMonthKey } from "../lib/format.js";
import { leituraDiretaAtiva } from "../lib/supabase";

// ── State shape ────────────────────────────────────────────────────────────
// GLOBAL: caixinhas, movimentacoes (economias compartilhadas).
// POR ESPAÇO: despesasFixas, despesasMes, rendasMensais, config (orçamento).
const initial = {
  status: "loading", // boot global: loading | ready | error
  error: null,
  // global
  caixinhas: [],
  movimentacoes: [],
  cartoes: [],
  categorias: [],
  // espaços de despesa
  espacos: [],
  espacosOcultos: [], // [{ espacoId, ym }] — páginas excluídas só num mês (reversível)
  activeEspacoId: null,
  orcamentoStatus: "ready", // troca de espaço (in-page): ready | loading
  espacoPendente: null, // aba clicada cujo orçamento ainda está vindo
  // orçamento do espaço ativo
  despesasFixas: [],
  despesasMes: [],
  receitasMes: [],
  receitasSkips: [], // [{ receitaId, ym }] — meses em que uma recorrente foi pulada
  pagamentosFixas: [], // [{ despesaFixaId, ym }] — fixas marcadas pagas por mês
  rendasMensais: {},
  config: { rendaMensal: 0, moeda: "BRL" },
  // Janela de histórico carregada ({ de, ate }) + os meses que têm lançamento
  // fora dela (só a lista de 'YYYY-MM', não o payload). Ver espacoService.
  janela: null,
  mesesComDespesa: [],
  mesesComFatura: [],
};

function reducer(state, action) {
  switch (action.type) {
    case "BOOT_START":
      return { ...state, status: "loading", error: null };
    case "BOOT_OK":
      return {
        ...state,
        status: "ready",
        error: null,
        caixinhas: action.p.caixinhas,
        movimentacoes: action.p.movimentacoes,
        cartoes: action.p.cartoes || [],
        categorias: action.p.categorias || [],
        espacos: action.p.espacos,
        espacosOcultos: action.p.espacosOcultos || [],
        activeEspacoId: action.p.activeEspacoId,
        orcamentoStatus: "ready",
        ...action.p.orcamento,
      };
    case "BOOT_ERR":
      return { ...state, status: "error", error: action.error };

    // troca de espaço de despesa (não recarrega caixinhas)
    case "ORC_LOADING":
      return { ...state, orcamentoStatus: "loading", espacoPendente: action.id ?? null };
    case "SET_ORCAMENTO":
      return { ...state, activeEspacoId: action.id, orcamentoStatus: "ready", espacoPendente: null, ...action.orcamento };
    case "ORC_FALHOU":
      return { ...state, orcamentoStatus: "ready", espacoPendente: null };

    case "ADD_ESPACO":
      return { ...state, espacos: [...state.espacos, action.esp] };
    case "UPSERT_ESPACO":
      return {
        ...state,
        espacos: state.espacos.map((e) => (e.id === action.esp.id ? action.esp : e)),
      };
    case "REMOVE_ESPACO":
      return {
        ...state,
        espacos: state.espacos.filter((e) => e.id !== action.id),
        espacosOcultos: state.espacosOcultos.filter((o) => o.espacoId !== action.id),
      };
    case "HIDE_ESPACO_MES": {
      const exists = state.espacosOcultos.some(
        (o) => o.espacoId === action.espacoId && o.ym === action.ym
      );
      return exists
        ? state
        : { ...state, espacosOcultos: [...state.espacosOcultos, { espacoId: action.espacoId, ym: action.ym }] };
    }
    case "SHOW_ESPACO_MES":
      return {
        ...state,
        espacosOcultos: state.espacosOcultos.filter(
          (o) => !(o.espacoId === action.espacoId && o.ym === action.ym)
        ),
      };

    // global — caixinhas / movimentações
    case "UPSERT_CAIXINHA": {
      const exists = state.caixinhas.some((c) => c.id === action.cx.id);
      return {
        ...state,
        caixinhas: exists
          ? state.caixinhas.map((c) => (c.id === action.cx.id ? action.cx : c))
          : [...state.caixinhas, action.cx],
      };
    }
    case "REMOVE_CAIXINHA":
      return {
        ...state,
        caixinhas: state.caixinhas.filter((c) => c.id !== action.id),
        movimentacoes: state.movimentacoes.filter((m) => m.caixinhaId !== action.id),
      };
    // cartões de crédito (globais)
    case "SET_CARTOES":
      return { ...state, cartoes: action.cartoes };
    case "UPSERT_CARTAO": {
      const exists = state.cartoes.some((c) => c.id === action.cartao.id);
      return {
        ...state,
        cartoes: exists
          ? state.cartoes.map((c) => (c.id === action.cartao.id ? { ...c, ...action.cartao } : c))
          : [...state.cartoes, action.cartao],
      };
    }
    case "REMOVE_CARTAO":
      return { ...state, cartoes: state.cartoes.filter((c) => c.id !== action.id) };

    // categorias de despesa (globais)
    case "UPSERT_CATEGORIA": {
      const exists = state.categorias.some((c) => c.id === action.categoria.id);
      return {
        ...state,
        categorias: exists
          ? state.categorias.map((c) => (c.id === action.categoria.id ? action.categoria : c))
          : [...state.categorias, action.categoria],
      };
    }
    case "REMOVE_CATEGORIA":
      return { ...state, categorias: state.categorias.filter((c) => c.id !== action.id) };

    case "ADD_MOV":
      return { ...state, movimentacoes: [...state.movimentacoes, action.mov] };
    case "REMOVE_MOV":
      return { ...state, movimentacoes: state.movimentacoes.filter((m) => m.id !== action.id) };

    // orçamento do espaço ativo
    case "UPSERT_DF": {
      const exists = state.despesasFixas.some((d) => d.id === action.df.id);
      return {
        ...state,
        despesasFixas: exists
          ? state.despesasFixas.map((d) => (d.id === action.df.id ? action.df : d))
          : [...state.despesasFixas, action.df],
      };
    }
    case "REMOVE_DF":
      return {
        ...state,
        despesasFixas: state.despesasFixas.filter((d) => d.id !== action.id),
        pagamentosFixas: (state.pagamentosFixas || []).filter((p) => p.despesaFixaId !== action.id),
      };
    case "SET_PAGAMENTO_FIXA": {
      const list = (state.pagamentosFixas || []).filter(
        (p) => !(p.despesaFixaId === action.despesaFixaId && p.ym === action.ym)
      );
      return {
        ...state,
        pagamentosFixas:
          action.valorPago > 0
            ? [...list, { despesaFixaId: action.despesaFixaId, ym: action.ym, valorPago: action.valorPago }]
            : list,
      };
    }
    // ── Lote ────────────────────────────────────────────────────────────────
    // Um dispatch por operação (não um por linha): o React re-renderiza a lista
    // inteira uma vez só.
    case "UPSERT_MANY_DF": {
      const porId = new Map(action.dfs.map((d) => [d.id, d]));
      const atualizadas = state.despesasFixas.map((d) => porId.get(d.id) ?? d);
      const novas = action.dfs.filter((d) => !state.despesasFixas.some((x) => x.id === d.id));
      return { ...state, despesasFixas: [...atualizadas, ...novas] };
    }
    case "REMOVE_MANY_DF": {
      const ids = new Set(action.ids);
      return {
        ...state,
        despesasFixas: state.despesasFixas.filter((d) => !ids.has(d.id)),
        pagamentosFixas: (state.pagamentosFixas || []).filter((p) => !ids.has(p.despesaFixaId)),
      };
    }
    case "UPSERT_MANY_DM": {
      const porId = new Map(action.dms.map((d) => [d.id, d]));
      const atualizadas = state.despesasMes.map((d) => porId.get(d.id) ?? d);
      const novas = action.dms.filter((d) => !state.despesasMes.some((x) => x.id === d.id));
      return { ...state, despesasMes: [...atualizadas, ...novas] };
    }
    case "REMOVE_MANY_DM": {
      const ids = new Set(action.ids);
      return { ...state, despesasMes: state.despesasMes.filter((d) => !ids.has(d.id)) };
    }
    // Substitui os pagamentos daquelas fixas naquele mês: quem não voltou na
    // lista foi desquitado.
    case "SET_PAGAMENTOS_FIXAS": {
      const ids = new Set(action.ids);
      const outros = (state.pagamentosFixas || []).filter(
        (p) => !(ids.has(p.despesaFixaId) && p.ym === action.ym)
      );
      return { ...state, pagamentosFixas: [...outros, ...action.pagamentos] };
    }

    // exceções de receita recorrente (pular um mês)
    case "ADD_SKIP_RECEITA": {
      const existe = (state.receitasSkips || []).some(
        (x) => x.receitaId === action.receitaId && x.ym === action.ym
      );
      return existe
        ? state
        : { ...state, receitasSkips: [...(state.receitasSkips || []), { receitaId: action.receitaId, ym: action.ym }] };
    }
    case "REMOVE_SKIP_RECEITA":
      return {
        ...state,
        receitasSkips: (state.receitasSkips || []).filter(
          (x) => !(x.receitaId === action.receitaId && x.ym === action.ym)
        ),
      };

    case "SET_RENDA":
      return { ...state, rendasMensais: { ...state.rendasMensais, [action.ym]: action.valor } };
    case "CLEAR_RENDA": {
      const rest = { ...state.rendasMensais };
      delete rest[action.ym];
      return { ...state, rendasMensais: rest };
    }
    case "SET_RENDA_FIXA":
      return { ...state, config: { ...state.config, rendaMensal: action.valor } };
    case "ADD_DM":
      return { ...state, despesasMes: [...state.despesasMes, action.dm] };
    case "UPSERT_DM": {
      const exists = state.despesasMes.some((d) => d.id === action.dm.id);
      return {
        ...state,
        despesasMes: exists
          ? state.despesasMes.map((d) => (d.id === action.dm.id ? action.dm : d))
          : [...state.despesasMes, action.dm],
      };
    }
    case "REMOVE_DM":
      return { ...state, despesasMes: state.despesasMes.filter((d) => d.id !== action.id) };
    case "ADD_RM":
      return { ...state, receitasMes: [...(state.receitasMes || []), action.rm] };
    case "UPSERT_RM": {
      const list = state.receitasMes || [];
      const exists = list.some((r) => r.id === action.rm.id);
      return {
        ...state,
        receitasMes: exists ? list.map((r) => (r.id === action.rm.id ? action.rm : r)) : [...list, action.rm],
      };
    }
    case "REMOVE_RM":
      return { ...state, receitasMes: (state.receitasMes || []).filter((r) => r.id !== action.id) };

    default:
      return state;
  }
}

const Ctx = createContext(null);

// Estado do servidor (RSC) já entra montado, sem passar por "loading".
const semear = (p) => (p ? reducer(initial, { type: "BOOT_OK", p }) : initial);

// `estadoPromise` vem de app/page.tsx sem await: o servidor dispara o getState
// antes de o bundle existir e o React suspende aqui. Sem ela (ou com um estado
// de outra sessão — logout e login com outra conta reaproveitariam a mesma
// Promise) o provider volta a buscar no efeito, como antes.
// Grava a página ativa num tique SEPARADO da troca. Server Action roda dentro
// de uma transition do React; disparada no mesmo tique do `SET_ORCAMENTO`, a
// atualização da tela ficava presa nela e só pintava quando a resposta da
// escrita voltava (~uma volta de rede a mais, medido).
function gravarAtivaDepois(id) {
  setTimeout(() => {
    api.setActiveEspaco(id).catch(() => { /* viewer: troca só local */ });
  }, 0);
}

export function FinanceProvider({ children, estadoPromise }) {
  const { user } = useAuth();
  const doServidor = estadoPromise ? use(estadoPromise) : null;
  const inicial = doServidor?.userId === user.id ? doServidor : null;

  const [state, dispatch] = useReducer(reducer, inicial, semear);
  const esp = state.activeEspacoId;
  // Mês visto — global: Início, Despesas e Cartões olham sempre o mesmo mês.
  const [ym, setYm] = useState(currentMonthKey());

  const bootstrap = useCallback(async () => {
    dispatch({ type: "BOOT_START" });
    try {
      const p = await api.getBootstrap();
      dispatch({ type: "BOOT_OK", p });
    } catch (error) {
      dispatch({ type: "BOOT_ERR", error: error.message });
    }
  }, []);

  useEffect(() => {
    if (!inicial) bootstrap();
  }, [bootstrap, inicial]);

  // O orçamento vem por janela de meses. Sair dela (planejar dois anos à
  // frente, revisitar 2024) refaz a busca centrada no mês novo — sem isso o
  // mês fora da janela apareceria vazio em vez de "carregando".
  const janela = state.janela;
  useEffect(() => {
    if (!esp || !janela) return;
    if (ym >= janela.de && ym <= janela.ate) return;
    let cancel = false;
    dispatch({ type: "ORC_LOADING" });
    api.getOrcamento(esp, ym).then((orcamento) => {
      if (!cancel) dispatch({ type: "SET_ORCAMENTO", id: esp, orcamento });
    });
    return () => {
      cancel = true;
    };
  }, [ym, esp, janela]);

  // Refaz os agregados de fatura dos cartões (mês corrente por padrão).
  // `cartoesCarregando` existe porque essa leitura acontece a cada troca de mês
  // e os números da tela ficam VÁLIDOS mas do mês anterior enquanto ela roda —
  // sem sinal, parece que o app ignorou o clique.
  const [cartoesCarregando, setCartoesCarregando] = useState(false);
  const reloadCartoes = useCallback(async (ymArg) => {
    setCartoesCarregando(true);
    try {
      const cartoes = await api.getCartoes(ymArg);
      dispatch({ type: "SET_CARTOES", cartoes });
      return cartoes;
    } finally {
      setCartoesCarregando(false);
    }
  }, []);

  // Com leitura direta (HTTP em paralelo, fora da fila das actions), as outras
  // páginas visíveis já ficam no cache assim que a ativa está pronta — trocar
  // de aba vira instantâneo. Pelas actions não: entraria na fila serial e
  // atrasaria o próximo clique; aí só o hover na aba pré-carrega.
  const alvoEspaco = useRef(null);
  const outrasPaginas = state.espacos
    .filter((e) => e.id !== esp && !state.espacosOcultos.some((o) => o.espacoId === e.id && o.ym === ym))
    .map((e) => e.id)
    .join(",");
  useEffect(() => {
    if (state.orcamentoStatus !== "ready" || !outrasPaginas || !leituraDiretaAtiva()) return;
    for (const id of outrasPaginas.split(",")) api.getOrcamento(id, ym).catch(() => {});
  }, [state.orcamentoStatus, outrasPaginas, ym]);

  const actions = {
    refresh: bootstrap,
    reloadCartoes,

    // ── Cartões de crédito (GLOBAIS) ─────────────────────────────────────────
    async addCartao(dto) {
      const cartao = await api.addCartao(dto);
      dispatch({ type: "UPSERT_CARTAO", cartao });
      return cartao;
    },
    async updateCartao(id, patch) {
      const cartao = await api.updateCartao(id, patch);
      dispatch({ type: "UPSERT_CARTAO", cartao });
      return cartao;
    },
    async removeCartao(id) {
      await api.removeCartao(id);
      dispatch({ type: "REMOVE_CARTAO", id });
    },

    // ── Categorias de despesa (GLOBAIS) ──────────────────────────────────────
    async addCategoria(dto) {
      const categoria = await api.addCategoria(dto);
      dispatch({ type: "UPSERT_CATEGORIA", categoria });
      return categoria;
    },
    async updateCategoria(id, patch) {
      const categoria = await api.updateCategoria(id, patch);
      dispatch({ type: "UPSERT_CATEGORIA", categoria });
      return categoria;
    },
    async removeCategoria(id) {
      await api.removeCategoria(id);
      dispatch({ type: "REMOVE_CATEGORIA", id });
    },

    // ── Espaços de despesa ───────────────────────────────────────────────────
    // Troca de página: LÊ primeiro e grava depois. Antes era o contrário — a
    // tela esperava a escrita (validar dono + upsert, duas idas ao banco em
    // série) só pra então pedir o orçamento. Gravar qual página está ativa é
    // preferência, não dado: vai em segundo plano, e se falhar (sem
    // espaco:manage → 403) a troca vale só nesta sessão, como antes.
    // Cliques rápidos (A → B → C): só o último alvo aplica o resultado.
    async setActiveEspaco(id) {
      if (id === esp && !state.espacoPendente) return;
      alvoEspaco.current = id;
      dispatch({ type: "ORC_LOADING", id });
      let orcamento;
      try {
        orcamento = await api.getOrcamento(id, ym);
      } catch (e) {
        if (alvoEspaco.current === id) dispatch({ type: "ORC_FALHOU" });
        throw e;
      }
      if (alvoEspaco.current !== id) return;
      dispatch({ type: "SET_ORCAMENTO", id, orcamento });
      gravarAtivaDepois(id);
    },
    // Pré-carrega o orçamento de uma página (hover/foco na aba): o clique
    // seguinte sai do cache do `financeApi`.
    prefetchEspaco(id) {
      if (id && id !== esp) api.getOrcamento(id, ym).catch(() => {});
    },
    async addEspaco(dto) {
      const novo = await api.addEspaco(dto);
      dispatch({ type: "ADD_ESPACO", esp: novo });
      return novo;
    },
    async renameEspaco(id, nome) {
      const novo = await api.renameEspaco(id, nome);
      dispatch({ type: "UPSERT_ESPACO", esp: novo });
    },
    async removeEspaco(id) {
      const { activeEspacoId } = await api.removeEspaco(id);
      dispatch({ type: "REMOVE_ESPACO", id });
      if (activeEspacoId !== esp) {
        const orcamento = await api.getOrcamento(activeEspacoId, ym);
        dispatch({ type: "SET_ORCAMENTO", id: activeEspacoId, orcamento });
      }
    },
    // Exclui a página só no mês ym (reversível). Se era a ativa, pula pra
    // primeira visível naquele mês.
    async ocultarEspacoMes(id, ym) {
      await api.ocultarEspacoMes(id, ym);
      dispatch({ type: "HIDE_ESPACO_MES", espacoId: id, ym });
      if (id === esp) {
        const ocultosNoMes = new Set(
          [...state.espacosOcultos, { espacoId: id, ym }]
            .filter((o) => o.ym === ym)
            .map((o) => o.espacoId)
        );
        const proxima = state.espacos.find((e) => !ocultosNoMes.has(e.id));
        if (proxima && proxima.id !== esp) {
          const orcamento = await api.getOrcamento(proxima.id, ym);
          dispatch({ type: "SET_ORCAMENTO", id: proxima.id, orcamento });
          gravarAtivaDepois(proxima.id);
        }
      }
    },
    async restaurarEspacoMes(id, ym) {
      await api.restaurarEspacoMes(id, ym);
      dispatch({ type: "SHOW_ESPACO_MES", espacoId: id, ym });
    },

    // ── Caixinhas / movimentações (GLOBAIS) ──────────────────────────────────
    async addAporte(dto) {
      const { movimentacao, caixinha } = await api.addAporte(dto);
      dispatch({ type: "ADD_MOV", mov: movimentacao });
      dispatch({ type: "UPSERT_CAIXINHA", cx: caixinha });
      return movimentacao;
    },
    async addDespesaVariavel(dto) {
      const { movimentacao, caixinha } = await api.addDespesaVariavel(dto);
      dispatch({ type: "ADD_MOV", mov: movimentacao });
      dispatch({ type: "UPSERT_CAIXINHA", cx: caixinha });
      return movimentacao;
    },
    async removeMovimentacao(id) {
      const { caixinha } = await api.removeMovimentacao(id);
      dispatch({ type: "REMOVE_MOV", id });
      dispatch({ type: "UPSERT_CAIXINHA", cx: caixinha });
    },
    async addCaixinha(dto) {
      const cx = await api.addCaixinha(dto);
      dispatch({ type: "UPSERT_CAIXINHA", cx });
      return cx;
    },
    async updateCaixinha(id, patch) {
      const cx = await api.updateCaixinha(id, patch);
      dispatch({ type: "UPSERT_CAIXINHA", cx });
      return cx;
    },
    async removeCaixinha(id) {
      await api.removeCaixinha(id);
      dispatch({ type: "REMOVE_CAIXINHA", id });
    },

    // ── Orçamento (espaço ativo) ─────────────────────────────────────────────
    // As mutações de despesa já devolvem os agregados de fatura junto — não há
    // mais um GET /cartoes atrás de cada uma.
    async addDespesaFixa(dto) {
      const { despesa, cartoes } = await api.addDespesaFixa(esp, dto);
      dispatch({ type: "UPSERT_DF", df: despesa });
      dispatch({ type: "SET_CARTOES", cartoes });
      return despesa;
    },
    async updateDespesaFixa(id, patch) {
      const { despesa, cartoes } = await api.updateDespesaFixa(esp, id, patch);
      dispatch({ type: "UPSERT_DF", df: despesa });
      dispatch({ type: "SET_CARTOES", cartoes });
      return despesa;
    },
    async toggleDespesaFixa(id) {
      const { despesa, cartoes } = await api.toggleDespesaFixa(esp, id);
      dispatch({ type: "UPSERT_DF", df: despesa });
      dispatch({ type: "SET_CARTOES", cartoes });
    },
    async removeDespesaFixa(id) {
      const { cartoes } = await api.removeDespesaFixa(esp, id);
      dispatch({ type: "REMOVE_DF", id });
      dispatch({ type: "SET_CARTOES", cartoes });
    },
    // Lote de fixas — um dispatch por operação, não um por linha.
    async bulkFixas(dto) {
      const r = await api.bulkDespesasFixas(esp, dto);
      if (r.removidos.length > 0) dispatch({ type: "REMOVE_MANY_DF", ids: r.removidos });
      if (r.aplicadas.length > 0) dispatch({ type: "UPSERT_MANY_DF", dfs: r.aplicadas });
      if (dto.op === "pagar" || dto.op === "despagar") {
        dispatch({ type: "SET_PAGAMENTOS_FIXAS", ids: dto.ids, ym: dto.ym, pagamentos: r.pagamentos });
      }
      dispatch({ type: "SET_CARTOES", cartoes: r.cartoes });
      return r;
    },
    // Import de OFX — um dispatch em lote.
    async importDespesasMes(dto) {
      const r = await api.importDespesasMes(esp, dto);
      if (r.criadas.length > 0) dispatch({ type: "UPSERT_MANY_DM", dms: r.criadas });
      dispatch({ type: "SET_CARTOES", cartoes: r.cartoes });
      return r;
    },
    async bulkMes(dto) {
      const r = await api.bulkDespesasMes(esp, dto);
      if (r.removidos.length > 0) dispatch({ type: "REMOVE_MANY_DM", ids: r.removidos });
      if (r.aplicadas.length > 0) dispatch({ type: "UPSERT_MANY_DM", dms: r.aplicadas });
      dispatch({ type: "SET_CARTOES", cartoes: r.cartoes });
      return r;
    },
    async setPagamentoFixa(id, ym, valorPago) {
      const r = await api.setPagamentoFixa(esp, id, ym, valorPago);
      dispatch({ type: "SET_PAGAMENTO_FIXA", despesaFixaId: r.despesaFixaId, ym: r.ym, valorPago: r.valorPago, pago: r.pago });
    },
    async setRendaMes(ym, valor) {
      const { valor: v } = await api.setRendaMes(esp, ym, valor);
      dispatch({ type: "SET_RENDA", ym, valor: v });
    },
    // Salário fixo do espaço (default). Meses sem override herdam ele.
    async setRendaFixa(valor) {
      await api.setRendaFixa(esp, valor);
      dispatch({ type: "SET_RENDA_FIXA", valor });
    },
    // Remove o override do mês → volta a herdar o salário fixo.
    async clearRendaMes(ym) {
      await api.clearRendaMes(esp, ym);
      dispatch({ type: "CLEAR_RENDA", ym });
    },
    async addDespesaMes(dto) {
      const { despesa, cartoes } = await api.addDespesaMes(esp, dto);
      dispatch({ type: "ADD_DM", dm: despesa });
      dispatch({ type: "SET_CARTOES", cartoes });
      return despesa;
    },
    async updateDespesaMes(id, patch) {
      const { despesa, cartoes } = await api.updateDespesaMes(esp, id, patch);
      dispatch({ type: "UPSERT_DM", dm: despesa });
      dispatch({ type: "SET_CARTOES", cartoes });
      return despesa;
    },
    async removeDespesaMes(id) {
      const { cartoes } = await api.removeDespesaMes(esp, id);
      dispatch({ type: "REMOVE_DM", id });
      dispatch({ type: "SET_CARTOES", cartoes });
    },
    async setPagaMes(id, valorPago) {
      const dm = await api.setPagaMes(esp, id, valorPago);
      dispatch({ type: "UPSERT_DM", dm });
    },
    async addReceitaMes(dto) {
      const rm = await api.addReceitaMes(esp, dto);
      dispatch({ type: "ADD_RM", rm });
      return rm;
    },
    async updateReceitaMes(id, patch) {
      const rm = await api.updateReceitaMes(esp, id, patch);
      dispatch({ type: "UPSERT_RM", rm });
      return rm;
    },
    // Recorrente: pula só o mês `ym` (a receita continua valendo nos outros).
    async skipReceitaMes(id, ym) {
      await api.skipReceitaMes(esp, id, ym);
      dispatch({ type: "ADD_SKIP_RECEITA", receitaId: id, ym });
    },
    async unskipReceitaMes(id, ym) {
      await api.unskipReceitaMes(esp, id, ym);
      dispatch({ type: "REMOVE_SKIP_RECEITA", receitaId: id, ym });
    },
    // "Deste mês em diante": fecha a janela no mês anterior a `ym`.
    async encerrarReceitaMes(id, ym) {
      const rm = await api.encerrarReceitaMes(esp, id, ym);
      dispatch({ type: "UPSERT_RM", rm });
      return rm;
    },
    async removeReceitaMes(id) {
      await api.removeReceitaMes(esp, id);
      dispatch({ type: "REMOVE_RM", id });
    },

    async resetAll() {
      await api.resetState();
      await bootstrap();
    },
  };

  return (
    <Ctx.Provider value={{ ...state, ...actions, ym, setYm, cartoesCarregando }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFinance() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFinance precisa estar dentro de <FinanceProvider>");
  return ctx;
}
