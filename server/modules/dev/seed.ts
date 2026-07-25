import { prisma } from "@/server/lib/prisma";
import { parseDate } from "@/server/lib/serialize";
import { AppError } from "@/server/lib/errors";

// Seed espelha db/ddl.sql — usado pelo reset ("Restaurar dados de exemplo").
// Apaga tudo e recria o estado de exemplo numa transação, atribuído ao 1º usuário.
export async function reseed() {
  await prisma.$transaction(async (tx) => {
    // dono dos dados de exemplo: primeiro usuário cadastrado (dado é per-user)
    const user = await tx.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) throw new AppError("Nenhum usuário cadastrado — rode o seed:auth antes.");
    const userId = user.id;

    // ordem importa por causa das FKs (cascata cobre, mas explícito é seguro)
    await tx.appSettings.deleteMany();
    await tx.espacoMesOculto.deleteMany();
    await tx.movimentacao.deleteMany();
    await tx.rendaMensal.deleteMany();
    await tx.pagamentoFixa.deleteMany();
    await tx.despesaFixa.deleteMany();
    await tx.despesaMes.deleteMany();
    await tx.receitaMes.deleteMany();
    await tx.caixinha.deleteMany();
    await tx.espaco.deleteMany();
    await tx.cartao.deleteMany();
    await tx.categoria.deleteMany();

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

    // ── Cartões de crédito (do usuário) ─────────────────────────────────────
    const nubank = await tx.cartao.create({
      data: { userId, nome: "Nubank", bandeira: "Master", limite: 8000, diaFechamento: 3, diaVencimento: 10, cor: "violet", ordem: 1 },
    });
    const inter = await tx.cartao.create({
      data: { userId, nome: "Inter", bandeira: "Visa", limite: 5000, diaFechamento: 28, diaVencimento: 5, cor: "amber", ordem: 2 },
    });

    // ── Categorias de despesa (do usuário) ──────────────────────────────────
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
  }, { timeout: 30_000 }); // seed grande; evita P2028 em cold-start (CLI)
}
