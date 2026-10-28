import { Suspense } from "react";
import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import Boot from "./boot";
import { sessaoAtual } from "@/server/next/session";
import { getState } from "@/server/modules/bootstrap/bootstrap.service";
import { authService } from "@/server/auth/auth.service";
import { tokenDeLeitura } from "@/server/auth/supabase-token";

// Manrope: grotesca de algarismos largos e tabulares — é ela que carrega o
// saldo. Variável (200–800), então o peso "bold" do tema pode ser 650.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Wallet",
  description: "finanças pessoais",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0d0f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
  ],
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
  // Barra lateral recolhida ou não: o `SidebarProvider` (shadcn) grava o
  // cookie a cada troca; ler aqui é o que faz o SSR já sair na largura certa
  // em vez de abrir e fechar na hidratação.
  // Primeiro token de leitura direta no Supabase (null = desligada aqui): vem
  // no mesmo stream do boot, então a primeira leitura do navegador não espera
  // uma action só pra buscar token.
  const tokenLeitura = usuario.then((u) => tokenDeLeitura(u)).catch(() => null);
  const sidebarAberta = cookies().then((c) => c.get("sidebar_state")?.value !== "false");

  return (
    <html lang="pt-BR" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INLINE }} />
      </head>
      <body>
        <Suspense fallback={<Carregando />}>
          <Boot usuarioPromise={usuario} estadoPromise={estado} sidebarAbertaPromise={sidebarAberta} tokenLeituraPromise={tokenLeitura}>
            {children}
          </Boot>
        </Suspense>
      </body>
    </html>
  );
}

function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500/30 border-t-slate-300" />
    </div>
  );
}
