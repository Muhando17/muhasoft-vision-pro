const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

let server;
let io;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

async function startServer(db) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', name: 'Muhasoft GestPro Server' });
  });

  // API routes for LAN clients
  setupApiRoutes(app, db);

  server = http.createServer(app);

  // Socket.IO for real-time sync
  io = new Server(server, {
    cors: { origin: '*' }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('data-change', (data) => {
      // Broadcast changes to all other clients
      socket.broadcast.emit('data-updated', data);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  const port = 3847;
  const localIP = getLocalIP();

  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      const info = {
        ip: localIP,
        port: port,
        url: `http://${localIP}:${port}`
      };
      console.log(`Server running at ${info.url}`);
      resolve(info);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try next port
        server.listen(port + 1, '0.0.0.0', () => {
          const info = {
            ip: localIP,
            port: port + 1,
            url: `http://${localIP}:${port + 1}`
          };
          console.log(`Server running at ${info.url}`);
          resolve(info);
        });
      } else {
        reject(err);
      }
    });
  });
}

function setupApiRoutes(app, db) {
  // Middleware for JSON errors
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next();
  });

  // Patients API
  app.get('/api/patients', (req, res) => {
    try {
      const search = req.query.search || '';
      let patients;
      if (search) {
        patients = db.prepare(
          "SELECT * FROM patients WHERE full_name LIKE ? OR code LIKE ? OR phone LIKE ? ORDER BY full_name"
        ).all(`%${search}%`, `%${search}%`, `%${search}%`);
      } else {
        patients = db.prepare("SELECT * FROM patients ORDER BY full_name").all();
      }
      res.json(patients);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/patients/:id', (req, res) => {
    try {
      const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(req.params.id);
      res.json(patient || null);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Appointments API
  app.get('/api/appointments', (req, res) => {
    try {
      const { date, professional_id, status } = req.query;
      let query = `SELECT a.*, p.full_name as patient_name, u.full_name as professional_name 
                    FROM appointments a 
                    LEFT JOIN patients p ON a.patient_id = p.id 
                    LEFT JOIN users u ON a.professional_id = u.id WHERE 1=1`;
      const params = [];
      if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
      if (professional_id) { query += ' AND a.professional_id = ?'; params.push(professional_id); }
      if (status) { query += ' AND a.status = ?'; params.push(status); }
      query += ' ORDER BY a.appointment_date, a.appointment_time';
      res.json(db.prepare(query).all(...params));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Stock API
  app.get('/api/stock', (req, res) => {
    try {
      const items = db.prepare(`
        SELECT s.*, c.name as category_name 
        FROM stock_items s 
        LEFT JOIN stock_categories c ON s.category_id = c.id 
        ORDER BY s.name
      `).all();
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Dashboard stats API
  app.get('/api/dashboard/stats', (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const stats = {
        todayAppointments: db.prepare("SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?").get(today).count,
        totalPatients: db.prepare("SELECT COUNT(*) as count FROM patients").get().count,
        pendingSales: db.prepare("SELECT COUNT(*) as count FROM sales WHERE status = 'producao'").get().count,
        lowStock: db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE quantity <= min_quantity AND active = 1").get().count,
        pendingOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pendente', 'encomendada')").get().count,
        pendingLab: db.prepare("SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('pendente', 'em_producao')").get().count,
        monthRevenue: db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now') AND status != 'cancelada'").get().total,
        upcomingRevisions: db.prepare("SELECT COUNT(*) as count FROM revisions WHERE scheduled_date BETWEEN date('now') AND date('now', '+7 days') AND status = 'pendente'").get().count
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

function getIO() {
  return io;
}

module.exports = { startServer, getIO, getLocalIP };
