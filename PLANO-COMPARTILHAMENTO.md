# Plano — Compartilhamento N-a-N, agenda com aceite e adoção de dívida

Escopo pedido: (1) transformar o que devo em despesa/despesa fixa, respeitando parcelas até o fim,
com adiantamento e opção de ignorar; (2) agenda de contatos formada por aceite ("compartilhei, a
pessoa aceitou, virou meu contato"); (3) compartilhar despesa fixa, não só cartão (ex.: aluguel);
(4) compartilhar com N pessoas, não uma só

---

## 0. Ponto de partida (o que o código já faz)

| Peça | Hoje |
|---|---|
| `CartaoShare` | `cartaoId` **obrigatório**, um `contatoId`, `tipo` `linha`\|`valor`. Aponta `despesaFixaId` XOR `despesaMesId`, ou é valor avulso (`mesRef` null = recorrente) |
| Efeito no orçamento | **Nenhum**. Camada informativa: não muda a fatura do dono nem cria nada na conta de quem deve |
| `Contato` | `ownerId` + `userId` (vínculo *lazy* por email no 1º `GET /me/compartilhamentos`), `@@unique([ownerId, userId])`. Uma via: o dono cadastra, o outro nem sabe |
| Visão do devedor | `GET /me/compartilhamentos` → agrupado **por cartão**, só leitura |
| Cálculo | `cartao-share.service.ts`: `shareValorNoMes`, `shareParcela`, `shareComprometido` (parcelas restantes × parte) |
| Permissions | `cartao:share` (dono), `cartao:view_shared` (devedor) |

Três limitações estruturais a derrubar: `cartao_id` NOT NULL impede compartilhar aluguel; não há
consentimento; e o devedor não consegue puxar a dívida pro próprio orçamento.

O rateio N-a-N, porém, **já cabe no schema atual**: N linhas de `cartao_shares` apontando a mesma
`despesa_fixa_id` com `contato_id` diferente. O que falta é validação de soma, view de rateio e UI.

---

## 1. Modelo de dados

Todas as mudanças são **aditivas** (colunas nullable / com default, tabelas e enums novos, e um
`DROP NOT NULL`). Nenhum `DROP COLUMN`, nenhum `DROP TABLE` — mesmo procedimento já usado no
Supabase: gerar com `prisma migrate diff`, revisar o SQL, aplicar com `prisma db execute`.

### 1.1 Share deixa de ser "do cartão"

```prisma
model CartaoShare {
  cartaoId String? @map("cartao_id") @db.Uuid   // era obrigatório
  // ...resto igual
  @@unique([despesaFixaId, contatoId], map: "share_fixa_contato_key")
  @@unique([despesaMesId,  contatoId], map: "share_mes_contato_key")
}
```

- O cartão passa a ser **derivado da linha** (`despesaFixa.cartaoId` / `despesaMes.cartaoId`) e só
  fica preenchido direto quando o share é `tipo: "valor"` amarrado a um cartão.
- Aluguel (fixa sem `cartaoId`) vira compartilhável sem nenhum caso especial.
- Os dois uniques impedem o mesmo contato entrar duas vezes na mesma linha (hoje dá, e o rateio
  fica errado sem ninguém perceber).
- O nome da tabela (`cartao_shares`) e do model ficam como estão. Renomear custa migration
  destrutiva e não paga — igual à decisão de não renomear `ReceitaMes.mes` quando virou âncora.

### 1.2 Rateio com efeito no orçamento do dono

```prisma
model DespesaFixa { abateShares Boolean @default(false) @map("abate_shares") }
model DespesaMes  { abateShares Boolean @default(false) @map("abate_shares") }
```

`false` mantém o comportamento atual (informativo). `true` faz o orçamento do dono contar só a
parte dele: aluguel 1800 dividido com 2 pessoas a 1/3 → o dono vê 600. Decisão por linha, não
global, porque as duas semânticas são legítimas (fatura do cartão continua cheia; aluguel não).

### 1.3 Agenda com aceite

```prisma
enum ContatoStatus {
  local      // só um nome na agenda, sem conta atrelada
  convidado  // convite enviado, aguardando resposta
  ativo      // aceitou — vínculo mútuo
  recusado   // recusou; shares ficam invisíveis pra ele
  @@map("contato_status")
}

model Contato {
  status       ContatoStatus @default(local)
  convidadoEm  DateTime?     @map("convidado_em") @db.Timestamptz(6)
  respondidoEm DateTime?     @map("respondido_em") @db.Timestamptz(6)
  espelhoDeId  String?       @map("espelho_de_id") @db.Uuid // contato recíproco criado no aceite
}

model Convite {
  id        String        @id @default(uuid()) @db.Uuid
  ownerId   String        @map("owner_id") @db.Uuid
  contatoId String        @map("contato_id") @db.Uuid
  email     String
  token     String        @unique
  status    ContatoStatus @default(convidado)
  expiraEm  DateTime      @map("expira_em") @db.Timestamptz(6)
  createdAt DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)

  owner   User    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  contato Contato @relation(fields: [contatoId], references: [id], onDelete: Cascade)

  @@index([email])
  @@map("convites")
}
```

Fluxo: dono cadastra contato → `POST /contatos/:id/convite` gera token e marca `convidado` → quem
tem conta com aquele email vê em `GET /me/convites` → aceita → o serviço, numa transação:

1. `contato.userId = aceitante.id`, `status = ativo`, `respondidoEm = now()`;
2. cria o **espelho** na agenda do aceitante (`ownerId = aceitante`, `userId = dono`, `status = ativo`),
   amarrando os dois por `espelhoDeId` — é isso que faz "virou meu contato" valer dos dois lados;
3. os shares daquele contato passam a aparecer no "O que devo".

Recusar marca `recusado` e some da visão do devedor sem apagar nada do dono.

O vínculo *lazy* por email (`resolveContatos`) fica **só como fallback de contas pré-existentes** e
passa a criar contato em `status: convidado`, não mais em acesso liberado. Isso muda o
comportamento atual (hoje a Maria vê a dívida sem ter consentido) — é a intenção do pedido.

### 1.4 Adoção: virar despesa na conta de quem deve

```prisma
enum ShareAdocaoModo { fixa mes ignorado @@map("share_adocao_modo") }

model ShareAdocao {
  shareId       String          @id @map("share_id") @db.Uuid
  userId        String          @map("user_id") @db.Uuid
  modo          ShareAdocaoModo
  espacoId      String?         @map("espaco_id") @db.Uuid
  despesaFixaId String?         @map("despesa_fixa_id") @db.Uuid
  despesaMesId  String?         @map("despesa_mes_id") @db.Uuid
  valorAdotado  Decimal?        @map("valor_adotado") @db.Decimal(12, 2)
  quitadoAte    String?         @map("quitado_ate") @db.Char(7) // adiantamento cobre até este mês
  createdAt     DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([userId])
  @@map("share_adocoes")
}
```

PK no `shareId`: uma adoção por share (o share já tem exatamente um devedor).

| Modo | O que cria | Vida |
|---|---|---|
| `fixa` | `DespesaFixa` no espaço escolhido, com `parcelado`/`parcelaAtual`/`totalParcelas`/`parcelaMesRef` **espelhados da linha original** | Morre sozinha no fim das parcelas — `parcelaAtivaNoMes` já faz isso hoje, sem código novo |
| `mes` | `DespesaMes` só no mês corrente | Pontual, não repete |
| `ignorado` | nada | Some do "O que devo", vai pra seção "Ignorados", reversível |

Descrição gerada: `"Nubank · Jiu-jitsu (João)"` — cartão/linha + dono, pra não virar "Despesa 3" na
lista do devedor. Categoria: `sugereCategoria` de `lib/calc.js` a partir da descrição.

**Sincronia dono → devedor.** Se o dono mexer no percentual, a fixa adotada fica desatualizada.
Nada de escrita mágica: `valorAdotado` guarda o valor no momento da adoção, a view compara com a
parte atual e, divergindo, mostra "valor mudou pra R$ X — atualizar". Um clique reescreve. Mesma
regra se o dono apagar o share: a fixa adotada **não** é apagada (é despesa real do devedor), só
ganha aviso "compartilhamento removido pelo dono" e a opção de excluir.

### 1.5 Adiantamento

```prisma
model ShareAdiantamento {
  id        String   @id @default(uuid()) @db.Uuid
  shareId   String   @map("share_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  valor     Decimal  @db.Decimal(12, 2)
  ym        String   @db.Char(7)  // mês em que o adiantamento foi feito
  cobreAte  String   @map("cobre_ate") @db.Char(7)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([shareId])
  @@map("share_adiantamentos")
}
```

Adiantar N parcelas grava o registro e move `ShareAdocao.quitadoAte`. Efeitos:

- `devidoMes` = 0 nos meses cobertos;
- `comprometido` desconta as parcelas adiantadas;
- se adotado como `fixa`, gera `PagamentoFixa` nos meses cobertos (o app já sabe pintar fixa paga
  por mês) e, se cobriu tudo, `ativa = false`;
- do lado do dono, o adiantamento aparece como informação no card do share — **não** mexe na fatura
  dele, coerente com a regra de que share é informativo pra quem recebe.

---

## 2. Regras de cálculo (server, puras e testáveis)

Ficam em `cartao-share.service.ts`, ao lado das que já existem:

```
parteDoContato(share, mes)      → já existe (shareValorNoMes)
rateioDaLinha(linha, shares)    → [{ contatoId, nome, valor, pct, status }], sobra do dono, soma
valorEfetivoDono(linha, shares) → abateShares ? valor - soma(partes ativas) : valor
devidoMes(user, mes)            → shares de contatos ativos, menos ignorados, menos meses ≤ quitadoAte
comprometido(share, mes)        → restantes × parte, menos parcelas já adiantadas
divergente(adocao, share, mes)  → valorAdotado != parte atual
```

Invariantes validadas na escrita (422 via `zValidator`/`AppError`):

- soma dos percentuais de uma linha ≤ 100;
- soma dos valores fixos de uma linha ≤ valor da linha;
- não misturar percentual e valor no mesmo share (já vale hoje);
- share `linha` exige exatamente uma de `despesaFixaId`/`despesaMesId` (já vale hoje);
- todo id que vem no payload é carregado filtrando por dono antes de qualquer escrita — regra que
  o repo já segue (`assertVinculos`, `despesaFixaExists`), e que aqui vale também pro `espacoId` da
  adoção, que é do **devedor**, não do dono.

---

## 3. API

Permissions novas no catálogo (`server/auth/permissions.ts`, senão role com elas falha validação):
`share:manage`, `share:view_shared`, `share:adotar`, `contato:manage`. As atuais `cartao:share` e
`cartao:view_shared` continuam existindo como alias durante a transição.

| Método | Rota | Permission | O quê |
|---|---|---|---|
| POST | `/shares` | `share:manage` | Cria share apontando `despesaFixaId` \| `despesaMesId` \| `cartaoId`+valor. Substitui `POST /cartoes/:id/shares` (que fica como atalho) |
| POST | `/shares/bulk` | `share:manage` | Rateia uma linha entre N contatos numa transação — valida a soma uma vez só |
| GET | `/despesas/espacos/:esp/fixas/:id/rateio` | `orcamento:view` | Rateio da fixa: quem, quanto, status do aceite |
| POST | `/contatos/:id/convite` | `contato:manage` | Gera token, marca `convidado` |
| GET | `/me/convites` | `share:view_shared` | Convites pendentes pro email logado |
| POST | `/me/convites/:id/aceitar` | `share:view_shared` | Aceita: vincula, cria espelho, libera shares |
| POST | `/me/convites/:id/recusar` | `share:view_shared` | Recusa |
| GET | `/me/compartilhamentos` | `share:view_shared` | Passa a agrupar por **dono**, com subgrupos cartão / fixas / avulsos; cada linha traz `adocao` e `divergente` |
| POST | `/me/compartilhamentos/:shareId/adotar` | `share:adotar` | `{ modo: "fixa"\|"mes", espacoId }` |
| POST | `/me/compartilhamentos/:shareId/ignorar` | `share:adotar` | Modo `ignorado` |
| DELETE | `/me/compartilhamentos/:shareId/adocao` | `share:adotar` | Desfaz adoção (a despesa criada é mantida ou removida, à escolha) |
| POST | `/me/compartilhamentos/:shareId/adiantar` | `share:adotar` | `{ parcelas }` ou `{ cobreAte }` |
| POST | `/me/compartilhamentos/:shareId/sincronizar` | `share:adotar` | Reescreve a despesa adotada com o valor atual |

Tudo encadeado numa expressão só (`.post().get()...`), senão o `AppType` não captura e o client RPC
não enxerga a rota.

---

## 4. Front

- **`CompartilharModal`** (`components/Compartilhamento.jsx`): passa a aceitar N contatos por linha,
  com barra de rateio mostrando soma e sobra do dono em tempo real, e checkbox
  "abater da minha despesa" (`abateShares`). Bloqueia salvar se a soma passar de 100%.
- **`MeusCompartilhamentos`**: cada linha ganha menu — *Virar despesa fixa* · *Lançar neste mês* ·
  *Ignorar* · *Adiantar parcelas*. Linha adotada mostra selo "no seu orçamento" e, quando o dono
  mudou o valor, o aviso de divergência com botão sincronizar. Agrupamento por dono, subtítulo por
  cartão/espaço. Já está montado em Início, Despesas e Cartões.
- **Convites**: banner no topo quando há pendência + tela em Contatos com aceitar/recusar.
- **Contatos**: agenda com status (`local`/`convidado`/`ativo`/`recusado`), botão convidar, e a
  indicação de reciprocidade quando o espelho existe.
- **Rateio na linha de despesa** (`DespesasFixas.jsx`): avatares/iniciais dos contatos na linha
  compartilhada, com o valor efetivo do dono quando `abateShares`.
- Controles sempre via `components/ui/fields.jsx` (`NumberInput` nunca emite string — é o que evita
  422 com `""` virando 0 no `z.coerce`), e `Select` dentro de `Modal` exige `Select.Portal` + `z-[70]`.

---

## 5. Migração

```bash
bunx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma \
  --script > migrate.sql          # revisar: só ADD COLUMN / CREATE TABLE / CREATE TYPE / DROP NOT NULL
bunx prisma db execute --schema prisma/schema.prisma --file migrate.sql
bun run prisma:generate           # pare o dev server antes: ele segura query_engine-windows.dll.node
```

Nunca `prisma db push --accept-data-loss` contra o Supabase — tem usuário real lá. Os dois uniques
novos (`share_fixa_contato_key`, `share_mes_contato_key`) podem falhar se já existir contato
duplicado na mesma linha; o script de migração deve rodar antes um `SELECT` de checagem e resolver
manualmente se aparecer.

---

## 6. Testes

**Unit** (`bun run test:unit` — um processo por arquivo, repositories mockados):

- rateio: soma no limite, acima do limite, percentual + valor fixo misturados na mesma linha;
- `devidoMes` com share ignorado, com adiantamento cobrindo o mês, com contato `recusado`;
- adoção `fixa` espelhando parcelas: mês da última parcela ainda conta, o seguinte não;
- divergência: dono muda percentual → `divergente = true`.

**Integração** (`tests/integration/*.test.ts`, banco real + `app.request()`):

- fluxo completo João → convite → Maria aceita → espelho criado nas duas agendas;
- Maria adota como fixa → a fixa aparece em `GET /api/state` dela e **não** no espaço do João;
- share de fixa **sem cartão** (aluguel) rateado entre Maria e Carlos, soma 66%, sobra 34% pro dono;
- isolamento: Carlos não enxerga nem adota share da Maria (404, não 403);
- adiantar 3 parcelas → `devidoMes` zera nos 3 meses e `comprometido` cai.

---

## 7. Contas de teste

Já criadas no banco apontado pelo `.env` (Supabase), dados ancorados no **mês corrente**:

| Conta | Senha | Roles | Papel no teste |
|---|---|---|---|
| `joao@wallet.local` | `senha123` | `membro` | Dono. Cartões Nubank (fatura R$ 240) e Inter (R$ 250); espaços Nosso/Meu; fixas Aluguel, Condomínio, Energia + água, Internet, Streaming, Jiu-jitsu 3/12 |
| `maria@exemplo.com` | `maria123` | `membro`, `leitor` | Devedora. Sem dados próprios. Deve R$ 120/mês no Nubank do João: Streaming 50% (R$ 20) + Jiu-jitsu 50% (R$ 100, 9 parcelas restantes) |
| `carlos@exemplo.com` | `carlos123` | `membro`, `leitor` | **A criar** — segundo devedor, para exercitar o rateio N-a-N no aluguel |

```bash
bun run seed:test joao@wallet.local senha123 membro                      # dono + dados
bun run seed:test maria@exemplo.com maria123 membro,leitor --no-data     # devedora 1
bun run seed:test carlos@exemplo.com carlos123 membro,leitor --no-data   # devedora 2 (novo)
```

Pendências de seed que entram junto com o plano:

1. `server/modules/dev/seed.ts` ancora tudo em `2026-06` fixo — trocar por âncora relativa ao mês
   corrente, senão toda conta nova nasce com Início e Despesas vazios (foi exatamente o que
   aconteceu aqui e precisou de rebase manual).
2. O contato "Maria" é criado com email fixo `maria@exemplo.com` e `userId` null; com o fluxo de
   aceite, o seed deve criar o contato em `status: convidado` e um `Convite` pendente — é isso que
   dá pra testar o aceite sem inventar dado na mão.
3. Adicionar ao seed um aluguel compartilhado entre Maria e Carlos (fixa **sem cartão**), que é o
   caso novo que o schema atual não suporta.

---

## 8. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F1** | Migração aditiva: `cartao_id` nullable, uniques de rateio, `abateShares`, enums e tabelas novas | `migrate diff` volta vazio; suíte atual verde |
| **F2** | Rateio N-a-N: validação de soma, `rateioDaLinha`, `POST /shares/bulk`, UI multi-contato | Aluguel dividido entre 2 contatos, soma barrada acima de 100% |
| **F3** | Share de linha sem cartão + regravar agrupamento por dono | Aluguel compartilhado aparece no "O que devo" da Maria |
| **F4** | Convite/aceite + agenda espelhada | Maria aceita e vira contato do João e vice-versa; recusa esconde os shares |
| **F5** | Adoção (`fixa`/`mes`/`ignorado`) + sincronizar/divergência | Fixa adotada nasce parcelada e some sozinha na última parcela |
| **F6** | Adiantamento | Adiantar 3 parcelas zera o devido nos 3 meses e gera `PagamentoFixa` |
| **F7** | Seeds relativos ao mês, conta do Carlos, testes de integração do fluxo inteiro | `bun run test` verde do zero, sem rebase manual de dados |

F1→F3 são independentes de F4; dá pra rodar em paralelo se quiser. F5 depende de F1 (tabela de
adoção) e de F3 (agrupamento por dono). F6 depende de F5.

---

## 9. Decisões em aberto

1. **Aceite retroativo.** Hoje a Maria já vê a dívida sem ter aceitado. Ao ligar o fluxo de convite,
   os vínculos existentes viram `ativo` (grandfather) ou `convidado` (pede aceite)? Sugiro
   `ativo` — quem já estava vendo não perde acesso numa atualização.
2. **Quem cria o convite dispara email?** Não há infra de email no projeto. Primeira versão: link
   com token copiável na UI; email fica pra depois.
3. **Contato sem conta.** Convite pra email sem usuário fica `convidado` até alguém se registrar com
   aquele email — o registro precisa varrer convites pendentes no `POST /auth/register`.
4. **Adoção reflete pagamento?** Marcar a fixa adotada como paga não avisa o dono. Um "avisei que
   paguei" bidirecional é feature de acerto de contas, fora deste escopo — vale registrar como
   próximo passo, não misturar aqui.

---

Versão em página: https://claude.ai/code/artifact/80d00043-30ee-4ecc-b532-88b9ede5ce9d
