"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Home, Receipt, CreditCard, ShieldCheck, Users, LogOut, Moon, Sun, ChevronsUpDown } from "lucide-react";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import { Spinner, Button } from "./ui/primitives.jsx";
import { useTema } from "./ui/tema.jsx";
import { Marca } from "./ui/marca.jsx";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";

// Casca do app: navegação + gate do boot. O conteúdo de cada área virou rota de
// verdade (`app/despesas/page.tsx` e cia.) em vez de `useState("view")` — o
// endereço passou a existir: recarregar cai na mesma tela, voltar volta, e dá
// pra mandar link de uma aba pra alguém.
//
// O estado financeiro vive no provider do LAYOUT, então trocar de rota NÃO
// refaz o boot: o Next mantém layout compartilhado entre rotas irmãs e só
// substitui o segmento da página.
//
// Desenho (Sidebar do shadcn, `components/ui/sidebar.tsx`): a barra lateral
// fica no MESMO chão da página (só uma régua de 1px a separa), o item ativo é
// uma pílula neutra — cor fica pro dado — e ela recolhe pra um trilho de
// ícones (botão no topo, a borda da barra ou Ctrl+B; o estado mora no cookie
// `sidebar_state`, lido no layout pra não piscar no SSR). Conta, tema e sair
// moram num menu só, no rodapé. No celular (< md) vira barra superior (marca +
// conta) e barra inferior com rótulo — com quatro ou cinco destinos, a barra
// do polegar ganha de um menu escondido atrás de um hambúrguer.
//
// perms: item some se o usuário não tiver NENHUMA delas
const NAV = [
  { href: "/", label: "Início", icon: Home, perms: ["caixinha:view"] },
  { href: "/despesas", label: "Despesas", icon: Receipt, perms: ["orcamento:view"] },
  { href: "/cartoes", label: "Cartões", icon: CreditCard, perms: ["cartao:view"] },
  {
    href: "/pessoas",
    label: "Pessoas",
    icon: Users,
    perms: ["cartao:share", "cartao:view_shared", "share:manage", "share:view_shared"],
  },
  { href: "/admin", label: "Admin", icon: ShieldCheck, perms: ["user:view", "role:view"], grupo: "sistema" },
];

