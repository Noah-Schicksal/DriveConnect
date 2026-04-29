# Documentação da API - DriveConnect

Este documento detalha todos os endpoints implementados no backend do projeto DriveConnect até o momento, incluindo exemplos práticos de requisição (payload) e a resposta esperada.

> **Autenticação:** Para acessar rotas protegidas, envie o header `Authorization: Bearer <seu_token_jwt>`.

---

## 1. Autenticação e Usuários

### `POST /usuarios/login`
- **Descrição:** Autentica um usuário e retorna o token JWT.
- **Acesso:** Público.
- **Request:**
```json
{
  "email": "cliente@email.com",
  "senha": "senhaSegura123"
}
```
- **Response (200 OK):**
```json
{
  "token": "eyJhbGci...",
  "usuario": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "cliente@email.com",
    "tipo": "CLIENTE"
  }
}
```

### `POST /usuarios/clientes`
- **Descrição:** Registra um novo cliente no sistema.
- **Acesso:** Público / Qualquer.
- **Request:**
```json
{
  "email": "novo@cliente.com",
  "senha": "senhaSegura123",
  "nome_completo": "João Silva",
  "cpf": "11122233344",
  "rg": "MG-123456",
  "cnh": "12345678901"
}
```
- **Response (201 Created):**
```json
{
  "id": "uuid-do-cliente",
  "usuario_id": "uuid-do-usuario",
  "nome_completo": "João Silva",
  "cpf": "11122233344",
  "rg": "MG-123456",
  "cnh": "12345678901"
}
```

### `POST /usuarios/gerentes`
- **Descrição:** Registra um novo gerente (opcionalmente vinculando a uma filial).
- **Acesso:** Administrativo (interno).
- **Request:**
```json
{
  "email": "gerente@empresa.com",
  "senha": "senhaSegura123",
  "nome_completo": "Carlos Gerente",
  "filial_id": "uuid-da-filial"
}
```
- **Response (201 Created):**
```json
{
  "id": "uuid-do-gerente",
  "usuario_id": "uuid-do-usuario",
  "nome_completo": "Carlos Gerente",
  "filial_id": "uuid-da-filial"
}
```

### `GET /usuarios/clientes/me`
- **Descrição:** Retorna os dados do perfil do próprio cliente logado.
- **Acesso:** `CLIENTE`.
- **Response (200 OK):**
```json
{
  "id": "uuid",
  "nome_completo": "João Silva",
  "cpf": "11122233344",
  "rg": "MG-123456",
  "cnh": "12345678901",
  "email": "cliente@email.com"
}
```

### `PUT /usuarios/clientes/me`
- **Descrição:** Edita os dados do perfil do cliente logado.
- **Acesso:** `CLIENTE`.
- **Request:**
```json
{
  "nome_completo": "João Silva Atualizado",
  "cnh": "99988877766"
}
```
- **Response (200 OK):**
```json
{
  "id": "uuid",
  "nome_completo": "João Silva Atualizado",
  "cnh": "99988877766"
}
```

---

## 2. Filiais

### `POST /filiais`
- **Descrição:** Cria uma nova unidade física da locadora.
- **Acesso:** `ADMIN`.
- **Request:**
```json
{
  "nome": "Filial Centro",
  "cep": "30123-456",
  "uf": "MG",
  "cidade": "Belo Horizonte",
  "bairro": "Centro",
  "rua": "Av. Afonso Pena",
  "numero": "1000",
  "complemento": "Loja 1"
}
```
- **Response (201 Created):**
```json
{
  "id": "uuid-da-filial",
  "nome": "Filial Centro",
  "cep": "30123-456",
  "cidade": "Belo Horizonte"
}
```

