"use client";

import { Users } from "lucide-react";
import { ConvitesBanner, Contatos, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { MonthStepper } from "./ui/fields.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import { janelaMeses, mesesComDados } from "../lib/calc.js";

// Aba "Pessoas": convites pendentes, o que devo e a agenda. O mês é o mesmo do
// resto do app (o devido muda de mês pra mês).
export default function Pessoas() {
  const fin = useFinance();
  const { ym, setYm, refresh } = fin;
  const { can } = useAuth();
  const meses = janelaMeses({ dados: mesesComDados(fin) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Users size={20} /> Pessoas
        </h2>
        <MonthStepper value={ym} onValue={setYm} min={meses[0]} max={meses[meses.length - 1]} />
      </div>

      <ConvitesBanner onRespondido={refresh} />
      {can("cartao:view_shared") && <MeusCompartilhamentos ym={ym} />}
      {can("cartao:share") && <Contatos />}
    </div>
  );
}
