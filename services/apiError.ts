// Erro de API com o que o back mandou: `status` e, no 422, os `issues` do zod
// (é o que deixa o form marcar o campo culpado em vez de só mostrar
// "Validação falhou"). Continua sendo um Error — `catch (e) { e.message }` segue
// funcionando.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: unknown[]
  ) {
    super(message);
    this.name = "ApiError";
  }
}
