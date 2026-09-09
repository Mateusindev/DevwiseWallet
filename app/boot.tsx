"use client";

import { use } from "react";
import App from "@/App";
import AuthGate from "@/components/AuthGate";
import { FinanceProvider } from "@/store/FinanceContext";
import type { AuthUser } from "@/services/financeApi";

type EstadoInicial = { userId: string } | null;

// Fronteira de cliente do boot servido: desembrulha a sessão que veio do RSC e
// repassa o estado (ainda como Promise) pro provider — o React suspende aqui
// em vez de esperar um useEffect depois da hidratação.
export default function Boot({
  usuarioPromise,
  estadoPromise,
}: {
  usuarioPromise: Promise<AuthUser | null>;
  estadoPromise: Promise<EstadoInicial>;
}) {
  const usuario = use(usuarioPromise);

  return (
    <AuthGate usuarioInicial={usuario}>
      <FinanceProvider estadoPromise={estadoPromise}>
        <App />
      </FinanceProvider>
    </AuthGate>
  );
}
