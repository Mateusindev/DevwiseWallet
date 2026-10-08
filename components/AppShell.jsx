"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Receipt, PiggyBank, CreditCard, ShieldCheck, Users } from "lucide-react";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import { Spinner, Button } from "./ui/primitives.jsx";
import { BotaoTema } from "./ui/tema.jsx";

// Casca do app: navegação + gate do boot. O conteúdo de cada área virou rota de
// verdade (`app/despesas/page.tsx` e cia.) em vez de `useState("view")` — o
// endereço passou a existir: recarregar cai na mesma tela, voltar volta, e dá
// pra mandar link de uma aba pra alguém.
//
// O estado financeiro vive no provider do LAYOUT, então trocar de rota NÃO
// refaz o boot: o Next mantém layout compartilhado entre rotas irmãs e só
// substitui o segmento da página.
//
// perms: item some se o usuário não tiver NENHUMA delas
const NAV = [
  { href: "/", label: "Início", icon: LayoutGrid, perms: ["caixinha:view"] },
  { href: "/despesas", label: "Despesas", icon: Receipt, perms: ["orcamento:view"] },
  { href: "/cartoes", label: "Cartões", icon: CreditCard, perms: ["cartao:view"] },
  {
    href: "/pessoas",
    label: "Pessoas",
    icon: Users,
    perms: ["cartao:share", "cartao:view_shared", "share:manage", "share:view_shared"],
  },
  { href: "/admin", label: "Admin", icon: ShieldCheck, perms: ["user:view", "role:view"] },
];

// A área de caixinhas é filha do Início: `/caixinhas/:id` mantém "Início" aceso.
function estaAtivo(href, pathname) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/caixinhas");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }) {
  const fin = useFinance();
  const { can } = useAuth();
  const pathname = usePathname();
  const nav = NAV.filter((n) => n.perms.some((p) => can(p)));

  if (nav.length === 0) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-sm text-slate-400">
          Sua conta não tem permissão pra ver nenhuma área. Fale com um admin.
        </p>
      </div>
    );
  }

  if (fin.status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-7 w-7" />
          <p className="text-sm">Carregando suas finanças…</p>
        </div>
      </div>
    );
  }

  if (fin.status === "error") {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="space-y-3">
          <p className="text-slate-300">Não consegui carregar os dados.</p>
          <p className="text-xs text-slate-500">{fin.error}</p>
          <Button onClick={fin.refresh}>Tentar de novo</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 lg:flex">
        <Brand />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavItem key={n.href} {...n} ativo={estaAtivo(n.href, pathname)} desktop />
          ))}
        </nav>
        <BotaoTema className="self-start" />
      </aside>

      {/* main */}
      <div className="flex-1">
        {/* mobile topbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg)]/90 px-4 py-3.5 backdrop-blur lg:hidden">
          <Brand />
          <BotaoTema />
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-28 sm:px-6 lg:py-8 lg:pb-10">
          {children}
        </main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {nav.map((n) => (
          <NavItem key={n.href} {...n} ativo={estaAtivo(n.href, pathname)} />
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white shadow-lg shadow-blue-500/20">
        <PiggyBank size={19} />
      </span>
      <div className="leading-tight">
        <p className="font-bold text-ink">Wallet</p>
        <p className="text-[11px] text-slate-500">finanças pessoais</p>
      </div>
    </Link>
  );
}

// Barra de progresso do próprio link. `useLinkStatus` só funciona DENTRO de um
// <Link>, então mora aqui: é o que responde ao clique enquanto o Next busca o
// segmento novo — sem isso a navegação parecia ignorada em rede lenta.
function ProgressoDoLink() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full bg-blue-400/25">
      <span className="block h-full w-full origin-left bg-blue-400"
            style={{ animation: "rota-progresso 1.1s ease-out infinite" }} />
    </span>
  );
}

function NavItem({ href, label, icon: Icon, ativo, desktop }) {
  const base = "relative cursor-pointer transition-colors";
  if (desktop) {
    return (
      <Link
        href={href}
        prefetch
        aria-current={ativo ? "page" : undefined}
        className={`${base} inline-flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
          ativo ? "bg-blue-500/15 text-blue-300" : "text-slate-400 hover:bg-veu/5 hover:text-slate-200"
        }`}
      >
        <Icon size={18} /> {label}
        <ProgressoDoLink />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      prefetch
      aria-current={ativo ? "page" : undefined}
      className={`${base} flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
        ativo ? "text-blue-400" : "text-slate-500"
      }`}
    >
      <Icon size={20} /> {label}
      <ProgressoDoLink />
    </Link>
  );
}

// Guarda de rota no cliente: esconde a área que a conta não pode ver. A
// autoridade continua sendo o servidor (toda action passa por `requireAnyPerm`)
// — isto existe pra quem digita a URL não cair numa tela quebrada de 403.
export function Protegido({ perms, children }) {
  const { can } = useAuth();
  if (perms.some((p) => can(p))) return children;
  return (
    <div className="grid min-h-[50vh] place-items-center px-6 text-center">
      <div className="space-y-2">
        <p className="text-slate-300">Essa área não está liberada pra sua conta.</p>
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">Voltar pro início</Link>
      </div>
    </div>
  );
}
