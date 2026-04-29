# Context: CRUD API

> Last updated: 2026-04-29T18:26:00-03:00
> Version: 3

## Purpose
Rastreamento das implementações de CRUD realizadas no backend DriveConnect via skill crud-api.

## Architecture / How It Works

- **Camadas**: Entity (validação) → Service (lógica + DB) → Routes (HTTP handler) → server.ts (roteador central)
- **Nota**: O projeto usa vanilla Node.js HTTP (`createServer`), **sem Express**. Não há middleware chain via `use()` — as rotas são registradas manualmente via regex no `server.ts`.
- **DB**: PostgreSQL com `pg` pool direto (sem multi-tenant/withTenant). Funções `query()` e `getClient()` de `src/db/index.ts`.
- **Auth (atual)**: Headers simples `X-Usuario-Id`, `X-Tipo`, `X-Filial-Id`. Guards tipados em `src/middlewares/auth.ts`. **Trocar por JWT quando implementar autenticação completa.**
- **Padrão de naming**: funções em português (camelCase). Entidades com classe TypeScript pura (sem ORM).
- **Soft delete**: `deletado_em TIMESTAMP` em todas as entidades. Queries sempre filtram `WHERE deletado_em IS NULL`.
- **Wrapper Pattern**: toda função pública exportada é um wrapper fino sobre uma função privada `_nomeFuncao`. Lógica real na privada.

## Regras de Autorização Implementadas

| Endpoint | CLIENTE | GERENTE | ADMIN |
|----------|---------|---------|-------|
| `GET /usuarios/clientes` | ❌ | ✅ | ✅ |
| `GET /usuarios/clientes/:id` | ❌ | ✅ | ✅ |
| `GET /usuarios/clientes/me` | ✅ (próprio) | ❌ | ❌ |
| `PUT /usuarios/clientes/:id` | ❌ | ✅ | ✅ |
| `PUT /usuarios/clientes/me` | ✅ (próprio) | ❌ | ❌ |
| `PATCH /usuarios/:id/senha` | ✅ (ownership) | ❌ | ✅ |
| `DELETE /usuarios/:id` | ❌ | ❌ | ✅ |
| `GET /filiais` | ❌ | ✅ (todas) | ✅ |
| `GET /filiais/:id` | ❌ | ✅ (todas) | ✅ |
| `POST /filiais` | ❌ | ❌ | ✅ |
| `PUT /filiais/:id` | ❌ | ✅ (só a própria) | ✅ |
| `DELETE /filiais/:id` | ❌ | ❌ | ✅ |
| `GET /gerentes` | ❌ | ❌ | ✅ |
| `GET /gerentes/me` | ❌ | ✅ (próprio) | ❌ |
| `GET /tipos-carro` | ❌ | ✅ | ✅ |
| `GET /tipos-carro/:id` | ❌ | ✅ | ✅ |
| `POST /tipos-carro` | ❌ | ❌ | ✅ |
| `PUT /tipos-carro/:id` | ❌ | ❌ | ✅ |
| `GET /tabelas-preco` | ❌ | ✅ (filial própria auto) | ✅ |
| `GET /tabelas-preco/:id` | ❌ | ✅ (filial própria) | ✅ |
| `POST /tabelas-preco` | ❌ | ❌ | ✅ |
| `PUT /tabelas-preco/:id` | ❌ | ❌ | ✅ |
| `DELETE /tabelas-preco/:id` | ❌ | ❌ | ✅ |
| `GET /reservas` | ❌ | ✅ (filial própria) | ✅ |
| `GET /reservas/:id` | ❌ | ✅ (filial própria) | ✅ |
| `POST /reservas` | ✅ | ❌ | ❌ |
| `POST /reservas/:id/cancelar` | ❌ | ✅ (filial própria) | ✅ |
| `GET /modelos` | ❌ | ✅ | ✅ |
| `GET /modelos/:id` | ❌ | ✅ | ✅ |
| `POST /modelos` | ❌ | ❌ | ✅ |
| `PUT /modelos/:id` | ❌ | ❌ | ✅ |
| `DELETE /modelos/:id` | ❌ | ❌ | ✅ |

## Affected Project Files