// A área de caixinhas é filha do Início: `/caixinhas/:id` mantém "Início" aceso.
function estaAtivo(href, pathname) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/caixinhas");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children, sidebarAberta = true }) {
  const fin = useFinance();
  const { can } = useAuth();
  const pathname = usePathname();
  const nav = NAV.filter((n) => n.perms.some((p) => can(p)));

  if (nav.length === 0) {
    return (
      <Centro>
        <p className="text-sm text-slate-400">
          Sua conta não tem permissão pra ver nenhuma área. Fale com um admin.
        </p>
      </Centro>
    );
  }

  if (fin.status === "loading") {
    return (
      <Centro>
        <div className="flex flex-col items-center gap-3 text-slate-400" role="status">
          <Marca className="h-9 w-9" />
          <p className="flex items-center gap-2 text-sm"><Spinner className="h-3.5 w-3.5" /> Carregando suas finanças…</p>
        </div>
      </Centro>
    );
  }

  if (fin.status === "error") {
    return (
      <Centro>
        <div className="max-w-sm space-y-3">
          <p className="font-semibold text-ink">Não consegui carregar seus dados.</p>
          <p className="text-[13px] text-slate-500">{fin.error}</p>
          <Button onClick={fin.refresh}>Tentar de novo</Button>
        </div>
      </Centro>
    );
  }

  const principal = nav.filter((n) => !n.grupo);
  const sistema = nav.filter((n) => n.grupo === "sistema");

  return (
    <SidebarProvider defaultOpen={sidebarAberta}>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-2 pb-2 pt-4">
          <CabecalhoDaBarra />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Principal">
                <SidebarMenu>
                  {principal.map((n) => (
                    <NavItem key={n.href} {...n} ativo={estaAtivo(n.href, pathname)} />
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>

          {sistema.length > 0 && (
            <SidebarGroup className="mt-auto">
              <SidebarGroupLabel>Sistema</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sistema.map((n) => (
                    <NavItem key={n.href} {...n} ativo={estaAtivo(n.href, pathname)} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <MenuDaConta lado="right">
                <SidebarMenuButton size="lg" className="gap-2.5 px-1.5" aria-label="Conta, tema e sair">
                  <IniciaisDoUsuario />
                  <NomeDoUsuario />
                  <ChevronsUpDown className="ml-auto !size-4 text-slate-500" />
                </SidebarMenuButton>
              </MenuDaConta>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* barra superior do celular */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg)] px-4 md:hidden">
          <Brand />
          <MenuDaConta lado="bottom">
            <button
              type="button"
              aria-label="Conta, tema e sair"
              className="relative grid size-9 cursor-pointer place-items-center rounded-full before:absolute before:-inset-1 before:content-['']"
            >
              <IniciaisDoUsuario />
            </button>
          </MenuDaConta>
        </header>

        <main id="conteudo" className="mx-auto w-full max-w-[76rem] px-4 pb-28 pt-6 sm:px-6 md:pb-14 lg:px-10 lg:pt-10">
          {children}
        </main>
      </div>

      {/* navegação inferior do celular */}
      <nav aria-label="Principal"
           className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--color-line)] bg-[var(--color-bg)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => (
          <NavItemCelular key={n.href} {...n} ativo={estaAtivo(n.href, pathname)} />
        ))}
      </nav>
    </SidebarProvider>
  );
}

function Centro({ children }) {
  return <div className="grid min-h-dvh place-items-center px-6 text-center">{children}</div>;
}

function Brand({ className = "" }) {
  return (
    <Link href="/" className={`flex min-w-0 items-center gap-2.5 rounded-lg ${className}`} aria-label="Wallet — início">
      <Marca className="h-7 w-7 shrink-0" />
      <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink group-data-[collapsible=icon]:hidden">Wallet</span>
    </Link>
  );
}

// Marca + botão de recolher. Recolhida, a barra tem 52px: só cabe um dos dois,
// então a marca cede lugar ao botão (o Início continua a um clique no trilho).
function CabecalhoDaBarra() {
  const { state } = useSidebar();
  if (state === "collapsed") {
    return (
      <div className="flex justify-center">
        <SidebarTrigger title="Expandir menu (Ctrl+B)" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 pl-2">
      <Brand />
      <SidebarTrigger title="Recolher menu (Ctrl+B)" />
    </div>
  );
}

function iniciais(nome = "") {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function IniciaisDoUsuario() {
  const { user } = useAuth();
  return (
    <Avatar className="size-8">
      <AvatarFallback className="bg-blue-500/15 text-xs font-semibold text-blue-300">
        {iniciais(user.nome || user.email)}
      </AvatarFallback>
    </Avatar>
  );
}

function NomeDoUsuario() {
  const { user } = useAuth();
  return (
    <span className="grid min-w-0 flex-1 text-left leading-tight">
      <span className="truncate text-[13px] font-medium text-ink">{user.nome || "Minha conta"}</span>
      <span className="truncate text-xs text-slate-500">{user.email}</span>
    </span>
  );
}

// Quem está logado + tema + sair. Fica separado da navegação: sair não é
// destino, e tema é preferência — os dois cabem num menu só em vez de dois
// ícones espremendo o nome no rodapé da barra.
function MenuDaConta({ children, lado }) {
  const { signOut } = useAuth();
  const [tema, trocaTema] = useTema();
  const claro = tema === "claro";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={lado} align="end" sideOffset={12} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
          <IniciaisDoUsuario />
          <NomeDoUsuario />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* `preventDefault` mantém o menu aberto: dá pra ver o tema virar e
            voltar sem reabrir. */}
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); trocaTema(); }}>
          {claro ? <Moon /> : <Sun />}
          {claro ? "Tema escuro" : "Tema claro"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut />
          Sair da conta
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Barra de progresso do próprio link. `useLinkStatus` só funciona DENTRO de um
// <Link>, então mora aqui: é o que responde ao clique enquanto o Next busca o
// segmento novo — sem isso a navegação parecia ignorada em rede lenta.
function ProgressoDoLink() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-blue-500/20">
      <span className="block h-full w-full origin-left bg-blue-500"
            style={{ animation: "rota-progresso 1.1s ease-out infinite" }} />
    </span>
  );
}

function NavItem({ href, label, icon: Icon, ativo }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={ativo} tooltip={label}>
        <Link href={href} prefetch aria-current={ativo ? "page" : undefined} className="relative">
          <Icon strokeWidth={1.75} className={ativo ? "text-ink" : "text-slate-500"} />
          <span>{label}</span>
          <ProgressoDoLink />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavItemCelular({ href, label, icon: Icon, ativo }) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={ativo ? "page" : undefined}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
        ativo ? "text-ink" : "text-slate-500"
      }`}
    >
      <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${ativo ? "bg-veu/[0.08]" : ""}`}>
        <Icon size={19} strokeWidth={ativo ? 2 : 1.75} />
      </span>
      {label}
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
        <h1 className="text-lg font-semibold text-ink">Área não liberada</h1>
        <p className="text-sm text-slate-400">Essa área não está liberada pra sua conta.</p>
        <Link href="/" className="text-sm font-medium text-blue-400 hover:text-blue-300">Voltar pro início</Link>
      </div>
    </div>
  );
}
