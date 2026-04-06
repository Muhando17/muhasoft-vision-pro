const { ipcMain, dialog, app } = require('electron');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getLocalIP } = require('./server');
const Store = require('electron-store');

const store = new Store();
let currentUser = null;

function setupIPC(mainWindow, db) {
  // ========== AUTH ==========
  ipcMain.handle('auth:login', async (event, { username, password }) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
      if (!user) {
        return { success: false, error: 'Utilizador não encontrado' };
      }
      const valid = bcrypt.compareSync(password, user.password);
      if (!valid) {
        return { success: false, error: 'Palavra-passe incorreta' };
      }

      currentUser = { id: user.id, username: user.username, full_name: user.full_name, profile: user.profile };
      store.set('currentUser', currentUser);

      // Check license
      const license = checkLicense(db);

      // Audit
      logAudit(db, user, 'LOGIN', 'auth', 'Início de sessão');

      return { success: true, user: currentUser, license };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    if (currentUser) {
      logAudit(db, currentUser, 'LOGOUT', 'auth', 'Fim de sessão');
    }
    currentUser = null;
    store.delete('currentUser');
    return { success: true };
  });

  ipcMain.handle('auth:getCurrentUser', async () => {
    return currentUser || store.get('currentUser') || null;
  });

  ipcMain.handle('auth:changePassword', async (event, { userId, oldPassword, newPassword }) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!user) return { success: false, error: 'Utilizador não encontrado' };

      if (currentUser.profile !== 'admin') {
        const valid = bcrypt.compareSync(oldPassword, user.password);
        if (!valid) return { success: false, error: 'Palavra-passe atual incorreta' };
      }

      const hashed = bcrypt.hashSync(newPassword, 10);
      db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashed, userId);
      logAudit(db, currentUser, 'UPDATE', 'users', `Alteração de palavra-passe do utilizador ${user.username}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== USERS ==========
  ipcMain.handle('users:getAll', async () => {
    return db.prepare('SELECT id, username, full_name, profile, email, phone, active, created_at FROM users ORDER BY full_name').all();
  });

  ipcMain.handle('users:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const hashed = bcrypt.hashSync(data.password, 10);
      const result = db.prepare(
        'INSERT INTO users (username, password, full_name, profile, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(data.username, hashed, data.full_name, data.profile, data.email || null, data.phone || null);
      logAudit(db, currentUser, 'CREATE', 'users', `Criado utilizador: ${data.username}`);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        return { success: false, error: 'Nome de utilizador já existe' };
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const fields = ['full_name = ?', 'profile = ?', 'email = ?', 'phone = ?', 'active = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params = [data.full_name, data.profile, data.email, data.phone, data.active ? 1 : 0];

      if (data.password) {
        fields.push('password = ?');
        params.push(bcrypt.hashSync(data.password, 10));
      }
      params.push(data.id);

      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      logAudit(db, currentUser, 'UPDATE', 'users', `Atualizado utilizador ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:delete', async (event, id) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare('UPDATE users SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      logAudit(db, currentUser, 'DELETE', 'users', `Desativado utilizador ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== PATIENTS ==========
  ipcMain.handle('patients:getAll', async (event, search) => {
    if (search) {
      return db.prepare(
        "SELECT * FROM patients WHERE full_name LIKE ? OR code LIKE ? OR phone LIKE ? OR id_number LIKE ? ORDER BY full_name"
      ).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    return db.prepare('SELECT * FROM patients ORDER BY full_name').all();
  });

  ipcMain.handle('patients:getById', async (event, id) => {
    return db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  });

  ipcMain.handle('patients:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const code = generateCode(db, 'PAC');
      const result = db.prepare(`
        INSERT INTO patients (code, full_name, birth_date, gender, id_number, tax_number, phone, phone2, email, address, city, postal_code, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, data.full_name, data.birth_date, data.gender, data.id_number, data.tax_number,
        data.phone, data.phone2, data.email, data.address, data.city, data.postal_code, data.notes,
        currentUser ? currentUser.id : null);
      logAudit(db, currentUser, 'CREATE', 'patients', `Criado paciente: ${data.full_name} (${code})`);
      return { success: true, id: result.lastInsertRowid, code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('patients:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare(`
        UPDATE patients SET full_name=?, birth_date=?, gender=?, id_number=?, tax_number=?,
        phone=?, phone2=?, email=?, address=?, city=?, postal_code=?, notes=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(data.full_name, data.birth_date, data.gender, data.id_number, data.tax_number,
        data.phone, data.phone2, data.email, data.address, data.city, data.postal_code, data.notes, data.id);
      logAudit(db, currentUser, 'UPDATE', 'patients', `Atualizado paciente ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('patients:delete', async (event, id) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare('DELETE FROM patients WHERE id = ?').run(id);
      logAudit(db, currentUser, 'DELETE', 'patients', `Eliminado paciente ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== APPOINTMENTS ==========
  ipcMain.handle('appointments:getAll', async (event, filters) => {
    let query = `SELECT a.*, p.full_name as patient_name, p.phone as patient_phone, u.full_name as professional_name
                 FROM appointments a
                 LEFT JOIN patients p ON a.patient_id = p.id
                 LEFT JOIN users u ON a.professional_id = u.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.date) { query += ' AND a.appointment_date = ?'; params.push(filters.date); }
      if (filters.professional_id) { query += ' AND a.professional_id = ?'; params.push(filters.professional_id); }
      if (filters.status) { query += ' AND a.status = ?'; params.push(filters.status); }
      if (filters.startDate && filters.endDate) {
        query += ' AND a.appointment_date BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
    }
    query += ' ORDER BY a.appointment_date, a.appointment_time';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('appointments:getById', async (event, id) => {
    return db.prepare(`
      SELECT a.*, p.full_name as patient_name, u.full_name as professional_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.professional_id = u.id
      WHERE a.id = ?
    `).get(id);
  });

  ipcMain.handle('appointments:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const result = db.prepare(`
        INSERT INTO appointments (patient_id, professional_id, appointment_date, appointment_time, duration, type, status, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.patient_id, data.professional_id, data.appointment_date, data.appointment_time,
        data.duration || 30, data.type, data.status || 'agendada', data.notes, currentUser ? currentUser.id : null);
      logAudit(db, currentUser, 'CREATE', 'appointments', `Agendamento criado para ${data.appointment_date}`);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('appointments:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare(`
        UPDATE appointments SET patient_id=?, professional_id=?, appointment_date=?, appointment_time=?,
        duration=?, type=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(data.patient_id, data.professional_id, data.appointment_date, data.appointment_time,
        data.duration, data.type, data.status, data.notes, data.id);
      logAudit(db, currentUser, 'UPDATE', 'appointments', `Agendamento atualizado ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('appointments:delete', async (event, id) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
      logAudit(db, currentUser, 'DELETE', 'appointments', `Agendamento eliminado ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== CONSULTATIONS ==========
  ipcMain.handle('consultations:getAll', async (event, filters) => {
    let query = `SELECT c.*, p.full_name as patient_name, u.full_name as professional_name
                 FROM consultations c
                 LEFT JOIN patients p ON c.patient_id = p.id
                 LEFT JOIN users u ON c.professional_id = u.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.patient_id) { query += ' AND c.patient_id = ?'; params.push(filters.patient_id); }
      if (filters.professional_id) { query += ' AND c.professional_id = ?'; params.push(filters.professional_id); }
      if (filters.type) { query += ' AND c.type = ?'; params.push(filters.type); }
    }
    query += ' ORDER BY c.consultation_date DESC';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('consultations:getById', async (event, id) => {
    return db.prepare(`
      SELECT c.*, p.full_name as patient_name, p.birth_date as patient_birth_date, u.full_name as professional_name
      FROM consultations c
      LEFT JOIN patients p ON c.patient_id = p.id
      LEFT JOIN users u ON c.professional_id = u.id
      WHERE c.id = ?
    `).get(id);
  });

  ipcMain.handle('consultations:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const allowedColumns = [
        'patient_id', 'professional_id', 'appointment_id', 'type', 'consultation_date',
        'chief_complaint', 'medical_history', 'family_history', 'current_medications', 'allergies',
        'va_od_sc', 'va_od_cc', 'va_oe_sc', 'va_oe_cc',
        'auto_od_esf', 'auto_od_cil', 'auto_od_eixo', 'auto_oe_esf', 'auto_oe_cil', 'auto_oe_eixo',
        'ref_od_esf', 'ref_od_cil', 'ref_od_eixo', 'ref_od_add', 'ref_od_av',
        'ref_oe_esf', 'ref_oe_cil', 'ref_oe_eixo', 'ref_oe_add', 'ref_oe_av', 'ref_dp',
        'pio_od', 'pio_oe', 'pio_method', 'biomicroscopy_od', 'biomicroscopy_oe',
        'fundoscopy_od', 'fundoscopy_oe',
        'anamnesis_visual_symptoms', 'anamnesis_ocular_history', 'anamnesis_occupation',
        'anamnesis_screen_time', 'anamnesis_reading_distance', 'anamnesis_driving',
        'anamnesis_sports', 'anamnesis_current_glasses', 'anamnesis_last_exam_date', 'anamnesis_satisfaction',
        'cover_test_distance', 'cover_test_near', 'convergence_near_point', 'accommodation',
        'diagnosis', 'diagnosis_code', 'functional_diagnosis', 'treatment_plan', 'observations',
        'next_revision_date', 'status'
      ];
      const sanitized = {};
      for (const key of Object.keys(data)) {
        if (allowedColumns.includes(key)) sanitized[key] = data[key];
      }
      const columns = Object.keys(sanitized).join(', ');
      const placeholders = Object.keys(sanitized).map(() => '?').join(', ');
      const values = Object.values(sanitized);

      const result = db.prepare(`INSERT INTO consultations (${columns}) VALUES (${placeholders})`).run(...values);

      // Update appointment status if linked
      if (data.appointment_id) {
        db.prepare("UPDATE appointments SET status = 'concluida', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(data.appointment_id);
      }

      // Create revision if next_revision_date is set
      if (data.next_revision_date) {
        db.prepare(`
          INSERT INTO revisions (patient_id, consultation_id, scheduled_date, created_by)
          VALUES (?, ?, ?, ?)
        `).run(data.patient_id, result.lastInsertRowid, data.next_revision_date, currentUser ? currentUser.id : null);
      }

      logAudit(db, currentUser, 'CREATE', 'consultations', `Consulta criada para paciente ID: ${data.patient_id}`);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('consultations:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const id = data.id;
      delete data.id;
      const allowedColumns = [
        'patient_id', 'professional_id', 'appointment_id', 'type', 'consultation_date',
        'chief_complaint', 'medical_history', 'family_history', 'current_medications', 'allergies',
        'va_od_sc', 'va_od_cc', 'va_oe_sc', 'va_oe_cc',
        'auto_od_esf', 'auto_od_cil', 'auto_od_eixo', 'auto_oe_esf', 'auto_oe_cil', 'auto_oe_eixo',
        'ref_od_esf', 'ref_od_cil', 'ref_od_eixo', 'ref_od_add', 'ref_od_av',
        'ref_oe_esf', 'ref_oe_cil', 'ref_oe_eixo', 'ref_oe_add', 'ref_oe_av', 'ref_dp',
        'pio_od', 'pio_oe', 'pio_method', 'biomicroscopy_od', 'biomicroscopy_oe',
        'fundoscopy_od', 'fundoscopy_oe',
        'anamnesis_visual_symptoms', 'anamnesis_ocular_history', 'anamnesis_occupation',
        'anamnesis_screen_time', 'anamnesis_reading_distance', 'anamnesis_driving',
        'anamnesis_sports', 'anamnesis_current_glasses', 'anamnesis_last_exam_date', 'anamnesis_satisfaction',
        'cover_test_distance', 'cover_test_near', 'convergence_near_point', 'accommodation',
        'diagnosis', 'diagnosis_code', 'functional_diagnosis', 'treatment_plan', 'observations',
        'next_revision_date', 'status'
      ];
      const sanitized = {};
      for (const key of Object.keys(data)) {
        if (allowedColumns.includes(key)) sanitized[key] = data[key];
      }
      const sets = Object.keys(sanitized).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(sanitized), id];

      db.prepare(`UPDATE consultations SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
      logAudit(db, currentUser, 'UPDATE', 'consultations', `Consulta atualizada ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== PRESCRIPTIONS ==========
  ipcMain.handle('prescriptions:getAll', async (event, filters) => {
    let query = `SELECT pr.*, p.full_name as patient_name, u.full_name as professional_name
                 FROM prescriptions pr
                 LEFT JOIN patients p ON pr.patient_id = p.id
                 LEFT JOIN users u ON pr.professional_id = u.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.patient_id) { query += ' AND pr.patient_id = ?'; params.push(filters.patient_id); }
      if (filters.professional_id) { query += ' AND pr.professional_id = ?'; params.push(filters.professional_id); }
    }
    query += ' ORDER BY pr.prescription_date DESC';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('prescriptions:getById', async (event, id) => {
    return db.prepare(`
      SELECT pr.*, p.full_name as patient_name, p.birth_date, u.full_name as professional_name, u.profile as professional_profile
      FROM prescriptions pr
      LEFT JOIN patients p ON pr.patient_id = p.id
      LEFT JOIN users u ON pr.professional_id = u.id
      WHERE pr.id = ?
    `).get(id);
  });

  ipcMain.handle('prescriptions:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const allowedColumns = [
        'consultation_id', 'patient_id', 'professional_id', 'prescription_date',
        'rx_od_esf', 'rx_od_cil', 'rx_od_eixo', 'rx_od_add', 'rx_od_prisma', 'rx_od_base',
        'rx_oe_esf', 'rx_oe_cil', 'rx_oe_eixo', 'rx_oe_add', 'rx_oe_prisma', 'rx_oe_base',
        'rx_dp', 'rx_dp_near', 'lens_type', 'lens_material', 'lens_treatment',
        'frame_notes', 'observations', 'valid_until', 'printed'
      ];
      const sanitized = {};
      for (const key of Object.keys(data)) {
        if (allowedColumns.includes(key)) sanitized[key] = data[key];
      }
      const columns = Object.keys(sanitized).join(', ');
      const placeholders = Object.keys(sanitized).map(() => '?').join(', ');
      const result = db.prepare(`INSERT INTO prescriptions (${columns}) VALUES (${placeholders})`).run(...Object.values(sanitized));
      logAudit(db, currentUser, 'CREATE', 'prescriptions', `Receita criada para paciente ID: ${data.patient_id}`);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prescriptions:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const id = data.id;
      delete data.id;
      const allowedColumns = [
        'consultation_id', 'patient_id', 'professional_id', 'prescription_date',
        'rx_od_esf', 'rx_od_cil', 'rx_od_eixo', 'rx_od_add', 'rx_od_prisma', 'rx_od_base',
        'rx_oe_esf', 'rx_oe_cil', 'rx_oe_eixo', 'rx_oe_add', 'rx_oe_prisma', 'rx_oe_base',
        'rx_dp', 'rx_dp_near', 'lens_type', 'lens_material', 'lens_treatment',
        'frame_notes', 'observations', 'valid_until', 'printed'
      ];
      const sanitized = {};
      for (const key of Object.keys(data)) {
        if (allowedColumns.includes(key)) sanitized[key] = data[key];
      }
      const sets = Object.keys(sanitized).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE prescriptions SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...Object.values(sanitized), id);
      logAudit(db, currentUser, 'UPDATE', 'prescriptions', `Receita atualizada ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('prescriptions:print', async (event, id) => {
    try {
      db.prepare('UPDATE prescriptions SET printed = 1 WHERE id = ?').run(id);
      logAudit(db, currentUser, 'PRINT', 'prescriptions', `Receita impressa ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== SALES ==========
  ipcMain.handle('sales:getAll', async (event, filters) => {
    let query = `SELECT s.*, p.full_name as patient_name
                 FROM sales s
                 LEFT JOIN patients p ON s.patient_id = p.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.status) { query += ' AND s.status = ?'; params.push(filters.status); }
      if (filters.patient_id) { query += ' AND s.patient_id = ?'; params.push(filters.patient_id); }
      if (filters.startDate && filters.endDate) {
        query += ' AND date(s.sale_date) BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
    }
    query += ' ORDER BY s.sale_date DESC';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('sales:getById', async (event, id) => {
    const sale = db.prepare(`
      SELECT s.*, p.full_name as patient_name, p.phone as patient_phone
      FROM sales s LEFT JOIN patients p ON s.patient_id = p.id WHERE s.id = ?
    `).get(id);
    if (sale) {
      sale.items = db.prepare(`
        SELECT si.*, st.name as item_name, st.code as item_code
        FROM sale_items si LEFT JOIN stock_items st ON si.stock_item_id = st.id
        WHERE si.sale_id = ?
      `).all(id);
    }
    return sale;
  });

  ipcMain.handle('sales:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const code = generateCode(db, 'VND');

      const insertSale = db.prepare(`
        INSERT INTO sales (code, patient_id, prescription_id, seller_id, subtotal, discount, total, payment_method, payment_status, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertItem = db.prepare(`
        INSERT INTO sale_items (sale_id, stock_item_id, description, quantity, unit_price, discount, total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const updateStock = db.prepare(`
        UPDATE stock_items SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `);

      const insertMovement = db.prepare(`
        INSERT INTO stock_movements (stock_item_id, type, quantity, reason, reference_type, created_by)
        VALUES (?, 'saida', ?, 'Venda', 'sale', ?)
      `);

      const transaction = db.transaction(() => {
        const result = insertSale.run(code, data.patient_id, data.prescription_id || null,
          currentUser ? currentUser.id : null, data.subtotal, data.discount || 0, data.total,
          data.payment_method, data.payment_status || 'pendente', data.status || 'producao', data.notes || null);

        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            insertItem.run(result.lastInsertRowid, item.stock_item_id || null, item.description,
              item.quantity, item.unit_price, item.discount || 0, item.total);
            if (item.stock_item_id) {
              updateStock.run(item.quantity, item.stock_item_id);
              insertMovement.run(item.stock_item_id, item.quantity, currentUser ? currentUser.id : null);
            }
          }
        }
        return result.lastInsertRowid;
      });

      const saleId = transaction();
      logAudit(db, currentUser, 'CREATE', 'sales', `Venda criada: ${code}`);
      return { success: true, id: saleId, code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sales:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare(`
        UPDATE sales SET payment_method=?, payment_status=?, discount=?, total=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(data.payment_method, data.payment_status, data.discount, data.total, data.notes, data.id);
      logAudit(db, currentUser, 'UPDATE', 'sales', `Venda atualizada ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sales:updateStatus', async (event, { id, status }) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare('UPDATE sales SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
      logAudit(db, currentUser, 'UPDATE', 'sales', `Estado da venda ${id} alterado para: ${status}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== STOCK ==========
  ipcMain.handle('stock:getAll', async (event, filters) => {
    let query = `SELECT s.*, c.name as category_name
                 FROM stock_items s LEFT JOIN stock_categories c ON s.category_id = c.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.category_id) { query += ' AND s.category_id = ?'; params.push(filters.category_id); }
      if (filters.search) {
        query += ' AND (s.name LIKE ? OR s.code LIKE ? OR s.brand LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
      }
      if (filters.lowStock) { query += ' AND s.quantity <= s.min_quantity'; }
      if (filters.active !== undefined) { query += ' AND s.active = ?'; params.push(filters.active); }
    }
    query += ' ORDER BY s.name';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('stock:getById', async (event, id) => {
    const item = db.prepare(`
      SELECT s.*, c.name as category_name
      FROM stock_items s LEFT JOIN stock_categories c ON s.category_id = c.id WHERE s.id = ?
    `).get(id);
    if (item) {
      item.movements = db.prepare(`
        SELECT m.*, u.full_name as user_name
        FROM stock_movements m LEFT JOIN users u ON m.created_by = u.id
        WHERE m.stock_item_id = ? ORDER BY m.created_at DESC LIMIT 50
      `).all(id);
    }
    return item;
  });

  ipcMain.handle('stock:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const code = generateCode(db, 'STK');
      const result = db.prepare(`
        INSERT INTO stock_items (code, name, category_id, brand, model, description, purchase_price, sale_price, quantity, min_quantity, location, supplier, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, data.name, data.category_id, data.brand, data.model, data.description,
        data.purchase_price || 0, data.sale_price || 0, data.quantity || 0, data.min_quantity || 5,
        data.location, data.supplier, currentUser ? currentUser.id : null);

      if (data.quantity > 0) {
        db.prepare(`
          INSERT INTO stock_movements (stock_item_id, type, quantity, reason, created_by)
          VALUES (?, 'entrada', ?, 'Stock inicial', ?)
        `).run(result.lastInsertRowid, data.quantity, currentUser ? currentUser.id : null);
      }

      logAudit(db, currentUser, 'CREATE', 'stock', `Artigo criado: ${data.name} (${code})`);
      return { success: true, id: result.lastInsertRowid, code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const current = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(data.id);
      db.prepare(`
        UPDATE stock_items SET name=?, category_id=?, brand=?, model=?, description=?,
        purchase_price=?, sale_price=?, quantity=?, min_quantity=?, location=?, supplier=?,
        active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(data.name, data.category_id, data.brand, data.model, data.description,
        data.purchase_price, data.sale_price, data.quantity, data.min_quantity, data.location,
        data.supplier, data.active !== undefined ? (data.active ? 1 : 0) : 1, data.id);

      if (current && current.quantity !== data.quantity) {
        const diff = data.quantity - current.quantity;
        db.prepare(`
          INSERT INTO stock_movements (stock_item_id, type, quantity, reason, created_by)
          VALUES (?, ?, ?, 'Ajuste manual', ?)
        `).run(data.id, diff > 0 ? 'entrada' : 'ajuste', Math.abs(diff), currentUser ? currentUser.id : null);
      }

      logAudit(db, currentUser, 'UPDATE', 'stock', `Artigo atualizado ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:delete', async (event, id) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare('UPDATE stock_items SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      logAudit(db, currentUser, 'DELETE', 'stock', `Artigo desativado ID: ${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:getAlerts', async () => {
    return db.prepare(`
      SELECT s.*, c.name as category_name
      FROM stock_items s LEFT JOIN stock_categories c ON s.category_id = c.id
      WHERE s.quantity <= s.min_quantity AND s.active = 1
      ORDER BY s.quantity ASC
    `).all();
  });

  // ========== ORDERS ==========
  ipcMain.handle('orders:getAll', async (event, filters) => {
    let query = `SELECT o.*, p.full_name as patient_name
                 FROM orders o LEFT JOIN patients p ON o.patient_id = p.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.status) { query += ' AND o.status = ?'; params.push(filters.status); }
    }
    query += ' ORDER BY o.created_at DESC';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('orders:getById', async (event, id) => {
    return db.prepare(`
      SELECT o.*, p.full_name as patient_name
      FROM orders o LEFT JOIN patients p ON o.patient_id = p.id WHERE o.id = ?
    `).get(id);
  });

  ipcMain.handle('orders:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const code = generateCode(db, 'ENC');
      const result = db.prepare(`
        INSERT INTO orders (code, sale_id, patient_id, supplier, description, quantity, unit_price, total, status, expected_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, data.sale_id || null, data.patient_id || null, data.supplier, data.description,
        data.quantity || 1, data.unit_price || 0, data.total || 0, 'pendente', data.expected_date,
        data.notes, currentUser ? currentUser.id : null);
      logAudit(db, currentUser, 'CREATE', 'orders', `Encomenda criada: ${code}`);
      return { success: true, id: result.lastInsertRowid, code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orders:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare(`
        UPDATE orders SET supplier=?, description=?, quantity=?, unit_price=?, total=?,
        expected_date=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(data.supplier, data.description, data.quantity, data.unit_price, data.total,
        data.expected_date, data.notes, data.id);
      logAudit(db, currentUser, 'UPDATE', 'orders', `Encomenda atualizada ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('orders:updateStatus', async (event, { id, status }) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const updates = { status, updated_at: 'CURRENT_TIMESTAMP' };
      if (status === 'recebida') {
        db.prepare('UPDATE orders SET status = ?, received_date = date("now"), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
      } else {
        db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
      }
      logAudit(db, currentUser, 'UPDATE', 'orders', `Estado da encomenda ${id} alterado para: ${status}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== LABORATORY ==========
  ipcMain.handle('lab:getAll', async (event, filters) => {
    let query = `SELECT l.*, p.full_name as patient_name, u.full_name as assigned_name
                 FROM lab_orders l
                 LEFT JOIN patients p ON l.patient_id = p.id
                 LEFT JOIN users u ON l.assigned_to = u.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.status) { query += ' AND l.status = ?'; params.push(filters.status); }
      if (filters.priority) { query += ' AND l.priority = ?'; params.push(filters.priority); }
    }
    query += ' ORDER BY CASE l.priority WHEN "urgente" THEN 0 ELSE 1 END, l.created_at DESC';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('lab:getById', async (event, id) => {
    return db.prepare(`
      SELECT l.*, p.full_name as patient_name, u.full_name as assigned_name
      FROM lab_orders l
      LEFT JOIN patients p ON l.patient_id = p.id
      LEFT JOIN users u ON l.assigned_to = u.id WHERE l.id = ?
    `).get(id);
  });

  ipcMain.handle('lab:create', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const code = generateCode(db, 'LAB');
      const result = db.prepare(`
        INSERT INTO lab_orders (code, sale_id, patient_id, prescription_id, lens_type, lens_material, lens_treatment,
        lab_od_esf, lab_od_cil, lab_od_eixo, lab_od_add, lab_oe_esf, lab_oe_cil, lab_oe_eixo, lab_oe_add, lab_dp,
        frame_brand, frame_model, frame_color, frame_size, priority, assigned_to, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, data.sale_id || null, data.patient_id, data.prescription_id || null,
        data.lens_type, data.lens_material, data.lens_treatment,
        data.lab_od_esf, data.lab_od_cil, data.lab_od_eixo, data.lab_od_add,
        data.lab_oe_esf, data.lab_oe_cil, data.lab_oe_eixo, data.lab_oe_add, data.lab_dp,
        data.frame_brand, data.frame_model, data.frame_color, data.frame_size,
        data.priority || 'normal', data.assigned_to || null, data.notes,
        currentUser ? currentUser.id : null);
      logAudit(db, currentUser, 'CREATE', 'lab', `Ordem de laboratório criada: ${code}`);
      return { success: true, id: result.lastInsertRowid, code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('lab:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      db.prepare(`
        UPDATE lab_orders SET lens_type=?, lens_material=?, lens_treatment=?,
        lab_od_esf=?, lab_od_cil=?, lab_od_eixo=?, lab_od_add=?,
        lab_oe_esf=?, lab_oe_cil=?, lab_oe_eixo=?, lab_oe_add=?, lab_dp=?,
        frame_brand=?, frame_model=?, frame_color=?, frame_size=?,
        priority=?, assigned_to=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(data.lens_type, data.lens_material, data.lens_treatment,
        data.lab_od_esf, data.lab_od_cil, data.lab_od_eixo, data.lab_od_add,
        data.lab_oe_esf, data.lab_oe_cil, data.lab_oe_eixo, data.lab_oe_add, data.lab_dp,
        data.frame_brand, data.frame_model, data.frame_color, data.frame_size,
        data.priority, data.assigned_to, data.notes, data.id);
      logAudit(db, currentUser, 'UPDATE', 'lab', `Ordem de laboratório atualizada ID: ${data.id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('lab:updateStatus', async (event, { id, status }) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const updates = {};
      if (status === 'em_producao') updates.start_date = new Date().toISOString();
      if (status === 'pronto' || status === 'entregue') updates.completion_date = new Date().toISOString();

      let sql = 'UPDATE lab_orders SET status = ?';
      const params = [status];
      if (updates.start_date) { sql += ', start_date = ?'; params.push(updates.start_date); }
      if (updates.completion_date) { sql += ', completion_date = ?'; params.push(updates.completion_date); }
      sql += ', updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      params.push(id);

      db.prepare(sql).run(...params);
      logAudit(db, currentUser, 'UPDATE', 'lab', `Estado do laboratório ${id} alterado para: ${status}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== DASHBOARD ==========
  ipcMain.handle('dashboard:getStats', async () => {
    const today = new Date().toISOString().split('T')[0];
    return {
      todayAppointments: db.prepare("SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?").get(today).count,
      totalPatients: db.prepare("SELECT COUNT(*) as count FROM patients").get().count,
      pendingSales: db.prepare("SELECT COUNT(*) as count FROM sales WHERE status = 'producao'").get().count,
      lowStock: db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE quantity <= min_quantity AND active = 1").get().count,
      pendingOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pendente', 'encomendada')").get().count,
      pendingLab: db.prepare("SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('pendente', 'em_producao')").get().count,
      monthRevenue: db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now') AND status != 'cancelada'").get().total,
      upcomingRevisions: db.prepare("SELECT COUNT(*) as count FROM revisions WHERE scheduled_date BETWEEN date('now') AND date('now', '+7 days') AND status = 'pendente'").get().count,
      todayConsultations: db.prepare("SELECT COUNT(*) as count FROM consultations WHERE date(consultation_date) = ?").get(today).count,
      readySales: db.prepare("SELECT COUNT(*) as count FROM sales WHERE status = 'pronto'").get().count
    };
  });

  ipcMain.handle('dashboard:getAlerts', async () => {
    const alerts = [];

    // Low stock alerts
    const lowStock = db.prepare("SELECT name, quantity, min_quantity FROM stock_items WHERE quantity <= min_quantity AND active = 1 LIMIT 10").all();
    lowStock.forEach(item => {
      alerts.push({ type: 'stock', severity: item.quantity === 0 ? 'critical' : 'warning', message: `Stock baixo: ${item.name} (${item.quantity}/${item.min_quantity})` });
    });

    // Upcoming revisions
    const revisions = db.prepare(`
      SELECT r.*, p.full_name as patient_name
      FROM revisions r LEFT JOIN patients p ON r.patient_id = p.id
      WHERE r.scheduled_date BETWEEN date('now') AND date('now', '+7 days') AND r.status = 'pendente'
      LIMIT 10
    `).all();
    revisions.forEach(rev => {
      alerts.push({ type: 'revision', severity: 'info', message: `Revisão agendada: ${rev.patient_name} em ${rev.scheduled_date}` });
    });

    // Pending orders
    const orders = db.prepare("SELECT code, description, supplier FROM orders WHERE status = 'pendente' LIMIT 5").all();
    orders.forEach(order => {
      alerts.push({ type: 'order', severity: 'warning', message: `Encomenda pendente: ${order.code} - ${order.description}` });
    });

    // Pending lab
    const labOrders = db.prepare(`
      SELECT l.code, p.full_name as patient_name
      FROM lab_orders l LEFT JOIN patients p ON l.patient_id = p.id
      WHERE l.status IN ('pendente', 'em_producao') AND l.priority = 'urgente' LIMIT 5
    `).all();
    labOrders.forEach(lab => {
      alerts.push({ type: 'lab', severity: 'critical', message: `Laboratório urgente: ${lab.code} - ${lab.patient_name}` });
    });

    return alerts;
  });

  // ========== REVISIONS ==========
  ipcMain.handle('revisions:getAll', async (event, filters) => {
    let query = `SELECT r.*, p.full_name as patient_name, p.phone as patient_phone
                 FROM revisions r LEFT JOIN patients p ON r.patient_id = p.id WHERE 1=1`;
    const params = [];
    if (filters) {
      if (filters.status) { query += ' AND r.status = ?'; params.push(filters.status); }
      if (filters.startDate && filters.endDate) {
        query += ' AND r.scheduled_date BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
    }
    query += ' ORDER BY r.scheduled_date';
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('revisions:getUpcoming', async () => {
    return db.prepare(`
      SELECT r.*, p.full_name as patient_name, p.phone as patient_phone
      FROM revisions r LEFT JOIN patients p ON r.patient_id = p.id
      WHERE r.scheduled_date BETWEEN date('now') AND date('now', '+7 days') AND r.status = 'pendente'
      ORDER BY r.scheduled_date
    `).all();
  });

  // ========== AUDIT ==========
  ipcMain.handle('audit:getAll', async (event, filters) => {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (filters) {
      if (filters.user_id) { query += ' AND user_id = ?'; params.push(filters.user_id); }
      if (filters.module) { query += ' AND module = ?'; params.push(filters.module); }
      if (filters.action) { query += ' AND action = ?'; params.push(filters.action); }
      if (filters.startDate && filters.endDate) {
        query += ' AND date(created_at) BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
    }
    query += ' ORDER BY created_at DESC LIMIT 500';
    return db.prepare(query).all(...params);
  });

  // ========== BACKUP ==========
  ipcMain.handle('backup:selectPath', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar pasta para backup'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('backup:create', async (event, backupPath) => {
    try {
      const { getDbPath } = require('./database');
      const dbPath = getDbPath();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `gestpro_backup_${timestamp}.db`;
      const destPath = backupPath ? path.join(backupPath, fileName) : path.join(app.getPath('userData'), 'backups', fileName);

      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Use SQLite backup API
      db.backup(destPath);

      logAudit(db, currentUser, 'BACKUP', 'system', `Backup criado: ${destPath}`);
      return { success: true, path: destPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:restore', async (event, backupPath) => {
    try {
      if (!backupPath) {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Database', extensions: ['db'] }],
          title: 'Selecionar ficheiro de backup'
        });
        if (result.canceled) return { success: false, error: 'Cancelado' };
        backupPath = result.filePaths[0];
      }

      const { getDbPath } = require('./database');
      const dbPath = getDbPath();

      // Log before closing the db
      logAudit(db, currentUser, 'RESTORE', 'system', `Backup restaurado de: ${backupPath}`);

      // Close current connection and copy
      db.close();
      fs.copyFileSync(backupPath, dbPath);

      return { success: true, message: 'Backup restaurado. Reinicie a aplicação.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== LICENSE ==========
  ipcMain.handle('license:getDeviceId', async () => {
    const { machineIdSync } = require('node-machine-id');
    return machineIdSync(true);
  });

  ipcMain.handle('license:getInfo', async () => {
    const license = db.prepare('SELECT * FROM license ORDER BY id DESC LIMIT 1').get();
    if (!license) return { active: false, daysRemaining: 0 };

    const now = new Date();
    const expDate = new Date(license.expiration_date);
    const daysRemaining = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

    return {
      active: daysRemaining > 0,
      licenseKey: license.license_key,
      activationDate: license.activation_date,
      expirationDate: license.expiration_date,
      daysRemaining: Math.max(0, daysRemaining),
      deviceId: license.device_id
    };
  });

  ipcMain.handle('license:activate', async (event, key) => {
    try {
      const { machineIdSync } = require('node-machine-id');
      const deviceId = machineIdSync(true);

      // Validate key format: XXXXX-XXXXX-XXXXX-XXXXX
      if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)) {
        return { success: false, error: 'Formato de chave inválido' };
      }

      const activationDate = new Date().toISOString().split('T')[0];
      const expirationDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      db.prepare('DELETE FROM license').run();
      db.prepare(`
        INSERT INTO license (device_id, license_key, activation_date, expiration_date, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(deviceId, key, activationDate, expirationDate);

      logAudit(db, currentUser, 'LICENSE', 'system', `Licença ativada: ${key}`);
      return { success: true, activationDate, expirationDate };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ========== SETTINGS ==========
  ipcMain.handle('settings:getAll', async () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
  });

  ipcMain.handle('settings:update', async (event, data) => {
    try {
      if (!isLicenseValid(db)) return { success: false, error: 'Licença expirada. Modo somente leitura.' };
      const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, category) VALUES (?, ?, ?)');
      Object.entries(data).forEach(([key, value]) => {
        update.run(key, String(value), 'general');
      });
      logAudit(db, currentUser, 'UPDATE', 'settings', 'Configurações atualizadas');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getServerInfo', async () => {
    return store.get('serverInfo') || { ip: getLocalIP(), port: 3847 };
  });
}

// ========== HELPERS ==========
function generateCode(db, prefix) {
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const base = `${prefix}${year}${month}`;

  const last = db.prepare(
    `SELECT code FROM ${getTableForPrefix(prefix)} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`
  ).get(`${base}%`);

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.code.slice(base.length), 10);
    seq = lastSeq + 1;
  }
  return `${base}${String(seq).padStart(4, '0')}`;
}

function getTableForPrefix(prefix) {
  const map = {
    'PAC': 'patients',
    'VND': 'sales',
    'STK': 'stock_items',
    'ENC': 'orders',
    'LAB': 'lab_orders'
  };
  return map[prefix] || 'patients';
}

function logAudit(db, user, action, module, description) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, username, user_profile, action, module, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user ? user.id : null,
      user ? user.username : 'system',
      user ? user.profile : 'system',
      action, module, description
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

function checkLicense(db) {
  const license = db.prepare('SELECT * FROM license ORDER BY id DESC LIMIT 1').get();
  if (!license) return { active: false, daysRemaining: 0, message: 'Sem licença ativa' };

  const now = new Date();
  const expDate = new Date(license.expiration_date);
  const daysRemaining = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

  return {
    active: daysRemaining > 0,
    daysRemaining: Math.max(0, daysRemaining),
    expirationDate: license.expiration_date
  };
}

function isLicenseValid(db) {
  const license = checkLicense(db);
  // If no license exists, allow usage (first time use grace period)
  const hasLicense = db.prepare('SELECT COUNT(*) as count FROM license').get().count;
  if (hasLicense === 0) return true;
  return license.active;
}

module.exports = { setupIPC };
