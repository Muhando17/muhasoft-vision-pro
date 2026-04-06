const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Navigation
  navigate: (page) => ipcRenderer.send('navigate', page),
  navigateMain: (page) => ipcRenderer.send('navigate-main', page),

  // Auth
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  changePassword: (data) => ipcRenderer.invoke('auth:changePassword', data),

  // Users
  getUsers: () => ipcRenderer.invoke('users:getAll'),
  createUser: (data) => ipcRenderer.invoke('users:create', data),
  updateUser: (data) => ipcRenderer.invoke('users:update', data),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', id),

  // Patients
  getPatients: (search) => ipcRenderer.invoke('patients:getAll', search),
  getPatient: (id) => ipcRenderer.invoke('patients:getById', id),
  createPatient: (data) => ipcRenderer.invoke('patients:create', data),
  updatePatient: (data) => ipcRenderer.invoke('patients:update', data),
  deletePatient: (id) => ipcRenderer.invoke('patients:delete', id),

  // Appointments
  getAppointments: (filters) => ipcRenderer.invoke('appointments:getAll', filters),
  getAppointment: (id) => ipcRenderer.invoke('appointments:getById', id),
  createAppointment: (data) => ipcRenderer.invoke('appointments:create', data),
  updateAppointment: (data) => ipcRenderer.invoke('appointments:update', data),
  deleteAppointment: (id) => ipcRenderer.invoke('appointments:delete', id),

  // Consultations
  getConsultations: (filters) => ipcRenderer.invoke('consultations:getAll', filters),
  getConsultation: (id) => ipcRenderer.invoke('consultations:getById', id),
  createConsultation: (data) => ipcRenderer.invoke('consultations:create', data),
  updateConsultation: (data) => ipcRenderer.invoke('consultations:update', data),

  // Prescriptions
  getPrescriptions: (filters) => ipcRenderer.invoke('prescriptions:getAll', filters),
  getPrescription: (id) => ipcRenderer.invoke('prescriptions:getById', id),
  createPrescription: (data) => ipcRenderer.invoke('prescriptions:create', data),
  updatePrescription: (data) => ipcRenderer.invoke('prescriptions:update', data),
  printPrescription: (id) => ipcRenderer.invoke('prescriptions:print', id),

  // Sales
  getSales: (filters) => ipcRenderer.invoke('sales:getAll', filters),
  getSale: (id) => ipcRenderer.invoke('sales:getById', id),
  createSale: (data) => ipcRenderer.invoke('sales:create', data),
  updateSale: (data) => ipcRenderer.invoke('sales:update', data),
  updateSaleStatus: (data) => ipcRenderer.invoke('sales:updateStatus', data),

  // Stock
  getStock: (filters) => ipcRenderer.invoke('stock:getAll', filters),
  getStockItem: (id) => ipcRenderer.invoke('stock:getById', id),
  createStockItem: (data) => ipcRenderer.invoke('stock:create', data),
  updateStockItem: (data) => ipcRenderer.invoke('stock:update', data),
  deleteStockItem: (id) => ipcRenderer.invoke('stock:delete', id),
  getStockAlerts: () => ipcRenderer.invoke('stock:getAlerts'),

  // Orders
  getOrders: (filters) => ipcRenderer.invoke('orders:getAll', filters),
  getOrder: (id) => ipcRenderer.invoke('orders:getById', id),
  createOrder: (data) => ipcRenderer.invoke('orders:create', data),
  updateOrder: (data) => ipcRenderer.invoke('orders:update', data),
  updateOrderStatus: (data) => ipcRenderer.invoke('orders:updateStatus', data),

  // Laboratory
  getLabOrders: (filters) => ipcRenderer.invoke('lab:getAll', filters),
  getLabOrder: (id) => ipcRenderer.invoke('lab:getById', id),
  createLabOrder: (data) => ipcRenderer.invoke('lab:create', data),
  updateLabOrder: (data) => ipcRenderer.invoke('lab:update', data),
  updateLabStatus: (data) => ipcRenderer.invoke('lab:updateStatus', data),

  // Dashboard
  getDashboardStats: () => ipcRenderer.invoke('dashboard:getStats'),
  getDashboardAlerts: () => ipcRenderer.invoke('dashboard:getAlerts'),

  // Revisions
  getRevisions: (filters) => ipcRenderer.invoke('revisions:getAll', filters),
  getUpcomingRevisions: () => ipcRenderer.invoke('revisions:getUpcoming'),

  // Audit
  getAuditLogs: (filters) => ipcRenderer.invoke('audit:getAll', filters),

  // Backup
  createBackup: (path) => ipcRenderer.invoke('backup:create', path),
  restoreBackup: (path) => ipcRenderer.invoke('backup:restore', path),
  selectBackupPath: () => ipcRenderer.invoke('backup:selectPath'),

  // License
  getLicenseInfo: () => ipcRenderer.invoke('license:getInfo'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  getDeviceId: () => ipcRenderer.invoke('license:getDeviceId'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  updateSettings: (data) => ipcRenderer.invoke('settings:update', data),
  getServerInfo: () => ipcRenderer.invoke('settings:getServerInfo'),

  // Events
  onNotification: (callback) => ipcRenderer.on('notification', (event, data) => callback(data)),
  onLicenseWarning: (callback) => ipcRenderer.on('license-warning', (event, data) => callback(data))
});
