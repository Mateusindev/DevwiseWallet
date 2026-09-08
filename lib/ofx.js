// Parser de OFX (extrato/fatura de banco). Sem dependência: o formato é simples
// e as duas versões cabem no mesmo tokenizer.
//
// OFX 1.x é SGML — as tags de valor NÃO fecham:
//   <STMTTRN><TRNAMT>-45.90<MEMO>MERCADO X</STMTTRN>
// OFX 2.x é XML de verdade. As tags de agregado (STMTTRN) fecham nas duas, então
// dá pra fatiar por bloco e ler os valores folha por regex.

const TAGS_VALOR = /<(TRNTYPE|DTPOSTED|DTUSER|TRNAMT|FITID|MEMO|NAME|CHECKNUM)>([^<\r\n]*)/gi;

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };

const limpa = (v) =>
  (v || "")
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();

// Lê o arquivo respeitando o charset declarado. OFX brasileiro costuma vir em
// cp1252 — ler como UTF-8 estraga todo acento do MEMO.
export async function lerArquivoOfx(file) {
  const buf = await file.arrayBuffer();
  const cabecalho = new TextDecoder("windows-1252").decode(buf.slice(0, 1024));
  const latin =
    /CHARSET\s*[:=]\s*"?(1252|8859-1|ISO-8859-1)/i.test(cabecalho) ||
    /encoding\s*=\s*"(ISO-8859-1|WINDOWS-1252)"/i.test(cabecalho);
  return new TextDecoder(latin ? "windows-1252" : "utf-8").decode(buf);
}

// 20260815120000[-3:BRT] → 2026-08-15 (só os 8 primeiros dígitos importam; o
// resto é hora e fuso, e a data do lançamento é a do banco, não a local).
function dataOfx(v) {
  const d = (v || "").replace(/[^\d]/g, "").slice(0, 8);
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// -1.234,56 e -1234.56 são os dois formatos que aparecem na prática.
function valorOfx(v) {
  let t = (v || "").trim();
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function campos(bloco) {
  const out = {};
  TAGS_VALOR.lastIndex = 0;
  let m;
  while ((m = TAGS_VALOR.exec(bloco))) {
    const tag = m[1].toUpperCase();
    if (out[tag] == null) out[tag] = limpa(m[2]);
  }
  return out;
}

// → { conta: { id, tipo, moeda }, transacoes: [{ fitid, data, valor, descricao, tipo }] }
// `valor` mantém o sinal do arquivo; `tipo` é "debito" (< 0) ou "credito" (> 0).
export function parseOfx(texto) {
  const bruto = String(texto || "");
  // Antes de <OFX> só tem cabeçalho (OFXHEADER:100…) ou a declaração XML.
  const inicio = bruto.search(/<OFX>/i);
  if (inicio < 0) throw new Error("Não parece um arquivo OFX.");
  const corpo = bruto.slice(inicio);

  const acct = campos(corpo.match(/<(?:BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/(?:BANKACCTFROM|CCACCTFROM)>/i)?.[1] || "");
  const acctId = corpo.match(/<ACCTID>([^<\r\n]*)/i)?.[1];
  const acctTipo = corpo.match(/<ACCTTYPE>([^<\r\n]*)/i)?.[1];
  const moeda = corpo.match(/<CURDEF>([^<\r\n]*)/i)?.[1];

  const transacoes = [];
  const blocos = corpo.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
  for (const b of blocos) {
    const c = campos(b);
    const data = dataOfx(c.DTPOSTED || c.DTUSER);
    const valor = valorOfx(c.TRNAMT);
    if (!data || valor == null) continue;
    transacoes.push({
      fitid: c.FITID || null,
      data,
      valor,
      descricao: c.MEMO || c.NAME || c.CHECKNUM || "Lançamento",
      tipo: valor < 0 ? "debito" : "credito",
    });
  }

  if (transacoes.length === 0 && blocos.length === 0) {
    throw new Error("O arquivo não tem transações (nenhum <STMTTRN>).");
  }

  return {
    conta: { id: limpa(acctId) || limpa(acct.ACCTID) || null, tipo: limpa(acctTipo) || null, moeda: limpa(moeda) || "BRL" },
    transacoes,
  };
}
