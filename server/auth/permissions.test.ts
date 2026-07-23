import { describe, expect, it } from "bun:test";
import { hasPermission, permissionMatches } from "./permissions";

describe("permissionMatches", () => {
  it("match exato", () => {
    expect(permissionMatches("caixinha:view", "caixinha:view")).toBe(true);
    expect(permissionMatches("caixinha:view", "caixinha:manage")).toBe(false);
  });

  it("wildcard de recurso cobre ações e sub-segmentos", () => {
    expect(permissionMatches("caixinha:*", "caixinha:view")).toBe(true);
    expect(permissionMatches("llm:*", "llm:history:clear")).toBe(true);
    expect(permissionMatches("llm:*", "caixinha:view")).toBe(false);
  });

  it("wildcard global cobre tudo", () => {
    expect(permissionMatches("*", "qualquer:coisa:aqui")).toBe(true);
  });

  it("permission mais curta não cobre mais específica sem wildcard", () => {
    expect(permissionMatches("llm:history", "llm:history:view")).toBe(false);
  });

  it("permission mais específica não cobre a mais curta", () => {
    expect(permissionMatches("llm:history:view", "llm:history")).toBe(false);
  });
});

describe("hasPermission — mapeamento RBAC→PBAC de exemplo (llm)", () => {
  const colaborador = ["llm:chat", "llm:history:view"];
  const gerenteTi = ["llm:chat", "llm:history:view", "llm:history:clear", "llm:admin:view_costs"];
  const cientistaDados = ["llm:*"];

  it("colaborador", () => {
    expect(hasPermission(colaborador, "llm:chat")).toBe(true);
    expect(hasPermission(colaborador, "llm:history:clear")).toBe(false);
    expect(hasPermission(colaborador, "llm:admin:view_costs")).toBe(false);
  });

  it("gerente_ti", () => {
    expect(hasPermission(gerenteTi, "llm:history:clear")).toBe(true);
    expect(hasPermission(gerenteTi, "llm:admin:view_costs")).toBe(true);
  });

  it("cientista_dados via wildcard", () => {
    expect(hasPermission(cientistaDados, "llm:chat")).toBe(true);
    expect(hasPermission(cientistaDados, "llm:admin:view_costs")).toBe(true);
    expect(hasPermission(cientistaDados, "caixinha:view")).toBe(false);
  });

  it("multi-role: união de permissions", () => {
    const perms = [...colaborador, ...["caixinha:view"]];
    expect(hasPermission(perms, "caixinha:view")).toBe(true);
    expect(hasPermission(perms, "llm:chat")).toBe(true);
  });
});
