# Muhasoft GestPro - Sistema de Gestao de Optica

Sistema profissional de gestao de optica, desenvolvido com Electron, Node.js e SQLite. Funciona offline, suporta multiplos utilizadores em rede local (LAN) e e instalavel no Windows (.exe).

## Requisitos

- Node.js 18+
- npm 9+

## Instalacao

```bash
npm install
```

## Executar

```bash
npm start
```

Modo desenvolvimento:
```bash
npm run dev
```

## Credenciais Padrao

- **Utilizador:** admin
- **Palavra-passe:** admin123

## Gerar Instalador Windows (.exe)

```bash
npm run build
```

O instalador sera gerado na pasta `dist/`.

## Funcionalidades

### Modulos
- **Dashboard** - Estatisticas em tempo real e alertas
- **Pacientes** - Gestao completa de pacientes
- **Agendamento** - Calendario e marcacao de consultas
- **Consultas** - Oftalmologia e Optometria com fichas clinicas completas
- **Receituario** - Gestao e impressao de receitas
- **Vendas** - Integracao com receitas, estados de producao
- **Stock** - Gestao de artigos com alertas de stock baixo
- **Encomendas** - Gestao de encomendas a fornecedores
- **Laboratorio** - Producao de oculos com estados de trabalho
- **Revisoes** - Notificacao 7 dias antes da revisao

### Administracao
- **Utilizadores** - Gestao de utilizadores e perfis
- **Auditoria** - Registo de todas as acoes
- **Backup** - Automatico e manual (USB)
- **Licenca** - Sistema de licenciamento offline
- **Configuracoes** - Dados da clinica e parametros

### Perfis de Utilizador
| Perfil | Acesso |
|--------|--------|
| Administrador | Acesso total |
| Oftalmologista | Consultas, receitas, pacientes |
| Optometrista | Consultas, receitas, pacientes |
| Rececao | Pacientes, agendamento, vendas |
| Laboratorio | Laboratorio, encomendas |
| Stock | Stock, encomendas |

### Rede Local (LAN)
- Um computador atua como servidor (porta 3847)
- Outros computadores conectam via IP local
- Base de dados centralizada com sincronizacao em tempo real
- Sem necessidade de internet

## Arquitetura

```
src/
  main/
    main.js          # Processo principal Electron
    preload.js       # Bridge IPC (context isolation)
    database.js      # Schema SQLite (15+ tabelas)
    ipc.js           # Handlers IPC (~1100 linhas)
    server.js        # Servidor Express + Socket.IO
  renderer/
    css/styles.css   # Estilos CSS
    js/utils.js      # Utilitarios partilhados
    pages/           # 17 paginas HTML
```

## Tecnologias

- **Electron** - Desktop framework
- **SQLite** (better-sqlite3) - Base de dados offline
- **Express** - Servidor HTTP para LAN
- **Socket.IO** - Sincronizacao em tempo real
- **bcryptjs** - Hash de palavras-passe
- **electron-builder** - Gerador de instalador Windows
