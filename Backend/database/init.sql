-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────
-- USUÁRIO (autenticação central)
-- tipo GERENTE: pode ser global (filial_id NULL em gerente)
--               ou vinculado a uma filial (filial_id preenchido)
-- ──────────────────────────────────────────────
CREATE TABLE usuario (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('CLIENTE', 'GERENTE', 'ADMIN')),
    reset_token VARCHAR(255),
    reset_token_expira_em TIMESTAMP,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- CLIENTE
-- ──────────────────────────────────────────────
CREATE TABLE cliente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome_completo VARCHAR(255) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    rg VARCHAR(20),
    cnh VARCHAR(20),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- FILIAL
-- Unidade física da empresa. Não há mais vínculo com franquia.
-- ──────────────────────────────────────────────
CREATE TABLE filial (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255),
    cep VARCHAR(10),
    uf VARCHAR(2),
    cidade VARCHAR(100),
    bairro VARCHAR(100),
    rua VARCHAR(255),
    numero VARCHAR(10),
    complemento VARCHAR(100),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- GERENTE
-- Substitui o perfil de "franquia". filial_id NULL = acesso global.
-- ──────────────────────────────────────────────
CREATE TABLE gerente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome_completo VARCHAR(255) NOT NULL,
    filial_id UUID REFERENCES filial(id),  -- NULL = gerente global (todas as filiais)
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- PLANO DE SEGURO (global da empresa)
-- O plano Básico tem obrigatorio = TRUE e é sempre incluído na reserva.
-- Constraint garante no máximo 1 plano obrigatório ativo globalmente.
-- ──────────────────────────────────────────────
CREATE TABLE plano_seguro (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    nome VARCHAR(100) NOT NULL,       -- ex: 'Básico', 'Standard', 'Premium'
    descricao TEXT,                    -- texto livre descrevendo as coberturas
    percentual DECIMAL(5,2) NOT NULL   -- ex: 0.00 (básico), 5.00, 12.50
        CHECK (percentual >= 0 AND percentual <= 100),
    obrigatorio BOOLEAN DEFAULT FALSE,  -- TRUE = plano Básico, sempre incluso

    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- Garante 1 único plano obrigatório ativo globalmente
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE UNIQUE INDEX unique_plano_obrigatorio_global
    ON plano_seguro ((TRUE))
    WHERE (obrigatorio = TRUE AND deletado_em IS NULL AND ativo = TRUE);

-- ──────────────────────────────────────────────
-- TIPO DE CARRO (categoria)
-- ──────────────────────────────────────────────
CREATE TABLE tipo_carro (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    preco_base_diaria DECIMAL(10,2) NOT NULL
);

-- ──────────────────────────────────────────────
-- MODELO
-- ──────────────────────────────────────────────
CREATE TABLE modelo (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    marca VARCHAR(100),
    tipo_carro_id INT REFERENCES tipo_carro(id)
);

-- ──────────────────────────────────────────────
-- VEÍCULO (unidade física)
-- ──────────────────────────────────────────────
CREATE TABLE veiculo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    modelo_id INT REFERENCES modelo(id),
    filial_id UUID REFERENCES filial(id),
    placa VARCHAR(10) UNIQUE NOT NULL,
    ano INT NOT NULL,
    cor VARCHAR(50),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DISPONIVEL', 'ALUGADO', 'MANUTENCAO')),
    imagem_url TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- RESERVA / ALUGUEL
-- ──────────────────────────────────────────────
CREATE TABLE reserva (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID REFERENCES cliente(id),
    veiculo_id UUID REFERENCES veiculo(id),
    filial_retirada_id UUID REFERENCES filial(id),
    filial_devolucao_id UUID REFERENCES filial(id),
    data_inicio TIMESTAMP NOT NULL,
    data_fim TIMESTAMP NOT NULL,
    data_retirada_real TIMESTAMP,
    data_devolucao_real TIMESTAMP,
    valor_total DECIMAL(10,2),
    valor_adicional DECIMAL(10,2) DEFAULT 0.00,
    -- PENDENTE_PAGAMENTO: aguardando pagamento (bloqueio temporário do veículo)
    -- EXPIRADA: pagamento não concluído no tempo limite, veículo liberado
    status VARCHAR(25) NOT NULL CHECK (status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA', 'FINALIZADA', 'CANCELADA', 'EXPIRADA')),

    -- Rastreamento do pagamento InfinitePay
    infinitepay_order_nsu   VARCHAR(255),  -- ID do pedido = reserva.id
    infinitepay_slug        VARCHAR(255),  -- Código da fatura na InfinitePay
    infinitepay_nsu         VARCHAR(255),  -- ID único da transação aprovada
    metodo_pagamento        VARCHAR(20),   -- "credit_card" ou "pix"
    link_pagamento          TEXT,          -- URL do checkout gerado
    comprovante_url         TEXT,          -- URL do comprovante (vem no webhook)
    pagamento_em            TIMESTAMP,     -- Quando o pagamento foi confirmado
    expira_em               TIMESTAMP,     -- Expiração do PENDENTE_PAGAMENTO

    -- Seguro contratado (plano global da empresa)
    plano_seguro_id UUID REFERENCES plano_seguro(id),
    valor_seguro    DECIMAL(10,2),          -- valor calculado e fixado no momento da reserva

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- TABELA DE PREÇO DINÂMICO
-- ──────────────────────────────────────────────
CREATE TABLE tabela_preco (
    id SERIAL PRIMARY KEY,
    tipo_carro_id INT REFERENCES tipo_carro(id),
    filial_id UUID REFERENCES filial(id),
    data_inicio DATE,
    data_fim DATE,
    valor_diaria DECIMAL(10,2) NOT NULL
);

-- ──────────────────────────────────────────────
-- CONTROLE FINANCEIRO (global; filial_id para rastreio por unidade)
-- ──────────────────────────────────────────────
CREATE TABLE transacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filial_id UUID REFERENCES filial(id),  -- NULL = transação corporativa
    tipo VARCHAR(20) CHECK (tipo IN ('ENTRADA', 'SAIDA')),
    valor DECIMAL(10,2),
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ──────────────────────────────────────────────
-- ÍNDICES (performance)
-- ──────────────────────────────────────────────
CREATE INDEX idx_veiculo_filial ON veiculo(filial_id);
CREATE INDEX idx_reserva_veiculo ON reserva(veiculo_id);
CREATE INDEX idx_reserva_cliente ON reserva(cliente_id);
CREATE INDEX idx_reserva_periodo ON reserva(data_inicio, data_fim);
CREATE TABLE veiculo_imagem (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    veiculo_id UUID NOT NULL REFERENCES veiculo(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    is_principal BOOLEAN DEFAULT FALSE,
    ordem INT DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_veiculo_imagem_veiculo ON veiculo_imagem(veiculo_id);

CREATE INDEX idx_gerente_filial ON gerente(filial_id);
