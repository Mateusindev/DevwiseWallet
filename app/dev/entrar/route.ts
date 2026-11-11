// Bypass de login — SÓ no `bun dev`, SÓ acessado por localhost.
//
//   http://localhost:3000/dev/entrar                      → conta de teste (teste@wallet.local)
//   http://localhost:3000/dev/entrar?email=x@y&next=/despesas
//
// Abre a sessão com o MESMO cookie/JWT do login real (`authService.signToken`),
// então o resto da app não sabe que houve bypass. Fora de `development`, ou com
// `DEV_LOGIN_BYPASS=0`, ou por host que não seja loopback, responde 404 — não
// vaza nem que a rota existe. Conta de teste: `bun run seed:test`.
import { NextResponse, type NextRequest } from "next/server";
import { authService, AUTH_COOKIE, TOKEN_TTL_S, toAuthUser } from "@/server/auth/auth.service";
import { authRepository } from "@/server/auth/auth.repository";

const EMAIL_PADRAO = "teste@wallet.local";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function liberado(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.DEV_LOGIN_BYPASS === "0") return false;
  // `nextUrl.hostname` vem normalizado pra localhost no dev — vale o header cru.
  // (o próprio Next preenche x-forwarded-host com o host, então ele não serve.)
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  return LOOPBACK.has(host);
}

// Só caminho interno: `//evil.com` seria redirect aberto.
function destino(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function GET(req: NextRequest) {
  if (!liberado(req)) return new NextResponse(null, { status: 404 });

  const email = (req.nextUrl.searchParams.get("email") ?? EMAIL_PADRAO).toLowerCase().trim();
  const user = await authRepository.findByEmail(email);
  if (!user) {
    return NextResponse.json(
      { error: `Usuário ${email} não existe. Rode: bun run seed:test` },
      { status: 404 },
    );
  }
  if (!user.ativo) return NextResponse.json({ error: "Usuário inativo" }, { status: 403 });

  const token = await authService.signToken(toAuthUser(user).id);
  const res = NextResponse.redirect(new URL(destino(req.nextUrl.searchParams.get("next")), req.url));
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false, // só roda em dev (http://localhost)
    maxAge: TOKEN_TTL_S,
  });
  return res;
}
