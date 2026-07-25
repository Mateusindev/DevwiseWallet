import { describe, expect, it } from "bun:test";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("gera no formato scrypt:<salt hex>:<hash hex>", () => {
    const [scheme, salt, hash] = hashPassword("segredo123").split(":");
    expect(scheme).toBe("scrypt");
    expect(salt).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(hash).toMatch(/^[0-9a-f]{128}$/); // KEYLEN 64 bytes
  });

  it("salt aleatório → mesma senha gera hashes diferentes", () => {
    expect(hashPassword("segredo123")).not.toBe(hashPassword("segredo123"));
  });
});

describe("verifyPassword", () => {
  it("aceita a senha correta", () => {
    expect(verifyPassword("segredo123", hashPassword("segredo123"))).toBe(true);
  });

  it("rejeita senha errada, incluindo variação de caixa e senha vazia", () => {
    const stored = hashPassword("segredo123");
    expect(verifyPassword("segredo124", stored)).toBe(false);
    expect(verifyPassword("SEGREDO123", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("senha vazia é hashável e verificável (regra de tamanho é do DTO)", () => {
    expect(verifyPassword("", hashPassword(""))).toBe(true);
  });

  it("rejeita stored malformado em vez de estourar", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "texto-puro")).toBe(false);
    expect(verifyPassword("x", "bcrypt:aa:bb")).toBe(false); // scheme desconhecido
    expect(verifyPassword("x", "scrypt::bb")).toBe(false); // sem salt
    expect(verifyPassword("x", "scrypt:aa:")).toBe(false); // sem hash
  });

  it("não confunde senhas com o mesmo prefixo", () => {
    const stored = hashPassword("senha");
    expect(verifyPassword("senha ", stored)).toBe(false);
    expect(verifyPassword("senh", stored)).toBe(false);
  });
});
