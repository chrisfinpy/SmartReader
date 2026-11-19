'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const livrosRoutes = require('./routes/livrosRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações e Middlewares essenciais
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Servir arquivos estáticos do frontend (permite rodar como app unificado em localhost)
app.use(express.static(path.join(__dirname)));

// Rotas da API de Livros
app.use('/api/livros', livrosRoutes);

// Endpoint de verificação de integridade (Health Check)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    app: 'SmartReader API',
    timestamp: new Date().toISOString()
  });
});

// Endpoint legado para compatibilidade de testes
app.get('/teste123', (req, res) => {
  res.status(200).send('Teste OK');
});

/**
 * Proxy HTTP para carregar arquivos PDF externos contornando restrições de CORS
 * Rota: GET /api/proxy-pdf?url=https://...
 */
app.get('/api/proxy-pdf', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ erro: 'Parâmetro url é obrigatório.' });
  }

  // Validação básica de URL segura
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ erro: 'Protocolo de URL inválido.' });
    }
  } catch {
    return res.status(400).json({ erro: 'URL informada possui formato inválido.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const upstreamResponse = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SmartReader-Proxy/1.0'
      }
    });

    clearTimeout(timeout);

    if (!upstreamResponse.ok) {
      return res.status(upstreamResponse.status).json({
        erro: `Falha ao carregar o arquivo na origem (Status ${upstreamResponse.status}).`
      });
    }

    const arrayBuffer = await upstreamResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache por 24 horas
    return res.send(buffer);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ erro: 'Tempo limite excedido ao buscar o documento PDF na origem.' });
    }
    console.error('[Proxy Error]:', err.message);
    return res.status(500).json({ erro: 'Erro interno no proxy ao buscar o PDF: ' + err.message });
  }
});

// Redirecionamento da raiz caso o index não seja servido automaticamente
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`[SmartReader] Servidor ativo em http://localhost:${PORT}`);
});
