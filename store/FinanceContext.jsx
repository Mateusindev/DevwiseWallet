import { createContext, useContext, useCallback, useEffect, useMemo, useReducer } from "react";
import * as api from "../services/financeApi";

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
  // orçamento do espaço ativo
  despesasFixas: [],
  despesasMes: [],
  receitasMes: [],
  pagamentosFixas: [], // [{ despesaFixaId, ym }] — fixas marcadas pagas por mês
  rendasMensais: {},
  config: { rendaMensal: 0, moeda: "BRL" },
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
      return { ...state, orcamentoStatus: "loading" };
    case "SET_ORCAMENTO":
      return { ...state, activeEspacoId: action.id, orcamentoStatus: "ready", ...action.orcamento };

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

export function FinanceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const esp = state.activeEspacoId;
  // As actions leem só estas três fatias do estado (o resto vem do back a cada
  // chamada) — são as deps do useMemo que memoiza o objeto de actions.
  const { espacos, espacosOcultos } = state;

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
    bootstrap();
  }, [bootstrap]);

  // Refaz os agregados de fatura dos cartões (mês corrente por padrão).
  const reloadCartoes = useCallback(async (ymArg) => {
    const cartoes = await api.getCartoes(ymArg);
    dispatch({ type: "SET_CARTOES", cartoes });
    return cartoes;
  }, []);

  // Versão fire-and-forget do reloadCartoes: os agregados de fatura são um
  // efeito colateral das mutações de despesa, então ninguém espera (nem trata)
  // o resultado. Sem o catch, um 403/401 aqui vira unhandled rejection — que no
  // navegador polui o console e nos testes derruba a suíte inteira.
  const refreshCartoes = useCallback(() => { reloadCartoes().catch(() => {}); }, [reloadCartoes]);

  // Identidade estável: sem o useMemo, TODO efeito de componente que dependa de
  // uma action (ex.: o pulo automático de página em DespesasFixas) roda em todo
  // render — foi a causa raiz do "Maximum update depth exceeded" de lá. Agora o
  // objeto só troca quando o espaço ativo (ou a lista de espaços) muda, que é
  // exatamente quando as actions passam a se comportar diferente.
  const actions = useMemo(() => ({
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
    async setActiveEspaco(id) {
      if (id === esp) return;
      dispatch({ type: "ORC_LOADING" });
      // sem espaco:manage o PUT /active falha (403) — troca vira só local
      try { await api.setActiveEspaco(id); } catch { /* viewer */ }
      const orcamento = await api.getOrcamento(id);
      dispatch({ type: "SET_ORCAMENTO", id, orcamento });
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
        const orcamento = await api.getOrcamento(activeEspacoId);
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
          [...espacosOcultos, { espacoId: id, ym }]
            .filter((o) => o.ym === ym)
            .map((o) => o.espacoId)
        );
        const proxima = espacos.find((e) => !ocultosNoMes.has(e.id));
        if (proxima && proxima.id !== esp) {
          await api.setActiveEspaco(proxima.id);
          const orcamento = await api.getOrcamento(proxima.id);
          dispatch({ type: "SET_ORCAMENTO", id: proxima.id, orcamento });
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
    async addDespesaFixa(dto) {
      const df = await api.addDespesaFixa(esp, dto);
      dispatch({ type: "UPSERT_DF", df });
      if (df.cartaoId) refreshCartoes();
      return df;
    },
    async updateDespesaFixa(id, patch) {
      const df = await api.updateDespesaFixa(esp, id, patch);
      dispatch({ type: "UPSERT_DF", df });
      refreshCartoes();
      return df;
    },
    async toggleDespesaFixa(id) {
      const df = await api.toggleDespesaFixa(esp, id);
      dispatch({ type: "UPSERT_DF", df });
      if (df.cartaoId) refreshCartoes();
    },
    async removeDespesaFixa(id) {
      await api.removeDespesaFixa(esp, id);
      dispatch({ type: "REMOVE_DF", id });
      refreshCartoes();
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
      const dm = await api.addDespesaMes(esp, dto);
      dispatch({ type: "ADD_DM", dm });
      if (dm.cartaoId) refreshCartoes();
      return dm;
    },
    async updateDespesaMes(id, patch) {
      const dm = await api.updateDespesaMes(esp, id, patch);
      dispatch({ type: "UPSERT_DM", dm });
      refreshCartoes();
      return dm;
    },
    async removeDespesaMes(id) {
      await api.removeDespesaMes(esp, id);
      dispatch({ type: "REMOVE_DM", id });
      refreshCartoes();
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
    async removeReceitaMes(id) {
      await api.removeReceitaMes(esp, id);
      dispatch({ type: "REMOVE_RM", id });
    },

    async resetAll() {
      await api.resetState();
      await bootstrap();
    },
  }), [esp, espacos, espacosOcultos, bootstrap, reloadCartoes, refreshCartoes]);

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFinance() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFinance precisa estar dentro de <FinanceProvider>");
  return ctx;
}
