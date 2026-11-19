'use strict';

const express = require('express');
const upload = require('../upload');
const { cadastrarLivro, listarLivros } = require('../controllers/livrosController');

const router = express.Router();

// Listagem de todas as obras do acervo
router.get('/', listarLivros);

module.exports = router;
