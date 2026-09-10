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
          <p className="text-slate-300">Essa caixinha não existe mais.</p>
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">Voltar pro início</Link>
        </div>
      </div>
    );
  }

  return <CaixinhaDetail caixinha={caixinha} onBack={() => router.push("/")} />;
}
