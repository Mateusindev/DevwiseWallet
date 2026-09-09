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
import { LogOut, PiggyBank } from "lucide-react";
// primitives são .jsx sem tipos — TS inferiria todas as props como obrigatórias
import * as P from "./ui/primitives.jsx";
const { Field, TextInput } =
  P as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import { hasPermission } from "@/server/auth/permissions";
import { login, logout, me, register, type AuthUser } from "@/services/financeApi";

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
    return <div className="grid min-h-dvh place-items-center text-slate-500 text-sm">Verificando sessão…</div>;
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
      <button
        title={`Sair (${user.email})`}
        onClick={signOut}
        className="fixed right-4 top-4 z-40 hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/80 p-2 text-slate-500 backdrop-blur transition-colors hover:text-slate-200 lg:block"
      >
        <LogOut size={16} />
      </button>
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

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white shadow-lg shadow-blue-500/20">
            <PiggyBank size={19} />
          </span>
          <div className="leading-tight">
            <p className="font-bold text-white">Wallet</p>
            <p className="text-[11px] text-slate-500">
              {registering ? "crie sua conta" : "entre pra continuar"}
            </p>
          </div>
        </div>

        {registering && (
          <Field label="Nome" required>
            <TextInput type="text" required autoFocus placeholder="como te chamamos"
                       value={nome} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)} />
          </Field>
        )}
        <Field label="Email" required>
          <TextInput type="email" required autoFocus={!registering} placeholder="voce@email.com"
                     value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" required hint={registering ? "mínimo 6 caracteres" : ""}>
          <TextInput type="password" required minLength={registering ? 6 : undefined}
                     placeholder="••••••" value={senha} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)} />
        </Field>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:opacity-50"
        >
          {busy ? (registering ? "Criando…" : "Entrando…") : registering ? "Criar conta" : "Entrar"}
        </button>

        <button
          type="button"
          onClick={toggle}
          className="w-full text-center text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          {registering ? "Já tenho conta · entrar" : "Não tem conta? Criar conta"}
        </button>
      </form>
    </div>
  );
}
