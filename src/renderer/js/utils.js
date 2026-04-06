// ========== UTILITY FUNCTIONS ==========

function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT') + ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(value) {
  return parseFloat(value || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'MZN' });
}

function formatStatus(status) {
  const map = {
    'agendada': '<span class="badge badge-info">Agendada</span>',
    'confirmada': '<span class="badge badge-success">Confirmada</span>',
    'em_atendimento': '<span class="badge badge-warning">Em Atendimento</span>',
    'concluida': '<span class="badge badge-secondary">Concluida</span>',
    'cancelada': '<span class="badge badge-danger">Cancelada</span>',
    'faltou': '<span class="badge badge-danger">Faltou</span>',
    'pendente': '<span class="badge badge-warning">Pendente</span>',
    'producao': '<span class="badge badge-info">Producao</span>',
    'pronto': '<span class="badge badge-success">Pronto</span>',
    'entregue': '<span class="badge badge-secondary">Entregue</span>',
    'encomendada': '<span class="badge badge-info">Encomendada</span>',
    'recebida': '<span class="badge badge-success">Recebida</span>',
    'em_producao': '<span class="badge badge-warning">Em Producao</span>',
    'controle_qualidade': '<span class="badge badge-purple">Controle Qualidade</span>',
    'em_andamento': '<span class="badge badge-info">Em Andamento</span>',
    'pago': '<span class="badge badge-success">Pago</span>',
    'parcial': '<span class="badge badge-warning">Parcial</span>',
    'notificada': '<span class="badge badge-info">Notificada</span>',
    'realizada': '<span class="badge badge-success">Realizada</span>',
    'normal': '<span class="badge badge-secondary">Normal</span>',
    'urgente': '<span class="badge badge-danger">Urgente</span>',
    'active': '<span class="badge badge-success">Ativa</span>',
    'expired': '<span class="badge badge-danger">Expirada</span>'
  };
  return map[status] || `<span class="badge badge-secondary">${status || '-'}</span>`;
}

function formatProfile(profile) {
  const map = {
    'admin': 'Administrador',
    'oftalmologista': 'Oftalmologista',
    'optometrista': 'Optometrista',
    'rececao': 'Recepcao',
    'laboratorio': 'Laboratorio',
    'stock': 'Stock'
  };
  return map[profile] || profile;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Setup navigation
function setupNavigation(activeItem) {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    if (item.dataset.page === activeItem) {
      item.classList.add('active');
    }
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page) window.api.navigate(page);
    });
  });

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await window.api.logout();
      window.api.navigate('login.html');
    });
  }
}

// Load user info in sidebar
async function loadUserInfo() {
  const user = await window.api.getCurrentUser();
  if (!user) {
    window.api.navigate('login.html');
    return null;
  }

  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  const avatarEl = document.getElementById('userAvatar');

  if (nameEl) nameEl.textContent = user.full_name;
  if (roleEl) roleEl.textContent = formatProfile(user.profile);
  if (avatarEl) avatarEl.textContent = user.full_name.charAt(0).toUpperCase();

  // Check license
  try {
    const license = await window.api.getLicenseInfo();
    if (license && license.active && license.daysRemaining <= 30) {
      const banner = document.getElementById('licenseBanner');
      if (banner) {
        banner.textContent = `Licenca expira em ${license.daysRemaining} dias`;
        banner.style.display = 'block';
      }
    } else if (license && !license.active && license.daysRemaining === 0) {
      const banner = document.getElementById('licenseBanner');
      if (banner) {
        banner.textContent = 'Licenca expirada! Sistema em modo somente leitura.';
        banner.className = 'license-banner license-expired';
        banner.style.display = 'block';
      }
    }
  } catch (e) {
    // License check failed silently
  }

  // Apply permissions - hide menu items based on profile
  applyPermissions(user.profile);

  return user;
}

function applyPermissions(profile) {
  const permissionMap = {
    'admin': ['*'],
    'oftalmologista': ['dashboard', 'appointments', 'patients', 'consultations', 'prescriptions'],
    'optometrista': ['dashboard', 'appointments', 'patients', 'consultations', 'prescriptions'],
    'rececao': ['dashboard', 'appointments', 'patients', 'sales', 'revisions'],
    'laboratorio': ['dashboard', 'lab', 'stock'],
    'stock': ['dashboard', 'stock', 'orders']
  };

  const allowed = permissionMap[profile] || [];
  if (allowed.includes('*')) return;

  document.querySelectorAll('.nav-item[data-module]').forEach(item => {
    const module = item.dataset.module;
    if (!allowed.includes(module)) {
      item.style.display = 'none';
    }
  });
}

