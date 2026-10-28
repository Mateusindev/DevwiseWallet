"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CaixinhaDetail from "@/components/CaixinhaDetail.jsx";
import { useFinance } from "@/store/FinanceContext";

export default function Detalhe() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fin = useFinance() as unknown as { caixinhas: { id: string }[] };
  const caixinha = fin.caixinhas.find((c) => c.id === id);

  // Id que não existe (link velho, caixinha excluída): a casca já garante que o
  // boot terminou, então "não achei" aqui é definitivo — não é carregando.
  if (!caixinha) {
    return (
      <div className="grid min-h-[50vh] place-items-center px-6 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-ink">Caixinha não encontrada</h1>
          <p className="text-sm text-slate-400">Ela foi excluída ou o link é antigo.</p>
          <Link href="/" className="inline-block pt-1 text-sm font-medium text-blue-400 hover:text-blue-300">Voltar pro início</Link>
        </div>
      </div>
    );
  }

  return <CaixinhaDetail caixinha={caixinha} onBack={() => router.push("/")} />;
}
