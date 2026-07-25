import { sign, verify } from "hono/jwt";
import { authRepository, type UserWithRoles } from "./auth.repository";
import { verifyPassword, hashPassword } from "./password";
import { hasPermission } from "./permissions";
import { planEntitlements } from "./entitlements";
import { AppError } from "@/server/lib/errors";

export const AUTH_COOKIE = "auth_token";
export const TOKEN_TTL_S = 60 * 60 * 24 * 7; // 7 dias

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET não configurado");
    }
    return "dev-secret-inseguro";
  }
  return s;
}

// Usuário autenticado como o resto do app enxerga: roles por nome (informativo)
// e permissions granulares (fonte de autorização).
export type AuthUser = {
  id: string;
  email: string;
  nome: string;
  roles: string[];
  permissions: string[];
};

export function toAuthUser(u: UserWithRoles): AuthUser {
  const roles = u.roles.map((ur) => ur.role);
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    roles: roles.map((r) => r.nome),
    permissions: [...new Set(roles.flatMap((r) => r.permissions))],
  };
}

export const authService = {
  // Login por email/senha → AuthUser (rota assina o JWT e seta o cookie).
  async login(email: string, senha: string): Promise<AuthUser> {
    const user = await authRepository.findByEmail(email.toLowerCase().trim());
    // mensagem única — não vaza se o email existe
    if (!user || !user.ativo || !verifyPassword(senha, user.senhaHash)) {
      throw new AppError("Email ou senha inválidos", 401);
    }
    return toAuthUser(user);
  },

  // Auto-cadastro pela tela de login: cria usuário com a role padrão "membro".
  // Contatos com o mesmo email são vinculados lazy no 1º /me/compartilhamentos.
  async register(nome: string, email: string, senha: string): Promise<AuthUser> {
    const em = email.toLowerCase().trim();
    if (await authRepository.findByEmail(em)) throw new AppError("Email já cadastrado", 409);
    const role = await authRepository.findRoleByName("membro");
    if (!role) throw new AppError("Role padrão 'membro' não configurada", 500);
    const user = await authRepository.create({
      email: em,
      nome: nome.trim(),
      senhaHash: hashPassword(senha),
      roleIds: [role.id],
    });
    return toAuthUser(user);
  },

  // Resolve o usuário da sessão (roles/permissions sempre frescos do banco —
  // trocar role de alguém vale na request seguinte, sem esperar o JWT expirar).
  async getSessionUser(userId: string): Promise<AuthUser | null> {
    const user = await authRepository.findById(userId);
    if (!user || !user.ativo) return null;
    return toAuthUser(user);
  },

  // PBAC: permission das roles ∩ entitlement do plano (billing futuro).
  async can(user: AuthUser, required: string): Promise<boolean> {
    if (!hasPermission(user.permissions, required)) return false;
    return hasPermission(await planEntitlements(user.id), required);
  },

  async signToken(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return sign({ sub: userId, iat: now, exp: now + TOKEN_TTL_S }, authSecret());
  },

  async verifyToken(token: string): Promise<string | null> {
    try {
      const payload = await verify(token, authSecret(), "HS256");
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  },
};
