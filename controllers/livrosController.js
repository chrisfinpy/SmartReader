'use strict';

const supabase = require('../config/supabase');

/**
 * Lista todos os livros cadastrados no acervo
 * Rota: GET /api/livros
 */
async function listarLivros(req, res) {
  try {
    const { data, error } = await supabase
      .from('livros')
      .select('id, titulo, autor, url_pdf, capa_url, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Error] Falha ao consultar livros:', error.message);
      return res.status(500).json({
        sucesso: false,
        erro: 'Erro ao consultar o catálogo no banco de dados.',
        detalhes: error.message
      });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[Server Error] Exceção em listarLivros:', err.message);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao processar a solicitação.'
    });
  }
}


module.exports = {
  listarLivros,
};
