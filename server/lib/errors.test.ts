import { describe, expect, it } from "bun:test";
import { AppError, NotFoundError } from "./errors";

describe("AppError", () => {
  it("default é 400 e o name identifica a classe (o onError depende disso)", () => {
    const e = new AppError("deu ruim");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("deu ruim");
    expect(e.statusCode).toBe(400);
    expect(e.name).toBe("AppError");
  });

  it("aceita statusCode customizado", () => {
    expect(new AppError("sem sessão", 401).statusCode).toBe(401);
    expect(new AppError("sem permissão", 403).statusCode).toBe(403);
    expect(new AppError("conflito", 409).statusCode).toBe(409);
  });
});

describe("NotFoundError", () => {
  it("é sempre 404 e continua sendo AppError (o onError só checa AppError)", () => {
    const e = new NotFoundError("Caixinha não encontrada: cx-1");
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(404);
    expect(e.name).toBe("NotFoundError");
    expect(e.message).toBe("Caixinha não encontrada: cx-1");
  });
});