| File | Criado/Modificado | Responsabilidade |
|------|:-----------------:|--------------------|
| `Backend/src/entities/Usuario.ts` | Criado (v1) | Validação de email, senha, tipo |
| `Backend/src/entities/Cliente.ts` | Criado (v1) | Validação de CPF, nome, regra de habilitação |
| `Backend/src/entities/Gerente.ts` | Criado (v1) | Regra de escopo global vs filial |
| `Backend/src/entities/TipoCarro.ts` | Criado (v2) | Validação de nome e preco_base_diaria |
| `Backend/src/entities/Modelo.ts` | Criado (v2) | Validação de nome, marca, tipo_carro_id |
| `Backend/src/entities/TabelaPreco.ts` | Criado (v3) | Validação de datas ISO, período consistente, valor_diaria positivo |
| `Backend/src/middlewares/auth.ts` | Criado (v1) | Extração do caller, guards requireCaller/requireTipo/requireOwnership |
| `Backend/src/services/usuario.service.ts` | Criado (v1) | Auth argon2id, CRUD cliente/gerente, soft-delete em transação |
| `Backend/src/services/filial.service.ts` | Modificado (v2) | + criarFilial (ADMIN only) + desativarFilial (soft-delete com guard de vínculos) |
| `Backend/src/services/tipoCarro.service.ts` | Criado (v2) | CRUD tipo_carro; guard de dependência antes de deletar (verifica modelos vinculados) |
| `Backend/src/services/modelo.service.ts` | Criado (v2) | CRUD modelo; validação FK tipo_carro_id; guard de veículos ativos antes de deletar |
| `Backend/src/services/tabelaPreco.service.ts` | Criado (v3) | CRUD tabela_preco; valida FK tipo_carro_id + filial_id; filtros opcionais por filial/tipo |
| `Backend/src/services/reservaConsulta.service.ts` | Criado (v3) | Listagem/detalhe com filtro de filial por caller; cancelamento com liberação automática de veículo |
| `Backend/src/services/reserva.service.ts` | Modificado (v3) | `criarReservaPendente` com integração InfinitePay |
| `Backend/src/routes/usuario.routes.ts` | Criado (v1) | Handlers HTTP para usuários/clientes |
| `Backend/src/routes/filial.routes.ts` | Modificado (v2) | + registrarFilial (POST) + desativarFilialHandler (DELETE) |
| `Backend/src/routes/tipoCarro.routes.ts` | Criado (v2) | CRUD completo de tipos de carro |
| `Backend/src/routes/modelo.routes.ts` | Criado (v2) | CRUD completo de modelos |
| `Backend/src/routes/tabelaPreco.routes.ts` | Criado (v3) | CRUD tabelas de preço; gerente vê apenas filial própria automaticamente |
| `Backend/src/routes/reservaConsulta.routes.ts` | Criado (v3) | GET /reservas, GET /reservas/:id, POST /reservas/:id/cancelar |
| `Backend/src/routes/reserva.routes.ts` | Modificado (v3) | Adicionado POST /reservas com integração InfinitePay e seguro |
| `Backend/src/server.ts` | Modificado (v3) | + /reservas GET+GET:id+cancelar+POST, /tabelas-preco CRUD |
| `Backend/src/utils/hash.ts` | Pré-existente | gerarHash / verificarHash argon2id |
| `Backend/src/db/index.ts` | Pré-existente | query() e getClient() |

## Code Reference

### `src/services/filial.service.ts` — `_desativarFilial(filialId)`

```typescript
async function _desativarFilial(filialId: string): Promise<boolean> {
  // Verifica veículos ativos e gerentes vinculados antes de desativar
  // Soft delete: SET deletado_em + ativo = FALSE
}
```

**How it works:** Guard duplo — rejeita com 409 se houver veículos `AND deletado_em IS NULL` ou gerentes vinculados. Depois faz soft-delete atomicamente.

### `src/services/tipoCarro.service.ts` — `_deletarTipoCarro(id)`

```typescript
// Verifica modelos vinculados antes de hard-delete
const dependentes = await query(`SELECT id FROM modelo WHERE tipo_carro_id = $1 LIMIT 1`, [id]);
if ((dependentes.rowCount ?? 0) > 0) throw new Error('...');
```

**How it works:** tipo_carro não tem `deletado_em` (SERIAL, sem soft-delete no schema), portanto usa hard-delete com guard de FK.

### `src/services/modelo.service.ts` — `_criarModelo / _atualizarModelo`

```typescript
// Valida existência do tipo_carro_id antes de inserir/atualizar
const tipoExiste = await query(`SELECT id FROM tipo_carro WHERE id = $1`, [dados.tipo_carro_id]);
if ((tipoExiste.rowCount ?? 0) === 0) throw new Error('Tipo de carro não encontrado...');
```

**How it works:** Validação de FK no service layer — garante mensagem de erro clara em vez de erro 500 por violação de constraint.

### `src/routes/modelo.routes.ts` — `GET /modelos?tipo_carro_id=N`

```typescript
const tipoCarroIdParam = url.searchParams.get('tipo_carro_id');
const tipoCarroId = tipoCarroIdParam ? Number(tipoCarroIdParam) : undefined;
const modelos = await listarModelos(tipoCarroId);
```

**How it works:** Query param opcional para filtrar modelos por categoria de carro.

## Key Design Decisions

1. **Headers simples em vez de JWT (por ora):** Guards isolados em `auth.ts` — substituir por JWT exige mudança em apenas um arquivo.

