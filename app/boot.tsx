"use client";

import { use, type ReactNode } from "react";
import AuthGate from "@/components/AuthGate";
import AppShell from "@/components/AppShell";
import { FinanceProvider } from "@/store/FinanceContext";
import type { AuthUser } from "@/services/financeApi";

type EstadoInicial = { userId: string } | null;

// Fronteira de cliente do boot servido: desembrulha a sessão que veio do RSC e
// repassa o estado (ainda como Promise) pro provider — o React suspende aqui em
// vez de esperar um useEffect depois da hidratação.
//
// Vive no LAYOUT (não numa página): é o que faz sessão, estado financeiro e
// casca sobreviverem à troca de rota. Cada `app/*/page.tsx` só monta a tela.
export default function Boot({
  usuarioPromise,
  estadoPromise,
  children,
}: {
  usuarioPromise: Promise<AuthUser | null>;
  estadoPromise: Promise<EstadoInicial>;
  children: ReactNode;
}) {
  const usuario = use(usuarioPromise);

  return (
    <AuthGate usuarioInicial={usuario}>
      <FinanceProvider estadoPromise={estadoPromise}>
        <AppShell>{children}</AppShell>
      </FinanceProvider>
    </AuthGate>
  );
}
