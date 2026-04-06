const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const bcrypt = require('bcryptjs');

let db;

function getDbPath() {
  const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', '..');
  const dbDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, 'gestpro.db');
}

function initDatabase(customPath) {
  const dbPath = customPath || getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seedDefaultData();

  return db;
}

function getDatabase() {
  return db;
}

function createTables() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      profile TEXT NOT NULL CHECK(profile IN ('admin', 'oftalmologista', 'optometrista', 'rececao', 'laboratorio', 'stock')),
      email TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Patients table
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      birth_date DATE,
      gender TEXT CHECK(gender IN ('M', 'F', 'Outro')),
      id_number TEXT,
      tax_number TEXT,
      phone TEXT,
      phone2 TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      postal_code TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Appointments table
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      professional_id INTEGER REFERENCES users(id),
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      duration INTEGER DEFAULT 30,
      type TEXT NOT NULL CHECK(type IN ('oftalmologia', 'optometria', 'revisao', 'outro')),
      status TEXT DEFAULT 'agendada' CHECK(status IN ('agendada', 'confirmada', 'em_atendimento', 'concluida', 'cancelada', 'faltou')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Consultations table
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      professional_id INTEGER NOT NULL REFERENCES users(id),
      appointment_id INTEGER REFERENCES appointments(id),
      type TEXT NOT NULL CHECK(type IN ('oftalmologia', 'optometria')),
      consultation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Common fields
      chief_complaint TEXT,
      medical_history TEXT,
      family_history TEXT,
      current_medications TEXT,
      allergies TEXT,
      -- Visual Acuity
      va_od_sc TEXT,
      va_od_cc TEXT,
      va_oe_sc TEXT,
      va_oe_cc TEXT,
      -- Autorefraction
      auto_od_esf TEXT,
      auto_od_cil TEXT,
      auto_od_eixo TEXT,
      auto_oe_esf TEXT,
      auto_oe_cil TEXT,
      auto_oe_eixo TEXT,
      -- Refraction
      ref_od_esf TEXT,
      ref_od_cil TEXT,
      ref_od_eixo TEXT,
      ref_od_add TEXT,
      ref_od_av TEXT,
      ref_oe_esf TEXT,
      ref_oe_cil TEXT,
      ref_oe_eixo TEXT,
      ref_oe_add TEXT,
      ref_oe_av TEXT,
      ref_dp TEXT,
      -- Tonometry
      pio_od TEXT,
      pio_oe TEXT,
      pio_method TEXT,
      -- Biomicroscopy
      biomicroscopy_od TEXT,
      biomicroscopy_oe TEXT,
      -- Fundoscopy
      fundoscopy_od TEXT,
      fundoscopy_oe TEXT,
      -- Optometry specific - Anamnesis
      anamnesis_visual_symptoms TEXT,
      anamnesis_ocular_history TEXT,
      anamnesis_occupation TEXT,
      anamnesis_screen_time TEXT,
      anamnesis_reading_distance TEXT,
      anamnesis_driving TEXT,
      anamnesis_sports TEXT,
      anamnesis_current_glasses TEXT,
      anamnesis_last_exam_date TEXT,
      anamnesis_satisfaction TEXT,
      -- Optometry specific - Cover test
      cover_test_distance TEXT,
      cover_test_near TEXT,
      -- Optometry specific - Convergence
      convergence_near_point TEXT,
      accommodation TEXT,
      -- Diagnosis
      diagnosis TEXT,
      diagnosis_code TEXT,
      functional_diagnosis TEXT,
      -- Plan
      treatment_plan TEXT,
      observations TEXT,
      next_revision_date DATE,
      status TEXT DEFAULT 'em_andamento' CHECK(status IN ('em_andamento', 'concluida')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Prescriptions table
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER REFERENCES consultations(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      professional_id INTEGER NOT NULL REFERENCES users(id),
      prescription_date DATE DEFAULT (date('now')),
      -- Right eye
      rx_od_esf TEXT,
      rx_od_cil TEXT,
      rx_od_eixo TEXT,
      rx_od_add TEXT,
      rx_od_prisma TEXT,
      rx_od_base TEXT,
      -- Left eye
      rx_oe_esf TEXT,
      rx_oe_cil TEXT,
      rx_oe_eixo TEXT,
      rx_oe_add TEXT,
      rx_oe_prisma TEXT,
      rx_oe_base TEXT,
      -- Additional
      rx_dp TEXT,
      rx_dp_near TEXT,
      lens_type TEXT,
      lens_material TEXT,
      lens_treatment TEXT,
      frame_notes TEXT,
      observations TEXT,
      valid_until DATE,
      printed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Stock categories
    CREATE TABLE IF NOT EXISTS stock_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Stock items
    CREATE TABLE IF NOT EXISTS stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES stock_categories(id),
      brand TEXT,
      model TEXT,
      description TEXT,
      purchase_price REAL DEFAULT 0,
      sale_price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 0,
      min_quantity INTEGER DEFAULT 5,
      location TEXT,
      supplier TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Stock movements
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
      type TEXT NOT NULL CHECK(type IN ('entrada', 'saida', 'ajuste')),
      quantity INTEGER NOT NULL,
      reason TEXT,
      reference_id INTEGER,
      reference_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Sales table
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      prescription_id INTEGER REFERENCES prescriptions(id),
      seller_id INTEGER REFERENCES users(id),
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      payment_method TEXT CHECK(payment_method IN ('dinheiro', 'cartao', 'transferencia', 'cheque', 'misto')),
      payment_status TEXT DEFAULT 'pendente' CHECK(payment_status IN ('pendente', 'parcial', 'pago')),
      status TEXT DEFAULT 'producao' CHECK(status IN ('producao', 'pronto', 'entregue', 'cancelada')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Sale items
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      stock_item_id INTEGER REFERENCES stock_items(id),
      description TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0
    );

    -- Orders (encomendas)
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      sale_id INTEGER REFERENCES sales(id),
      patient_id INTEGER REFERENCES patients(id),
      supplier TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'encomendada', 'recebida', 'cancelada')),
      expected_date DATE,
      received_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Laboratory orders
    CREATE TABLE IF NOT EXISTS lab_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      sale_id INTEGER REFERENCES sales(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      prescription_id INTEGER REFERENCES prescriptions(id),
      -- Lens details
      lens_type TEXT,
      lens_material TEXT,
      lens_treatment TEXT,
      -- Right eye
      lab_od_esf TEXT,
      lab_od_cil TEXT,
      lab_od_eixo TEXT,
      lab_od_add TEXT,
      -- Left eye
      lab_oe_esf TEXT,
      lab_oe_cil TEXT,
      lab_oe_eixo TEXT,
      lab_oe_add TEXT,
      lab_dp TEXT,
      -- Frame
      frame_brand TEXT,
      frame_model TEXT,
      frame_color TEXT,
      frame_size TEXT,
      -- Production
      status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'em_producao', 'controle_qualidade', 'pronto', 'entregue')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('normal', 'urgente')),
      assigned_to INTEGER REFERENCES users(id),
      start_date DATETIME,
      completion_date DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Revisions tracking
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      consultation_id INTEGER REFERENCES consultations(id),
      scheduled_date DATE NOT NULL,
      status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'notificada', 'realizada', 'cancelada')),
      notification_sent INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    -- Audit log
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT,
      user_profile TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      description TEXT,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- License
    CREATE TABLE IF NOT EXISTS license (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      license_key TEXT NOT NULL,
      activation_date DATE NOT NULL,
      expiration_date DATE NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      category TEXT DEFAULT 'general'
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
    CREATE INDEX IF NOT EXISTS idx_patients_code ON patients(code);
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(consultation_date);
    CREATE INDEX IF NOT EXISTS idx_sales_patient ON sales(patient_id);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code);
    CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_date ON revisions(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
}

