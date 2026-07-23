// ── Seam do futuro módulo de cobrança (SaaS) ────────────────────────────────
// Autorização efetiva = permissions das roles ∩ entitlements do plano.
// Hoje não existe billing: todo usuário tem entitlement total ("*").
//
// Quando o módulo de cobrança existir, este arquivo passa a resolver o plano
// do usuário (Plan/Subscription no schema) e devolver as permissions que o
// plano contratado libera — ex.: plano free sem "llm:admin:view_costs".
// Nada mais no código de auth precisa mudar: authService.can() já compõe
// roles + entitlements.

export async function planEntitlements(_userId: string): Promise<string[]> {
  return ["*"];
}
