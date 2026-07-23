// ── Mock seed data ──────────────────────────────────────────────────────
// Shape mirrors what a REST API would return.
//
// CAIXINHAS (economias) são GLOBAIS — um conjunto só, compartilhado.
// As DESPESAS (orçamento) são organizadas por ESPAÇO: "Nosso" (casal) e "Meu"
// (solo). Cada espaço de despesa tem suas próprias fixas, despesas do mês e renda.

let _seq = 1;
const id = (p) => `${p}_${_seq++}`;

// Orçamento vazio — usado ao criar um espaço de despesa novo.
export const blobVazioOrcamento = () => ({
  despesasFixas: [],
  despesasMes: [],
  receitasMes: [],
  rendasMensais: {},
  config: { rendaMensal: 0, moeda: "BRL" },
});

// ── Economias (globais) ──────────────────────────────────────────────────────
function caixinhasSeed() {
  return [
    { id: "cx_emergencia", nome: "Emergência", aporteMensal: 700, meta: 7000, saldo: 2100, cor: "emerald", acumulaSobra: false, ordem: 1 },
    { id: "cx_oportunidade", nome: "Oportunidade", aporteMensal: 300, meta: null, saldo: 900, cor: "blue", acumulaSobra: false, ordem: 2 },
    { id: "cx_despesas_variaveis", nome: "Despesas Variáveis", aporteMensal: 200, meta: null, saldo: 140, cor: "violet", acumulaSobra: true, ordem: 3 },
  ];
}

function movimentacoesSeed() {
  return [
    // Abril
    { id: id("mv"), caixinhaId: "cx_emergencia", tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: "2026-04-05" },
    { id: id("mv"), caixinhaId: "cx_oportunidade", tipo: "aporte", valor: 300, descricao: "Aporte mensal", data: "2026-04-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: "2026-04-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "despesa", valor: 120, descricao: "Farmácia", data: "2026-04-18" },
    // Maio
    { id: id("mv"), caixinhaId: "cx_emergencia", tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: "2026-05-05" },
    { id: id("mv"), caixinhaId: "cx_oportunidade", tipo: "aporte", valor: 300, descricao: "Aporte mensal", data: "2026-05-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: "2026-05-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "despesa", valor: 90, descricao: "Presente", data: "2026-05-22" },
    // Junho (mês corrente)
    { id: id("mv"), caixinhaId: "cx_emergencia", tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: "2026-06-05" },
    { id: id("mv"), caixinhaId: "cx_oportunidade", tipo: "aporte", valor: 300, descricao: "Aporte mensal", data: "2026-06-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: "2026-06-05" },
    { id: id("mv"), caixinhaId: "cx_despesas_variaveis", tipo: "despesa", valor: 250, descricao: "Conserto bike", data: "2026-06-15" },
  ];
}

// ── Orçamento "Nosso" (casal) ────────────────────────────────────────────────
function orcamentoNosso() {
  return {
    despesasFixas: [
      { id: "dfn_aluguel", descricao: "Aluguel", valor: 1800, diaVencimento: 8, ativa: true },
      { id: "dfn_condominio", descricao: "Condomínio", valor: 450, diaVencimento: 8, ativa: true },
      { id: "dfn_energia", descricao: "Energia + água", valor: 320, diaVencimento: 15, ativa: true },
    ],
    despesasMes: [
      { id: "dmn_1", mes: "2026-06", descricao: "Mercado", valor: 720, data: "2026-06-08" },
      { id: "dmn_2", mes: "2026-06", descricao: "Jantar fora", valor: 240, data: "2026-06-10" },
    ],
    receitasMes: [
      { id: "rmn_1", mes: "2026-06", descricao: "Freela design", valor: 600, data: "2026-06-14" },
    ],
    rendasMensais: { "2026-05": 7800, "2026-06": 7800 },
    config: { rendaMensal: 7800, moeda: "BRL" },
  };
}

// ── Orçamento "Meu" (solo) ─────────────────────────────────────────────────────
function orcamentoMeu() {
  return {
    despesasFixas: [
      { id: "dfm_internet", descricao: "Internet", valor: 100, diaVencimento: 10, ativa: true },
      { id: "dfm_streaming", descricao: "Streaming", valor: 40, diaVencimento: 5, ativa: true },
    ],
    despesasMes: [
      { id: "dmm_1", mes: "2026-06", descricao: "Academia extra", valor: 90, data: "2026-06-06" },
      { id: "dmm_2", mes: "2026-06", descricao: "Livro", valor: 70, data: "2026-06-12" },
    ],
    receitasMes: [],
    rendasMensais: { "2026-04": 1200, "2026-05": 1200, "2026-06": 1200 },
    config: { rendaMensal: 1200, moeda: "BRL" },
  };
}

// ── Estado raiz semeado ──────────────────────────────────────────────────────
export function makeSeed() {
  return {
    caixinhas: caixinhasSeed(),
    movimentacoes: movimentacoesSeed(),
    espacos: [
      { id: "esp_nosso", nome: "Nosso", tipo: "casal", emoji: "💑" },
      { id: "esp_meu", nome: "Meu", tipo: "pessoal", emoji: "🧍" },
    ],
    activeEspacoId: "esp_nosso",
    despesasData: {
      esp_nosso: orcamentoNosso(),
      esp_meu: orcamentoMeu(),
    },
  };
}
