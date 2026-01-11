-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nit TEXT UNIQUE,
    legal_name TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'Bolivia',
    phone TEXT,
    email TEXT,
    website TEXT,
    logo_url TEXT,
    fiscal_year_start TEXT DEFAULT '01-01',
    currency TEXT DEFAULT 'BOB',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Accounts Table (Plan de Cuentas)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- Activo, Pasivo, Patrimonio, Ingreso, Egreso
    level INTEGER NOT NULL,
    parent_code TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, code)
);

-- Transactions Table (Libro Diario)
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    gloss TEXT NOT NULL,
    type TEXT NOT NULL, -- Ingreso, Egreso, Traspaso
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Transaction Entries (Detalle de Asientos)
CREATE TABLE IF NOT EXISTS transaction_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    gloss TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- Inventory Items (Kardex)
CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    balance_quantity REAL DEFAULT 0,
    balance_cost REAL DEFAULT 0,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, code)
);

-- Inventory Movements
CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL, -- Compra, Venta, Devolucion
    quantity REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_cost REAL NOT NULL,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
);

-- Fixed Assets
CREATE TABLE IF NOT EXISTS fixed_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    acquisition_date TEXT NOT NULL,
    acquisition_cost REAL NOT NULL,
    useful_life INTEGER NOT NULL,
    residual_value REAL DEFAULT 0,
    depreciation_method TEXT DEFAULT 'Lineal',
    accumulated_depreciation REAL DEFAULT 0,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, code)
);

-- UFV (Unidad de Fomento de Vivienda)
CREATE TABLE IF NOT EXISTS ufv_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    value REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    usd_buy REAL NOT NULL,
    usd_sell REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- MAHORAGA V6.0: TABLAS DE CEREBRO SINTÉTICO (SCL - Self Correction Learning)
-- =============================================================================

-- Tabla de Perfiles de Ajuste por Empresa (La Rueda de Ocho Empuñaduras)
CREATE TABLE IF NOT EXISTS company_adjustment_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE,
    profile_json TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Tabla de Eventos de Adaptación (Registro del Giro de la Rueda)
CREATE TABLE IF NOT EXISTS mahoraga_adaptation_events (
    id TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    user TEXT DEFAULT 'Anonymous',
    origin_trans TEXT,
    account_code TEXT,
    account_name TEXT,
    action TEXT,
    error_reason_tag TEXT,
    user_comment TEXT,
    event_data TEXT,
    reverted INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Índices para Mahoraga
CREATE INDEX IF NOT EXISTS idx_adaptation_company ON mahoraga_adaptation_events(company_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_timestamp ON mahoraga_adaptation_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_adaptation_account ON mahoraga_adaptation_events(account_code);
CREATE INDEX IF NOT EXISTS idx_profiles_company ON company_adjustment_profiles(company_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_company ON transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_inventory_company ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON fixed_assets(company_id);

-- Insert a default company for migration
INSERT OR IGNORE INTO companies (id, name, nit, legal_name, address, city, country)
VALUES (1, 'Mi Empresa', '000000000', 'Mi Empresa S.A.', 'Dirección Principal', 'La Paz', 'Bolivia');
