import { describe, expect, it } from "bun:test";
import { planEntitlements } from "./entitlements";
import { hasPermission } from "./permissions";

// Seam do billing futuro. Enquanto não existe plano, o contrato é: todo usuário
// tem entitlement total. Se este teste quebrar, authService.can() mudou de
// comportamento pra TODO mundo — é intencional? (ver server/auth/entitlements.ts)
describe("planEntitlements", () => {
  it("hoje libera tudo (sem módulo de cobrança)", async () => {
    expect(await planEntitlements("u-1")).toEqual(["*"]);
  });

  it("não depende do usuário", async () => {
    expect(await planEntitlements("u-1")).toEqual(await planEntitlements("u-2"));
  });

  it('o "*" devolvido satisfaz qualquer permission do catálogo', async () => {
    const ents = await planEntitlements("u-1");
    expect(hasPermission(ents, "caixinha:manage")).toBe(true);
    expect(hasPermission(ents, "admin:users:manage")).toBe(true);
  });
});