### `GET /filiais`
- **Descrição:** Retorna a lista de todas as filiais ativas.
- **Acesso:** `GERENTE`, `ADMIN`.
- **Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "nome": "Filial Centro",
    "cidade": "Belo Horizonte",
    "uf": "MG"
  }
]
```

---

## 3. Categorias e Modelos de Carro

### `GET /modelos/disponiveis`
- **Descrição:** Lista os modelos de carros que possuem pelo menos um veículo físico disponível para locação no período desejado (excluindo os que têm sobreposição de reservas).
- **Acesso:** Público / `CLIENTE`.
- **Request (Query Params):** `?data_inicio=2024-05-10T00:00:00Z&data_fim=2024-05-15T00:00:00Z&filial_id=uuid-da-filial`
- **Response (200 OK):**
```json
[
  {
    "id": 10,
    "nome": "Renegade",
    "marca": "Jeep",
    "tipo_carro_id": 1,
    "tipo_carro_nome": "SUV Compacto"
  }
]
```

### `POST /tipos-carro`
- **Descrição:** Cria uma nova categoria de veículos.
- **Acesso:** `ADMIN`.
- **Request:**
```json
{
  "nome": "SUV Compacto",
  "preco_base_diaria": 150.00
}
```
- **Response (201 Created):**
```json
{
  "id": 1,
  "nome": "SUV Compacto",
  "preco_base_diaria": 150.00
}
```

### `POST /modelos`
- **Descrição:** Registra um modelo de carro atrelado a uma categoria.
- **Acesso:** `ADMIN`.
- **Request:**
```json
{
  "nome": "Renegade",
  "marca": "Jeep",
  "tipo_carro_id": 1
}
```
- **Response (201 Created):**
```json
{
  "id": 10,
  "nome": "Renegade",
  "marca": "Jeep",
  "tipo_carro_id": 1
}
```

---

## 4. Veículos (Inventário)

### `POST /veiculos`
- **Descrição:** Adiciona uma unidade de veículo à locadora.
- **Acesso:** `ADMIN` (geralmente gerentes também poderiam, mas está implementado global).
- **Request:** (Multipart/Form-Data ou JSON)
```json
{
  "modelo_id": 10,
  "filial_id": "uuid-da-filial",
  "placa": "ABC-1234",
  "ano": 2024,
  "cor": "Preto",
  "status": "DISPONIVEL"
}
```
- **Response (201 Created):**
```json
{
  "id": "uuid-do-veiculo",
  "modelo_id": 10,
  "filial_id": "uuid-da-filial",
  "placa": "ABC-1234",
  "ano": 2024,
  "cor": "Preto",
  "status": "DISPONIVEL",
  "imagem_url": null
}
```

---

## 5. Tabelas de Preço Dinâmico

### `POST /tabelas-preco`
- **Descrição:** Cria uma regra de preço específica por período, filial e tipo de carro.
- **Acesso:** `ADMIN`.
- **Request:**
```json
{
  "tipo_carro_id": 1,
  "filial_id": "uuid-da-filial",
  "data_inicio": "2024-12-20",
  "data_fim": "2025-01-05",
  "valor_diaria": 250.00
}
```
- **Response (201 Created):**
```json
{
  "id": 5,
  "tipo_carro_id": 1,
  "filial_id": "uuid-da-filial",
  "data_inicio": "2024-12-20T00:00:00.000Z",
  "data_fim": "2025-01-05T23:59:59.000Z",
  "valor_diaria": "250.00"
}
```

---

## 6. Seguros

### `POST /seguros`
- **Descrição:** Cria um plano de seguro disponível para escolha.
- **Request:**
```json
{
  "nome": "Cobertura Total",
  "descricao": "Proteção completa sem franquia",
  "percentual": 20,
  "obrigatorio": false
}
```
- **Response (201 Created):**
```json
{
  "id": "uuid-do-seguro",
  "nome": "Cobertura Total",
  "descricao": "Proteção completa sem franquia",
  "percentual": "20.00",
  "obrigatorio": false,
  "ativo": true
}
```

---

## 7. Pagamentos (Checkout InfinitePay)

### `POST /pagamento/iniciar`
- **Descrição:** Cria uma reserva PENDENTE e gera o link de pagamento.
- **Acesso:** Qualquer usuário autenticado (normalmente Cliente).
- **Request:**
```json
{
  "modelo_id": 10,
  "filial_retirada_id": "uuid-filial-retirada",
  "filial_devolucao_id": "uuid-filial-devolucao",
  "data_inicio": "2024-05-10T10:00:00Z",
  "data_fim": "2024-05-15T10:00:00Z",
  "cliente_id": "uuid-do-cliente",
  "plano_seguro_id": "uuid-do-seguro-opcional"
}
```
- **Response (201 Created):**
```json
{
  "reserva_id": "uuid-da-reserva",
  "link_pagamento": "https://infinitepay.io/checkout/...",
  "valor_aluguel": 750.00,
  "valor_seguro": 150.00,
  "plano_seguro": "Cobertura Total",
  "valor_total": 900.00
}
```

### `GET /pagamento/status/:reservaId`
- **Descrição:** Verifica se a reserva já foi paga.
- **Response (200 OK):**
```json
{
  "status": "RESERVADA",
  "infinitepay_nsu": "123456789",
  "metodo_pagamento": "PIX",
  "pagamento_em": "2024-05-01T15:30:00Z"
}
```

---

## 8. Ciclo de Vida da Reserva

### `GET /reservas/disponibilidade`
- **Descrição:** Calcula o orçamento e confirma a disponibilidade ANTES de reservar.
- **Request (Query Params):** `?modelo_id=10&filial_id=uuid&data_inicio=2024-05-10&data_fim=2024-05-15`
- **Response (200 OK):**
```json
{
  "disponivel": true,
  "preco_total": 750.00,
  "veiculo_id": "uuid-do-veiculo-encontrado"
}
```

### `POST /reservas/:id/retirada`
- **Descrição:** Confirma que o cliente pegou o carro. Altera o veículo para `ALUGADO`.
- **Acesso:** `GERENTE` / `ADMIN`.
- **Request:** Vazio
- **Response (200 OK):**
```json
{
  "liberado": true,
  "mensagem": "Retirada confirmada. Veículo marcado como ALUGADO."
}
```

### `POST /reservas/:id/devolucao`
- **Descrição:** Confirma a entrega. Veículo volta a `DISPONIVEL` e reserva fica `FINALIZADA`.
- **Acesso:** `GERENTE` / `ADMIN`.
- **Request:** Vazio
- **Response (200 OK):**
```json
{
  "mensagem": "Devolução registrada. Veículo marcado como DISPONIVEL."
}
```

### `POST /reservas/:id/cancelar`
- **Descrição:** Cancela uma reserva pendente ou já paga, liberando o carro.
- **Acesso:** `GERENTE` / `ADMIN`.
- **Request:** Vazio
- **Response (200 OK):**
```json
{
  "mensagem": "Reserva cancelada com sucesso."
}
```

---

## 9. Integração WhatsApp Webhook

### `POST /whatsapp/webhook`
- **Descrição:** Rota para a Meta enviar as mensagens dos clientes via WhatsApp Cloud API.
- **Acesso:** Assinado criptograficamente (Meta).
- **Request (Payload Padrão Meta):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "12345",
      "changes": [
        {
          "value": {
            "messages": [
              {
                "from": "5511999999999",
                "text": { "body": "Olá, quero alugar um carro." }
              }
            ]
          }
        }
      ]
    }
  ]
}
```
- **Response (200 OK):** Vazio (Apenas HTTP 200 rápido para a Meta).
