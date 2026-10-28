"use client";

import { useCallback, useState } from "react";
import { Mail, Check, Split } from "lucide-react";
import { ConvitesBanner, Contatos, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { Card, CardHeader, PageHeader } from "./ui/primitives.jsx";
import { MonthStepper } from "./ui/fields.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import { janelaMeses, mesesComDados } from "../lib/calc.js";
import { fmtMoney, fmtMonthLabel } from "../lib/format.js";

// Aba "Pessoas": convites pendentes, o que devo e a agenda. O mês é o mesmo do
// resto do app (o devido muda de mês pra mês).
//
// Duas colunas no desktop: à esquerda o que se faz (dívida do mês, agenda); à
// direita o resumo da agenda e como a divisão funciona — a tela sozinha, numa
// coluna só, era um cartão no topo e um vazio de 600px embaixo.
export default function Pessoas() {
  const fin = useFinance();
  const { ym, setYm, refresh } = fin;
  const { can } = useAuth();
  const meses = janelaMeses({ dados: mesesComDados(fin) });
  const verDevido = can("cartao:view_shared");
  const verAgenda = can("cartao:share");

  // Os dois painéis já leem o que precisam; aqui só ouvimos os totais pra
  // escrever a frase do título (sem uma segunda ida ao servidor).
  const [devido, setDevido] = useState(null);
  const [agenda, setAgenda] = useState(null);
  const onTotal = useCallback((t) => setDevido(t), []);
  const onResumo = useCallback((r) => setAgenda(r), []);

  const frase = [
    verDevido && devido != null
      ? devido > 0
        ? `Você deve ${fmtMoney(devido)} em ${fmtMonthLabel(ym).toLowerCase()}`
        : `Nada a pagar pra ninguém em ${fmtMonthLabel(ym).toLowerCase()}`
      : null,
    verAgenda && agenda
      ? `${agenda.total} ${agenda.total === 1 ? "pessoa" : "pessoas"} na agenda`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pessoas"
        description={frase || "Quem divide despesas com você"}
        actions={<MonthStepper value={ym} onValue={setYm} min={meses[0]} max={meses[meses.length - 1]} />}
      />

      <ConvitesBanner onRespondido={refresh} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
        <div className="min-w-0 space-y-6">
          {verDevido && <MeusCompartilhamentos ym={ym} onTotal={onTotal} vazio="Você não deve nada a ninguém este mês" />}
          {verAgenda && <Contatos onResumo={onResumo} />}
        </div>

        <aside className="space-y-6">
          {verAgenda && agenda && agenda.total > 0 && (
            <Card className="p-5">
              <CardHeader title="Resumo da agenda" />
              <dl className="mt-3 space-y-2 text-sm">
                <Linha label="Aceitaram" valor={agenda.ativos} />
                <Linha label="Convite enviado" valor={agenda.convidados} />
                <Linha label="Só na agenda" valor={agenda.total - agenda.ativos - agenda.convidados} />
              </dl>
            </Card>
          )}

          <Card className="p-5">
            <CardHeader title="Como a divisão funciona" />
            <ol className="mt-4 space-y-4">
              <Passo icon={Mail} titulo="Convite">
                Adicione a pessoa na agenda e mande o link do convite.
              </Passo>
              <Passo icon={Check} titulo="Aceite">
                Só quem aceita enxerga o que foi dividido com ela.
              </Passo>
              <Passo icon={Split} titulo="Rateio">
                Em Despesas ou Cartões, divida uma linha em valor ou percentual. Ela aparece em “O que devo” de quem paga.
              </Passo>
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Linha({ label, valor }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="tnum font-medium text-ink">{valor}</dd>
    </div>
  );
}

function Passo({ icon: Icon, titulo, children }) {
  return (
    <li className="flex gap-3">
      <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />
      <div>
        <p className="text-sm font-medium text-ink">{titulo}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{children}</p>
      </div>
    </li>
  );
}
