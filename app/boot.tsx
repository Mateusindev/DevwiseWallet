"use client";

import { use, type ReactNode } from "react";
import AuthGate from "@/components/AuthGate";
import AppShell from "@/components/AppShell";
import { FinanceProvider } from "@/store/FinanceContext";
import type { AuthUser } from "@/services/financeApi";
import type { TokenLeitura } from "@/server/auth/supabase-token";
import { adotarTokenInicial } from "@/lib/supabase";

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
  sidebarAbertaPromise,
  tokenLeituraPromise,
  children,
}: {
  usuarioPromise: Promise<AuthUser | null>;
  estadoPromise: Promise<EstadoInicial>;
  sidebarAbertaPromise: Promise<boolean>;
  tokenLeituraPromise: Promise<TokenLeitura | null>;
  children: ReactNode;
}) {
  const usuario = use(usuarioPromise);
  const sidebarAberta = use(sidebarAbertaPromise);
  // Módulo, não estado: o cliente do Supabase lê daqui. Idempotente, então
  // rodar no render (inclusive duas vezes no StrictMode) é inofensivo.
  adotarTokenInicial(use(tokenLeituraPromise));

  return (
    <AuthGate usuarioInicial={usuario}>
      <FinanceProvider estadoPromise={estadoPromise}>
        <AppShell sidebarAberta={sidebarAberta}>{children}</AppShell>
      </FinanceProvider>
    </AuthGate>
  );
}
