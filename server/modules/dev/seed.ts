import { randomBytes } from "node:crypto";
import { prisma } from "@/server/lib/prisma";
import { parseDate, currentMonth, addMonths } from "@/server/lib/serialize";

// Meses ancorados no mês corrente. Antes isso era "2026-06" fixo: toda conta
// nova nascia com Início e Despesas vazios porque o mês visto na tela nunca
// batia com o mês dos dados.
const M0 = () => currentMonth();
const M = (n: number) => addMonths(M0(), n);
// Data dentro do mês, clampada no último dia (evita 31 em fevereiro).
const D = (ym: string, dia: number) => {
  const [y, m] = ym.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return parseDate(`${ym}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`);
};
const token = () => randomBytes(24).toString("base64url");
const emDias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

// Seed de exemplo — usado pelo reset ("Restaurar dados de exemplo").
// Apaga e recria SÓ os dados do usuário informado, numa transação.
export async function reseed(userId: string) {
  const mes = M0();
  const mesAnterior = M(-1);
  const doisMesesAtras = M(-2);

  await prisma.$transaction(async (tx) => {
    const doUsuario = { espaco: { userId } };
    // ordem importa por causa das FKs (cascata cobre, mas explícito é seguro)
    await tx.appSettings.deleteMany({ where: { userId } });
    await tx.espacoMesOculto.deleteMany({ where: doUsuario });
    await tx.movimentacao.deleteMany({ where: { caixinha: { userId } } });
    await tx.rendaMensal.deleteMany({ where: doUsuario });
    await tx.pagamentoFixa.deleteMany({ where: doUsuario });
    // adoções/adiantamentos são DESTE usuário como devedor — o reset é da conta dele
    await tx.shareAdiantamento.deleteMany({ where: { userId } });
    await tx.shareAdocao.deleteMany({ where: { userId } });
    // share agora pode não ter cartão (aluguel): o dono vem pelo contato
    await tx.cartaoShare.deleteMany({ where: { contato: { ownerId: userId } } });
    await tx.despesaFixa.deleteMany({ where: doUsuario });
    await tx.despesaMes.deleteMany({ where: doUsuario });
    await tx.receitaMes.deleteMany({ where: doUsuario });
    await tx.caixinha.deleteMany({ where: { userId } });
    await tx.espaco.deleteMany({ where: { userId } });
    await tx.cartao.deleteMany({ where: { userId } });
    await tx.categoria.deleteMany({ where: { userId } });
    await tx.contato.deleteMany({ where: { ownerId: userId } }); // convites em cascata

    // ── Caixinhas ────────────────────────────────────────────────────────────
    const emerg = await tx.caixinha.create({
      data: { userId, nome: "Reserva de emergência", tipo: "emergencia", aporteMensal: 700, meta: 14000, saldo: 158.25, cor: "emerald", acumulaSobra: false, ordem: 1 },
    });
    const varv = await tx.caixinha.create({
      data: { userId, nome: "Despesas Variáveis", aporteMensal: 200, meta: null, saldo: 0, cor: "violet", acumulaSobra: true, ordem: 2 },
    });

    await tx.movimentacao.createMany({
      data: [
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: D(doisMesesAtras, 5) },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: D(doisMesesAtras, 5) },
        { caixinhaId: varv.id, tipo: "despesa", valor: 120, descricao: "Farmácia", data: D(doisMesesAtras, 18) },
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: D(mesAnterior, 5) },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: D(mesAnterior, 5) },
        { caixinhaId: varv.id, tipo: "despesa", valor: 90, descricao: "Presente", data: D(mesAnterior, 22) },
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: D(mes, 5) },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: D(mes, 5) },
        { caixinhaId: varv.id, tipo: "despesa", valor: 250, descricao: "Conserto bike", data: D(mes, 15) },
      ],
    });

    // ── Espaços ──────────────────────────────────────────────────────────────
    const nosso = await tx.espaco.create({
      data: { userId, nome: "Nosso", tipo: "casal", emoji: "💑", rendaMensal: 7800, moeda: "BRL" },
    });
    const meu = await tx.espaco.create({
      data: { userId, nome: "Meu", tipo: "pessoal", emoji: "🧍", rendaMensal: 1200, moeda: "BRL" },
    });

    await tx.appSettings.create({ data: { userId, activeEspacoId: nosso.id } });

    // ── Cartões de crédito (globais dentro da conta) ────────────────────────
    const nubank = await tx.cartao.create({
      data: { userId, nome: "Nubank", bandeira: "Master", limite: 8000, diaFechamento: 3, diaVencimento: 10, cor: "violet", ordem: 1 },
    });
    const inter = await tx.cartao.create({
      data: { userId, nome: "Inter", bandeira: "Visa", limite: 5000, diaFechamento: 28, diaVencimento: 5, cor: "amber", ordem: 2 },
    });

    // ── Categorias de despesa (globais dentro da conta) ─────────────────────
    const moradia = await tx.categoria.create({ data: { userId, nome: "Moradia", cor: "blue", ordem: 1 } });
    const aliment = await tx.categoria.create({ data: { userId, nome: "Alimentação", cor: "emerald", ordem: 2 } });
    const lazer = await tx.categoria.create({ data: { userId, nome: "Lazer", cor: "violet", ordem: 3 } });
    const saude = await tx.categoria.create({ data: { userId, nome: "Saúde", cor: "rose", ordem: 4 } });
    const educ = await tx.categoria.create({ data: { userId, nome: "Educação", cor: "amber", ordem: 5 } });

    // Nosso — aluguel é a linha SEM cartão que exercita o rateio N-a-N
    const aluguel = await tx.despesaFixa.create({
      data: { espacoId: nosso.id, descricao: "Aluguel", valor: 1800, diaVencimento: 8, ativa: true, categoriaId: moradia.id, abateShares: true },
    });
    await tx.despesaFixa.createMany({
      data: [
        { espacoId: nosso.id, descricao: "Condomínio", valor: 450, diaVencimento: 8, ativa: true, categoriaId: moradia.id },
        { espacoId: nosso.id, descricao: "Energia + água", valor: 320, diaVencimento: 15, ativa: true, categoriaId: moradia.id },
      ],
    });
    await tx.despesaMes.createMany({
      data: [
        { espacoId: nosso.id, mes, descricao: "Mercado", valor: 720, data: D(mes, 8), categoriaId: aliment.id },
        { espacoId: nosso.id, mes, descricao: "Jantar fora", valor: 240, data: D(mes, 10), categoriaId: aliment.id },
        // compra no cartão (à vista)
        { espacoId: nosso.id, mes, descricao: "Geladeira", valor: 250, data: D(mes, 2), cartaoId: inter.id, categoriaId: moradia.id },
      ],
    });
    await tx.receitaMes.create({
      data: { espacoId: nosso.id, mes, descricao: "Freela design", valor: 600, data: D(mes, 14) },
    });
    await tx.rendaMensal.createMany({
      data: [
        { espacoId: nosso.id, ym: mesAnterior, valor: 7800 },
        { espacoId: nosso.id, ym: mes, valor: 7800 },
      ],
    });

    // Meu
    const streaming = await tx.despesaFixa.create({
      data: { espacoId: meu.id, descricao: "Streaming", valor: 40, diaVencimento: 5, ativa: true, cartaoId: nubank.id, categoriaId: lazer.id },
    });
    // fixa parcelada no cartão (jiu-jitsu 12x, na 3ª neste mês)
    const jiujitsu = await tx.despesaFixa.create({
      data: { espacoId: meu.id, descricao: "Jiu-jitsu", valor: 200, diaVencimento: 10, ativa: true, cartaoId: nubank.id, parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: mes, categoriaId: saude.id },
    });
    await tx.despesaFixa.create({
      data: { espacoId: meu.id, descricao: "Internet", valor: 100, diaVencimento: 10, ativa: true, categoriaId: moradia.id },
    });
    await tx.despesaMes.createMany({
      data: [
        { espacoId: meu.id, mes, descricao: "Academia extra", valor: 90, data: D(mes, 6), categoriaId: saude.id },
        { espacoId: meu.id, mes, descricao: "Livro", valor: 70, data: D(mes, 12), categoriaId: educ.id },
      ],
    });
    await tx.rendaMensal.createMany({
      data: [
        { espacoId: meu.id, ym: doisMesesAtras, valor: 1200 },
        { espacoId: meu.id, ym: mesAnterior, valor: 1200 },
        { espacoId: meu.id, ym: mes, valor: 1200 },
      ],
    });

    // ── Compartilhamento ────────────────────────────────────────────────────
    // Contato nasce `convidado` com convite pendente: quem tiver conta com esse
    // email aceita em /me/convites. Nada de acesso liberado sem consentimento.
    const convidados = [
      { nome: "Maria", email: "maria@exemplo.com" },
      { nome: "Carlos", email: "carlos@exemplo.com" },
    ];
    const [maria, carlos] = await Promise.all(
      convidados.map((c) =>
        tx.contato.create({
          data: {
            ownerId: userId,
            nome: c.nome,
            email: c.email,
            status: "convidado",
            convidadoEm: new Date(),
            convites: { create: { ownerId: userId, email: c.email, token: token(), expiraEm: emDias(14) } },
          },
        })
      )
    );

    await tx.cartaoShare.createMany({
      data: [
        // aluguel dividido em 3 (linha SEM cartão — o caso que o schema antigo não suportava)
        { contatoId: maria.id, tipo: "linha", despesaFixaId: aluguel.id, percentual: 33, descricao: "Aluguel" },
        { contatoId: carlos.id, tipo: "linha", despesaFixaId: aluguel.id, percentual: 33, descricao: "Aluguel" },
        // metade do streaming e uma parcelada do cartão
        { contatoId: maria.id, tipo: "linha", despesaFixaId: streaming.id, percentual: 50, descricao: "Metade do streaming" },
        { contatoId: maria.id, tipo: "linha", despesaFixaId: jiujitsu.id, percentual: 50, descricao: "Metade do jiu-jitsu" },
        // valor avulso na fatura do Nubank
        { cartaoId: nubank.id, contatoId: maria.id, tipo: "valor", valor: 80, mesRef: null, descricao: "Combinado mensal" },
      ],
    });
  }, { timeout: 30_000 }); // seed grande; evita P2028 em cold-start (CLI)
}
