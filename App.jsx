import { useState } from "react";
import { LayoutGrid, Receipt, PiggyBank, CreditCard, ShieldCheck, Users } from "lucide-react";
import { useFinance } from "./store/FinanceContext.jsx";
import { useAuth } from "./components/AuthGate";
import { Spinner, Button } from "./components/ui/primitives.jsx";
import Dashboard from "./components/Dashboard.jsx";
import DespesasFixas from "./components/DespesasFixas.jsx";
import Cartoes from "./components/Cartoes.jsx";
import Pessoas from "./components/Pessoas.jsx";
import CaixinhaDetail from "./components/CaixinhaDetail.jsx";
import Admin from "./components/Admin";

// perms: item some se o usuário não tiver NENHUMA delas
const NAV = [
  { id: "dashboard", label: "Início", icon: LayoutGrid, perms: ["caixinha:view"] },
  { id: "fixas", label: "Despesas", icon: Receipt, perms: ["orcamento:view"] },
  { id: "cartoes", label: "Cartões", icon: CreditCard, perms: ["cartao:view"] },
  { id: "pessoas", label: "Pessoas", icon: Users, perms: ["cartao:share", "cartao:view_shared", "share:manage", "share:view_shared"] },
  { id: "admin", label: "Admin", icon: ShieldCheck, perms: ["user:view", "role:view"] },
];

export default function App() {
  const fin = useFinance();
  const { can } = useAuth();
  const nav = NAV.filter((n) => n.perms.some((p) => can(p)));
  const [view, setView] = useState(nav[0]?.id ?? "dashboard");
  const [caixinhaId, setCaixinhaId] = useState(null);

  function openCaixinha(id) {
    setCaixinhaId(id);
    setView("caixinha");
  }
  function go(id) {
    setCaixinhaId(null);
    setView(id);
  }

  if (nav.length === 0) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-sm text-slate-400">Sua conta não tem permissão pra ver nenhuma área. Fale com um admin.</p>
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

  const caixinha = fin.caixinhas.find((c) => c.id === caixinhaId);

  return (
    <div className="min-h-dvh lg:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 lg:flex">
        <Brand />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavItem key={n.id} {...n} active={view === n.id} onClick={() => go(n.id)} desktop />
          ))}
        </nav>
      </aside>

      {/* main */}
      <div className="flex-1">
        {/* mobile topbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg)]/90 px-4 py-3.5 backdrop-blur lg:hidden">
          <Brand />
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-28 sm:px-6 lg:py-8 lg:pb-10">
          {view === "dashboard" && <Dashboard onOpenCaixinha={openCaixinha} />}
          {view === "fixas" && <DespesasFixas />}
          {view === "cartoes" && <Cartoes />}
          {view === "pessoas" && <Pessoas />}
          {view === "admin" && <Admin />}
          {view === "caixinha" && caixinha && (
            <CaixinhaDetail caixinha={caixinha} onBack={() => go("dashboard")} />
          )}
        </main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {nav.map((n) => (
          <NavItem key={n.id} {...n} active={view === n.id} onClick={() => go(n.id)} />
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white shadow-lg shadow-blue-500/20">
        <PiggyBank size={19} />
      </span>
      <div className="leading-tight">
        <p className="font-bold text-white">Wallet</p>
        <p className="text-[11px] text-slate-500">finanças pessoais</p>
      </div>
    </div>
  );
}

function NavItem({ label, icon: Icon, active, onClick, desktop }) {
  if (desktop) {
    return (
      <button onClick={onClick}
        className={`inline-flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${active ? "bg-blue-500/15 text-blue-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}>
        <Icon size={18} /> {label}
      </button>
    );
  }
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors cursor-pointer ${active ? "text-blue-400" : "text-slate-500"
        }`}>
      <Icon size={20} /> {label}
    </button>
  );
}
