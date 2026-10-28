"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

// primitives são .jsx sem tipos — TS inferiria todas as props como obrigatórias
import * as P from "./ui/primitives.jsx";
const { Field, TextInput, Button } =
  P as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import { FormError } from "./ui/fields.jsx";
import { Marca } from "./ui/marca.jsx";
import { hasPermission } from "@/server/auth/permissions";
import { login, logout, me, register, type AuthUser } from "@/services/financeApi";
import { BotaoTema } from "./ui/tema.jsx";

type Status = "checking" | "anon" | "authed";

type AuthContextValue = {
  user: AuthUser;
  // PBAC no front: esconder UI que o back negaria (back continua sendo a autoridade)
  can: (permission: string) => boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthGate");
  return ctx;
}

// Gate de sessão. Sem sessão → form de login. Com sessão → provê { user, can }
// pro app inteiro.
//
// `usuarioInicial` vem resolvido do servidor (app/page.tsx): quando ele chega,
// não há `me()` nenhum no caminho crítico. `undefined` = ninguém resolveu ainda
// (o gate usado fora do boot servido), e aí o fetch no efeito continua valendo.
export default function AuthGate({
  children,
  usuarioInicial,
}: {
  children: ReactNode;
  usuarioInicial?: AuthUser | null;
}) {
  const resolvidoNoServidor = usuarioInicial !== undefined;
  const [status, setStatus] = useState<Status>(
    !resolvidoNoServidor ? "checking" : usuarioInicial ? "authed" : "anon"
  );
  const [user, setUser] = useState<AuthUser | null>(usuarioInicial ?? null);

  useEffect(() => {
    if (resolvidoNoServidor) return;
    me()
      .then((u) => {
        setUser(u);
        setStatus(u ? "authed" : "anon");
      })
      .catch(() => setStatus("anon"));
  }, [resolvidoNoServidor]);

  const can = useCallback(
    (permission: string) => (user ? hasPermission(user.permissions, permission) : false),
    [user]
  );

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    setStatus("anon");
  }, []);

  if (status === "checking") {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-slate-500" role="status">
        Verificando sessão…
      </div>
    );
  }

  if (status === "anon" || !user) {
    return (
      <LoginForm
        onLogged={(u) => {
          setUser(u);
          setStatus("authed");
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, can, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function LoginForm({ onLogged }: { onLogged: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogged(registering ? await register(nome, email, senha) : await login(email, senha));
    } catch (err) {
      setError(err instanceof Error ? err.message : registering ? "Falha no cadastro" : "Falha no login");
      setBusy(false);
    }
  }

  function toggle() {
    setMode(registering ? "login" : "register");
    setError(null);
  }

  // Sair agora mora na casca (rodapé da barra lateral / barra do celular).
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] px-5 py-5 sm:px-8">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <Marca className="h-7 w-7" />
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Wallet</span>
        </span>
        <BotaoTema />
      </div>

      <main className="grid place-items-center py-10">
        <div className="w-full max-w-[24rem]">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink">
            {registering ? "Criar sua conta" : "Entrar"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {registering
              ? "Caixinhas, despesas do mês e faturas de cartão num lugar só."
              : "Suas caixinhas, despesas e cartões estão te esperando."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 sm:p-6" noValidate={false}>
            {registering && (
              <Field label="Nome" required>
                <TextInput type="text" required autoFocus placeholder="Como te chamamos" autoComplete="name"
                           value={nome} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)} />
              </Field>
            )}
            <Field label="Email" required>
              <TextInput type="email" required autoFocus={!registering} placeholder="voce@email.com" autoComplete="email"
                         value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
            </Field>
            <Field label="Senha" required hint={registering ? "Mínimo de 6 caracteres." : ""}>
              <TextInput type="password" required minLength={registering ? 6 : undefined}
                         autoComplete={registering ? "new-password" : "current-password"}
                         placeholder="••••••" value={senha} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)} />
            </Field>

            <FormError>{error}</FormError>

            <Button type="submit" size="lg" loading={busy} className="w-full">
              {busy ? (registering ? "Criando conta…" : "Entrando…") : registering ? "Criar conta" : "Entrar"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {registering ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
            <button type="button" onClick={toggle}
                    className="cursor-pointer font-medium text-ink underline-offset-4 hover:underline">
              {registering ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </div>
      </main>
      <span />
    </div>
  );
}