// Sidebar HTML template
function getSidebarHTML(activePage) {
  return `
    <div id="licenseBanner" class="license-banner" style="display:none;"></div>
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">Muha<span>soft</span></div>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-section">Principal</div>
          <div class="nav-item ${activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard.html" data-module="dashboard">
            <span class="nav-icon">&#x1f4ca;</span><span>Dashboard</span>
          </div>
          <div class="nav-item ${activePage === 'appointments' ? 'active' : ''}" data-page="appointments.html" data-module="appointments">
            <span class="nav-icon">&#x1f4c5;</span><span>Agendamento</span>
          </div>
          <div class="nav-item ${activePage === 'patients' ? 'active' : ''}" data-page="patients.html" data-module="patients">
            <span class="nav-icon">&#x1f465;</span><span>Pacientes</span>
          </div>
          <div class="nav-section">Clinico</div>
          <div class="nav-item ${activePage === 'consultations' ? 'active' : ''}" data-page="consultations.html" data-module="consultations">
            <span class="nav-icon">&#x1fa7a;</span><span>Consultas</span>
          </div>
          <div class="nav-item ${activePage === 'prescriptions' ? 'active' : ''}" data-page="prescriptions.html" data-module="prescriptions">
            <span class="nav-icon">&#x1f4c4;</span><span>Receitas</span>
          </div>
          <div class="nav-item ${activePage === 'revisions' ? 'active' : ''}" data-page="revisions.html" data-module="revisions">
            <span class="nav-icon">&#x1f514;</span><span>Revisoes</span>
          </div>
          <div class="nav-section">Comercial</div>
          <div class="nav-item ${activePage === 'sales' ? 'active' : ''}" data-page="sales.html" data-module="sales">
            <span class="nav-icon">&#x1f4b0;</span><span>Vendas</span>
          </div>
          <div class="nav-item ${activePage === 'stock' ? 'active' : ''}" data-page="stock.html" data-module="stock">
            <span class="nav-icon">&#x1f4e6;</span><span>Stock</span>
          </div>
          <div class="nav-item ${activePage === 'orders' ? 'active' : ''}" data-page="orders.html" data-module="orders">
            <span class="nav-icon">&#x1f4e5;</span><span>Encomendas</span>
          </div>
          <div class="nav-section">Producao</div>
          <div class="nav-item ${activePage === 'lab' ? 'active' : ''}" data-page="lab.html" data-module="lab">
            <span class="nav-icon">&#x1f3ed;</span><span>Laboratorio</span>
          </div>
          <div class="nav-section">Sistema</div>
          <div class="nav-item ${activePage === 'users' ? 'active' : ''}" data-page="users.html" data-module="admin">
            <span class="nav-icon">&#x1f511;</span><span>Utilizadores</span>
          </div>
          <div class="nav-item ${activePage === 'audit' ? 'active' : ''}" data-page="audit.html" data-module="admin">
            <span class="nav-icon">&#x1f4cb;</span><span>Auditoria</span>
          </div>
          <div class="nav-item ${activePage === 'backup' ? 'active' : ''}" data-page="backup.html" data-module="admin">
            <span class="nav-icon">&#x1f4be;</span><span>Backup</span>
          </div>
          <div class="nav-item ${activePage === 'license' ? 'active' : ''}" data-page="license.html" data-module="admin">
            <span class="nav-icon">&#x1f512;</span><span>Licenca</span>
          </div>
          <div class="nav-item ${activePage === 'settings' ? 'active' : ''}" data-page="settings.html" data-module="admin">
            <span class="nav-icon">&#x2699;</span><span>Configuracoes</span>
          </div>
        </nav>
        <div class="sidebar-user" id="logoutBtn" title="Terminar sessao">
          <div class="sidebar-user-avatar" id="userAvatar">A</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name" id="userName">Utilizador</div>
            <div class="sidebar-user-role" id="userRole">Perfil</div>
          </div>
        </div>
      </aside>
  `;
}
