// Server Component: começa a sessão e o boot ANTES de o bundle existir no
// cliente. Antes daqui a sequência era HTML vazio → baixa/hidrata o bundle →
// `me()` no useEffect → só então `getState()`; dois round-trips que nem dava
// pra prefetchar.
//
// As Promises são passadas SEM await: o servidor dispara as queries e o cliente
// desembrulha com `use()`, então o dado chega no mesmo stream do HTML.
//
// A navegação continua sendo SPA client-side — só o boot passou a ser servido.
import { Suspense } from "react";
import Boot from "./boot";
import { sessaoAtual } from "@/server/next/session";
import { getState } from "@/server/modules/bootstrap/bootstrap.service";
import { authService } from "@/server/auth/auth.service";

export default function Home() {
  const usuario = sessaoAtual().catch(() => null);
  // sem sessão (ou sem state:view) o boot resolve null e o cliente cai no fluxo
  // de login; o catch existe porque uma Promise rejeitada que ninguém consome
  // derruba o processo.
  const estado = usuario
    .then(async (u) => (u && (await authService.can(u, "state:view")) ? getState(u.id) : null))
    .catch(() => null);

  return (
    <Suspense fallback={<Carregando />}>
      <Boot usuarioPromise={usuario} estadoPromise={estado} />
    </Suspense>
  );
}

function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Carregando…</div>
  );
}
