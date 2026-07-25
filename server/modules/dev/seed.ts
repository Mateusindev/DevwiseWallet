import { prisma } from "@/server/lib/prisma";
import { parseDate } from "@/server/lib/serialize";

// Seed de exemplo — usado pelo reset ("Restaurar dados de exemplo").
// Apaga e recria SÓ os dados do usuário informado, numa transação.
export async function reseed(userId: string) {
  await prisma.$transaction(async (tx) => {
    const doUsuario = { espaco: { userId } };
    // ordem importa por causa das FKs (cascata cobre, mas explícito é seguro)
    await tx.appSettings.deleteMany({ where: { userId } });
    await tx.espacoMesOculto.deleteMany({ where: doUsuario });
    await tx.movimentacao.deleteMany({ where: { caixinha: { userId } } });
    await tx.rendaMensal.deleteMany({ where: doUsuario });
    await tx.pagamentoFixa.deleteMany({ where: doUsuario });
    await tx.cartaoShare.deleteMany({ where: { cartao: { userId } } });
    await tx.despesaFixa.deleteMany({ where: doUsuario });
    await tx.despesaMes.deleteMany({ where: doUsuario });
    await tx.receitaMes.deleteMany({ where: doUsuario });
    await tx.caixinha.deleteMany({ where: { userId } });
    await tx.espaco.deleteMany({ where: { userId } });
    await tx.cartao.deleteMany({ where: { userId } });
    await tx.categoria.deleteMany({ where: { userId } });
    await tx.contato.deleteMany({ where: { ownerId: userId } });

    // ── Caixinhas ────────────────────────────────────────────────────────────
    const emerg = await tx.caixinha.create({
      data: { userId, nome: "Reserva de emergência", tipo: "emergencia", aporteMensal: 700, meta: 14000, saldo: 158.25, cor: "emerald", acumulaSobra: false, ordem: 1 },
    });
    const varv = await tx.caixinha.create({
      data: { userId, nome: "Despesas Variáveis", aporteMensal: 200, meta: null, saldo: 0, cor: "violet", acumulaSobra: true, ordem: 2 },
    });

    await tx.movimentacao.createMany({
      data: [
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: parseDate("2026-04-05") },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: parseDate("2026-04-05") },
        { caixinhaId: varv.id, tipo: "despesa", valor: 120, descricao: "Farmácia", data: parseDate("2026-04-18") },
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: parseDate("2026-05-05") },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: parseDate("2026-05-05") },
        { caixinhaId: varv.id, tipo: "despesa", valor: 90, descricao: "Presente", data: parseDate("2026-05-22") },
        { caixinhaId: emerg.id, tipo: "aporte", valor: 700, descricao: "Aporte mensal", data: parseDate("2026-06-05") },
        { caixinhaId: varv.id, tipo: "aporte", valor: 200, descricao: "Aporte mensal", data: parseDate("2026-06-05") },
        { caixinhaId: varv.id, tipo: "despesa", valor: 250, descricao: "Conserto bike", data: parseDate("2026-06-15") },
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

    // Nosso
    await tx.despesaFixa.createMany({
      data: [
        { espacoId: nosso.id, descricao: "Aluguel", valor: 1800, diaVencimento: 8, ativa: true, categoriaId: moradia.id },
        { espacoId: nosso.id, descricao: "Condomínio", valor: 450, diaVencimento: 8, ativa: true, categoriaId: moradia.id },
        { espacoId: nosso.id, descricao: "Energia + água", valor: 320, diaVencimento: 15, ativa: true, categoriaId: moradia.id },
      ],
    });
    await tx.despesaMes.createMany({
      data: [
        { espacoId: nosso.id, mes: "2026-06", descricao: "Mercado", valor: 720, data: parseDate("2026-06-08"), categoriaId: aliment.id },
        { espacoId: nosso.id, mes: "2026-06", descricao: "Jantar fora", valor: 240, data: parseDate("2026-06-10"), categoriaId: aliment.id },
        // compra no cartão (à vista)
        { espacoId: nosso.id, mes: "2026-06", descricao: "Geladeira", valor: 250, data: parseDate("2026-06-02"), cartaoId: inter.id, categoriaId: moradia.id },
      ],
    });
    await tx.receitaMes.create({
      data: { espacoId: nosso.id, mes: "2026-06", descricao: "Freela design", valor: 600, data: parseDate("2026-06-14") },
    });
    await tx.rendaMensal.createMany({
      data: [
        { espacoId: nosso.id, ym: "2026-05", valor: 7800 },
        { espacoId: nosso.id, ym: "2026-06", valor: 7800 },
      ],
    });

    // Meu
    await tx.despesaFixa.createMany({
      data: [
        { espacoId: meu.id, descricao: "Internet", valor: 100, diaVencimento: 10, ativa: true, categoriaId: moradia.id },
        { espacoId: meu.id, descricao: "Streaming", valor: 40, diaVencimento: 5, ativa: true, cartaoId: nubank.id, categoriaId: lazer.id },
        // fixa parcelada no cartão (jiu-jitsu 12x, na 3ª em junho/2026)
        { espacoId: meu.id, descricao: "Jiu-jitsu", valor: 200, diaVencimento: 10, ativa: true, cartaoId: nubank.id, parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", categoriaId: saude.id },
      ],
    });
    await tx.despesaMes.createMany({
      data: [
        { espacoId: meu.id, mes: "2026-06", descricao: "Academia extra", valor: 90, data: parseDate("2026-06-06"), categoriaId: saude.id },
        { espacoId: meu.id, mes: "2026-06", descricao: "Livro", valor: 70, data: parseDate("2026-06-12"), categoriaId: educ.id },
      ],
    });
    await tx.rendaMensal.createMany({
      data: [
        { espacoId: meu.id, ym: "2026-04", valor: 1200 },
        { espacoId: meu.id, ym: "2026-05", valor: 1200 },
        { espacoId: meu.id, ym: "2026-06", valor: 1200 },
      ],
    });

    // ── Fatura compartilhada ────────────────────────────────────────────────
    // Maria divide metade do streaming e paga um valor fixo todo mês no Nubank.
    const maria = await tx.contato.create({
      data: { ownerId: userId, nome: "Maria", email: "maria@exemplo.com" },
    });
    const streaming = await tx.despesaFixa.findFirstOrThrow({
      where: { espacoId: meu.id, descricao: "Streaming" },
      select: { id: true },
    });
    await tx.cartaoShare.createMany({
      data: [
        { cartaoId: nubank.id, contatoId: maria.id, tipo: "linha", despesaFixaId: streaming.id, percentual: 50, descricao: "Metade do streaming" },
        { cartaoId: nubank.id, contatoId: maria.id, tipo: "valor", valor: 80, mesRef: null, descricao: "Combinado mensal" },
      ],
    });
  }, { timeout: 30_000 }); // seed grande; evita P2028 em cold-start (CLI)
}