function seedDefaultData() {
  // Check if admin user exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, password, full_name, profile, email)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', hashedPassword, 'Administrador', 'admin', 'admin@muhasoft.com');
  }

  // Seed stock categories
  const categories = ['Armações', 'Lentes Oftálmicas', 'Lentes de Contacto', 'Solares', 'Acessórios', 'Produtos de Limpeza'];
  const insertCategory = db.prepare('INSERT OR IGNORE INTO stock_categories (name) VALUES (?)');
  categories.forEach(cat => insertCategory.run(cat));

  // Seed default settings
  const settings = [
    ['clinic_name', 'Óptica Muhasoft', 'general'],
    ['clinic_address', '', 'general'],
    ['clinic_phone', '', 'general'],
    ['clinic_email', '', 'general'],
    ['clinic_tax_number', '', 'general'],
    ['backup_auto', '1', 'backup'],
    ['backup_interval', '24', 'backup'],
    ['backup_path', '', 'backup'],
    ['revision_alert_days', '7', 'clinical'],
    ['stock_alert_min', '5', 'stock'],
    ['server_port', '3847', 'network'],
    ['prescription_validity_days', '180', 'clinical']
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, ?)');
  settings.forEach(s => insertSetting.run(s[0], s[1], s[2]));
}

module.exports = { initDatabase, getDatabase, getDbPath };
