'use strict';

const multer = require('multer');

// Armazena arquivos temporariamente em memória para envio direto ao Supabase Storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 30 * 1024 * 1024, // Limite de 30 MB por arquivo
    files: 2
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'pdf') {
      const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        cb(null, true);
      } else {
        cb(new Error('O arquivo do livro deve ser obrigatoriamente um documento em formato PDF.'));
      }
    } else if (file.fieldname === 'capa') {
      const isImage = file.mimetype.startsWith('image/') || /\.(png|jpe?g|webp|avif)$/i.test(file.originalname);
      if (isImage) {
        cb(null, true);
      } else {
        cb(new Error('A capa deve ser um arquivo de imagem válido (PNG, JPEG ou WebP).'));
      }
    } else {
      cb(null, true);
    }
  }
});

module.exports = upload;
