// ── PBAC: catálogo e matcher de permissions ─────────────────────────────────
// Permission = "recurso:acao" (segmentos separados por ":"). Roles agrupam
// permissions (RBAC como conveniência de atribuição), mas TODA checagem de
// autorização é por permission — nunca por nome de role.
//
// Wildcards: um segmento "*" casa o restante da permission.
//   "caixinha:*" cobre "caixinha:view" e "caixinha:manage"
//   "*"          cobre tudo
// Novos módulos só adicionam strings aqui (ex.: futuro "llm:chat",
// "llm:history:view", "llm:admin:view_costs" — mesmo esquema).

export const PERMISSIONS = [
  "state:view",
  "caixinha:view",
  "caixinha:manage",
  "movimentacao:view",
  "movimentacao:manage",
  "cartao:view",
  "cartao:manage",
  "cartao:share",
  "cartao:view_shared",
  "categoria:view",
  "categoria:manage",
  "espaco:view",
  "espaco:manage",
  "orcamento:view",
  "orcamento:manage",
  "user:view",
  "user:manage",
  "role:view",
  "role:manage",
  "dev:reset",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// String aceitável num cadastro de role: permission do catálogo, wildcard de
// recurso ("caixinha:*") ou global ("*").
export function isAssignablePermission(p: string): boolean {
  if (p === "*") return true;
  if (/^[a-z_]+(:[a-z_*]+)+$/.test(p) === false) return false;
  if (p.endsWith(":*")) {
    const prefix = p.slice(0, -1); // "caixinha:"
    return PERMISSIONS.some((known) => known.startsWith(prefix));
  }
  return (PERMISSIONS as readonly string[]).includes(p);
}

// granted "a:*" casa required "a:b:c"; granted "a:b" NÃO casa "a:b:c".
export function permissionMatches(granted: string, required: string): boolean {
  const g = granted.split(":");
  const r = required.split(":");
  for (let i = 0; i < g.length; i++) {
    if (g[i] === "*") return true;
    if (g[i] !== r[i]) return false;
  }
  return g.length === r.length;
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.some((g) => permissionMatches(g, required));
}
