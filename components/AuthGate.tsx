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

// Gate de sessão: resolve /auth/me antes de montar o app. Sem sessão → form
// de login. Com sessão → provê { user, can } pro app inteiro.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    me()
      .then((u) => {
        setUser(u);
        setStatus(u ? "authed" : "anon");
      })
      .catch(() => setStatus("anon"));
  }, []);

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
      {/* Sem `lg:` nenhum: em mobile o topbar do App só tem a marca à esquerda,
          então o botão cai no canto livre. Escondê-lo abaixo de lg deixava a
          conta sem saída no celular. */}
      <button
        title={`Sair (${user.email})`}
        aria-label="Sair"
        onClick={signOut}
        className="fixed right-4 top-4 z-40 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/80 p-2 text-slate-500 backdrop-blur transition-colors hover:text-slate-200"
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

  const inputCls =
    "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-blue-500/50";

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
          <input
            type="text"
            required
            autoFocus
            placeholder="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputCls}
          />
        )}
        <input
          type="email"
          required
          autoFocus={!registering}
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
        <input
          type="password"
          required
          placeholder={registering ? "senha (mín. 6)" : "senha"}
          minLength={registering ? 6 : undefined}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={inputCls}
        />

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