2. **Enforcement duplo (service + route):** Regras de filial própria e ownership validadas no service, não só no guard HTTP.

3. **`/clientes/me` registrado ANTES de `/clientes/:id`:** Rota estática deve ser testada antes do regex no server.ts.

4. **Sem Express:** Rotas declaradas via `if` + regex no `server.ts`. Escalável até ~20 domínios.

5. **Gerente global (filialId = null):** Gerente com `filial_id = NULL` tem acesso de leitura a tudo, mas edição de filial falha (`null !== uuid`) — decisão de negócio pendente.

6. **Guard de dependência antes de delete:** `tipo_carro` e `modelo` verificam FK antes de deletar; `filial` verifica veículos ativos e gerentes vinculados antes do soft-delete.

7. **`tipo_carro` e `modelo` usam SERIAL (sem soft-delete):** O schema não define `deletado_em` para essas tabelas, portanto usa hard-delete com guard de FK.

### `src/services/reservaConsulta.service.ts` — `_filtrosCaller(caller)`

```typescript
// ADMIN e GERENTE global → sem filtro de filial
// GERENTE com filialId → AND (filial_retirada_id = $1 OR filial_devolucao_id = $1)
```

**How it works:** Enforcement de escopo no service layer. Mesmo endpoint serve ADMIN (todas) e GERENTE (só filial própria) sem bifurcação no HTTP handler.

### `src/services/reservaConsulta.service.ts` — `_cancelarReserva(reservaId, caller)`

```typescript
// 1. Busca reserva sem filtro (para dar 404 correto antes de 403)
// 2. Enforce de filial para GERENTE
// 3. Valida status: só PENDENTE_PAGAMENTO ou RESERVADA podem cancelar
// 4. Se RESERVADA → libera veículo (status = 'DISPONIVEL')
// 5. UPDATE reserva SET status = 'CANCELADA'
```

**How it works:** Busca sem filtro intencionalmente — garante 404 antes de 403 (não vaza existência). Liberação de veículo acontece atomicamente antes do cancelamento.

### `src/routes/tabelaPreco.routes.ts` — `GET /tabelas-preco` (scope automático)

```typescript
// GERENTE com filial → filialId forçado para caller.filialId (ignora query param)
// ADMIN → usa ?filial_id= opcional ou retorna todas
```

**How it works:** A restrição de escopo do GERENTE é aplicada diretamente no route handler, antes de chegar ao service.

## Changelog

### v3 — 2026-04-29
- Criada entity `TabelaPreco` com validação de datas ISO e período consistente
- Implementado `tabelaPreco.service.ts`: CRUD com validação de FK e filtros opcionais
- Implementado `reservaConsulta.service.ts`: listagem/detalhe com scope de filial + cancelamento com liberação de veículo
- Implementado `POST /reservas` no `reserva.routes.ts` com criação de `reservaPendente` e geração de link `InfinitePay`
- Criados `tabelaPreco.routes.ts` e `reservaConsulta.routes.ts`
- Registradas novas rotas no `server.ts`: GET/GET:id/POST/cancelar em /reservas e CRUD em /tabelas-preco
- TSC: 0 erros nos arquivos novos

### v2 — 2026-04-29
- Criadas entidades `TipoCarro` e `Modelo` com validação e interfaces de tipo
- Implementado `tipoCarro.service.ts`: CRUD completo com guard de dependência (modelos vinculados)
- Implementado `modelo.service.ts`: CRUD completo com validação de FK (`tipo_carro_id`) e guard de veículos ativos
- Criados `tipoCarro.routes.ts` e `modelo.routes.ts` com guards ADMIN/GERENTE e mapearErro com 409
- Adicionado `criarFilial` e `desativarFilial` ao `filial.service.ts`
- Adicionados handlers `registrarFilial` e `desativarFilialHandler` ao `filial.routes.ts`
- Registradas todas as novas rotas no `server.ts`: `/filiais POST+DELETE`, `/tipos-carro`, `/modelos`
- TSC: 0 erros nos arquivos novos

### v1 — 2026-04-28
- Criadas entidades `Usuario`, `Cliente`, `Gerente` com regras de negócio encapsuladas
- Implementado `usuario.service.ts`: auth argon2id, CRUD completo, soft-delete transacional
- Criado `middlewares/auth.ts`: extração de caller por header, guards `requireCaller`, `requireTipo`, `requireOwnership`
- Criado `filial.service.ts`: leitura pública para gerentes, escrita restrita à filial própria
- Criado `filial.routes.ts`: endpoints de filial e gerente com guards aplicados
- Adicionados endpoints `/clientes/me` (GET + PUT) restritos ao próprio cliente
- Guards aplicados em todos os endpoints existentes de usuários
- Registradas novas rotas no `server.ts`
