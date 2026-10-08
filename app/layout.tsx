import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import Boot from "./boot";
import { sessaoAtual } from "@/server/next/session";
import { getState } from "@/server/modules/bootstrap/bootstrap.service";
import { authService } from "@/server/auth/auth.service";

export const metadata: Metadata = {
  title: "Wallet",
  description: "finanças pessoais",
};

// O boot mora no layout, não numa página: sessão + estado financeiro + casca
// precisam SOBREVIVER à navegação. O Next não re-renderiza layout compartilhado
// na troca de rota — só o segmento da página —, então trocar de aba não refaz o
// `getState` (que é a leitura mais cara do app).
//
// As Promises são passadas SEM await: o servidor dispara as queries e o cliente
// desembrulha com `use()`, então o dado chega no mesmo stream do HTML. Antes
// daqui a sequência era HTML vazio → baixa/hidrata o bundle → `me()` no
// useEffect → só então `getState()`; dois round-trips que nem dava pra
// prefetchar.
// Tema aplicado ANTES da primeira pintura. Tem que ser script inline no <head>:
// o valor mora no localStorage (não existe no servidor), então qualquer leitura
// em efeito de React só aconteceria depois da hidratação — e o usuário de tema
// claro veria um flash do fundo escuro a cada navegação com recarga.
// `suppressHydrationWarning` no <html> porque é justamente este script que muda
// o atributo entre o HTML do servidor e a hidratação.
const TEMA_INLINE = `(function(){try{var t=localStorage.getItem("wallet:tema");if(t!=="claro"&&t!=="escuro"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"claro":"escuro";}document.documentElement.dataset.tema=t;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const usuario = sessaoAtual().catch(() => null);
  // sem sessão (ou sem state:view) o boot resolve null e o cliente cai no fluxo
  // de login; o catch existe porque uma Promise rejeitada que ninguém consome
  // derruba o processo.
  const estado = usuario
    .then(async (u) => (u && (await authService.can(u, "state:view")) ? getState(u.id) : null))
    .catch(() => null);

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INLINE }} />
      </head>
      <body>
        <Suspense fallback={<Carregando />}>
          <Boot usuarioPromise={usuario} estadoPromise={estado}>
            {children}
          </Boot>
        </Suspense>
      </body>
    </html>
  );
}

function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Carregando…</div>
  );
}
