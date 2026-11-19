'use strict';

/**
 * SmartReader · Biblioteca Digital Acessível
 * Gestão de acervo, busca em tempo real, geração de capa de PDF local, LGPD e TTS
 */

const API_BASE_URL = 'https://tcc-smartreader.onrender.com';
let livrosData = [];
let activeFilter = 'all'; // 'all' | 'online' | 'local'

// Elementos do DOM
const booksGrid = document.getElementById('books-grid');
const searchInput = document.getElementById('library-search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const libraryStatus = document.getElementById('library-status');
const statusMsg = document.getElementById('status-msg');
const toast = document.getElementById('toast');
const libraryFileInput = document.getElementById('fileInput');
const libraryUploadZone = document.getElementById('upload-zone');
const uploadedBooksGrid = document.getElementById('uploaded-books-grid');
const localBooksCount = document.getElementById('local-books-count');
const sectionLocalBooks = document.getElementById('section-local-books');
const sectionOnlineBooks = document.getElementById('section-online-books');

// Modais & Autenticação
const modalAuth = document.getElementById('modal-auth');
const formAuth = document.getElementById('form-auth');
const authEmail = document.getElementById('auth-email');
const authSenha = document.getElementById('auth-senha');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authTitle = document.getElementById('auth-title');
const authToggleLink = document.getElementById('auth-toggle-link');
const authToggleMsg = document.getElementById('auth-toggle-msg');
const btnFecharAuth = document.getElementById('btn-fechar-auth');
const lgpdAcceptance = document.getElementById('lgpd-acceptance');
const aceitarLgpd = document.getElementById('aceitar-lgpd');
const lgpdError = document.getElementById('lgpd-error');

// Modal Novo Livro
const modalNovoLivro = document.getElementById('modal-novo-livro');
const formNovoLivro = document.getElementById('form-novo-livro');
const btnFecharNovoLivro = document.getElementById('btn-fechar-novo-livro');
const btnAbrirNovoLivro = document.getElementById('btn-abrir-novo-livro');
const btnTopbarNovoLivro = document.getElementById('btn-topbar-novo-livro');
const novoLivroProgresso = document.getElementById('novo-livro-progresso');
const btnSubmitLivro = document.getElementById('btn-submit-livro');

const UPLOADED_BOOKS_KEY = 'sr_uploaded_books';
let modoCadastro = false;

/* ─── TOAST NOTIFICAÇÕES PROFISSIONAL ─── */
function showToast(msg, type = 'info', duration = 3400) {
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show toast-${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, duration);
}

/* ─── HELPERS DE LOCAL STORAGE & INDEXEDDB ─── */
function isPdfFile(file) {
  return !!file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
}

function getUploadedBooks() {
  try {
    return JSON.parse(localStorage.getItem(UPLOADED_BOOKS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setUploadedBooks(books) {
  localStorage.setItem(UPLOADED_BOOKS_KEY, JSON.stringify(books));
}

function getUploadedBookKey(fileName) {
  return `uploaded_pdf_${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function getReadingProgress(titleOrFileName) {
  try {
    const data = JSON.parse(localStorage.getItem('sr_progress') || '{}');
    if (!titleOrFileName) return null;
    const cleanKey = titleOrFileName.toLowerCase().replace(/\.pdf$/i, '').trim();
    for (const [key, val] of Object.entries(data)) {
      if (key.toLowerCase().includes(cleanKey) || cleanKey.includes(key.toLowerCase())) {
        return val.page || null;
      }
    }
    return data[titleOrFileName]?.page || null;
  } catch {
    return null;
  }
}

function savePDFToIndexedDB(fileName, arrayBuffer, storageKey = 'current_pdf') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SmartReaderDB', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs');
      }
    };

    request.onsuccess = (event) => {
      try {
        const db = event.target.result;
        const tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put(arrayBuffer, storageKey);
        localStorage.setItem('sr_current_filename', fileName);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

function deletePDFFromIndexedDB(storageKey) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SmartReaderDB', 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs');
      }
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.close();
        return resolve();
      }
      const tx = db.transaction('pdfs', 'readwrite');
      tx.objectStore('pdfs').delete(storageKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

/* ─── GERADOR DE CAPA DO PDF (PRIMEIRA PÁGINA) ─── */
async function gerarCapaPDF(arrayBuffer) {
  try {
    if (!window.pdfjsLib) return null;
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer.slice(0))
    }).promise;
    const pagina = await pdf.getPage(1);
    const viewport = pagina.getViewport({ scale: 0.55 });
    const canvas = document.createElement('canvas');
    const contexto = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pagina.render({
      canvasContext: contexto,
      viewport
    }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch (err) {
    console.warn('Não foi possível gerar thumbnail da capa do PDF:', err);
    return null;
  }
}

/* ─── RENDERIZAR ARQUIVOS LOCAIS ENVIADOS ─── */
function renderUploadedBooks() {
  if (!uploadedBooksGrid) return;

  const uploadedBooks = getUploadedBooks();
  if (localBooksCount) {
    localBooksCount.textContent = `${uploadedBooks.length} arquivo(s)`;
  }

  if (!uploadedBooks.length) {
    uploadedBooksGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 24px; text-align: center; border: 1.5px dashed var(--border); border-radius: var(--radius); background: var(--bg-surface);">
        <p style="margin: 0; color: var(--text-sec); font-size: 13px;">Nenhum documento PDF local aberto recentemente. Use a caixa de envio acima para abrir arquivos do seu dispositivo.</p>
      </div>
    `;
    return;
  }

  uploadedBooksGrid.innerHTML = uploadedBooks.map((book, index) => {
    const progressPage = getReadingProgress(book.name);
    return `
      <article class="book-card" tabindex="0" aria-label="Arquivo local: ${book.name}">
        <div class="book-cover-wrap">
          ${
            book.capa
              ? `<img src="${book.capa}" alt="Capa de ${book.name}" class="book-cover-image" loading="lazy">`
              : `<div class="book-cover-fallback">
                  <svg class="book-cover-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-hint);">PDF LOCAL</span>
                </div>`
          }
        </div>
        <div class="book-info">
          <div class="book-badge-row">
            <span class="badge-tag">Armazenado no Dispositivo</span>
            ${progressPage ? `<span class="badge-progress">Pág. ${progressPage}</span>` : `<span class="badge-tag" style="color:var(--text-hint);">Novo</span>`}
          </div>
          <h3 class="book-title" title="${book.name}">${book.name}</h3>
          <p class="book-author">${book.sizeLabel || 'Tamanho desconhecido'}</p>
        </div>
        <div class="book-card-actions">
          <button class="btn-read-book btn-open-local" data-index="${index}" aria-label="Abrir documento ${book.name}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Abrir Leitura
          </button>
          <button class="btn-tts-card btn-delete-local" data-index="${index}" aria-label="Excluir arquivo do histórico" title="Excluir do dispositivo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </article>
    `;
  }).join('');

  // Listeners para abrir PDF local
  uploadedBooksGrid.querySelectorAll('.btn-open-local').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const book = uploadedBooks[idx];
      if (!book) return;

      const bookKey = getUploadedBookKey(book.name);
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('SmartReaderDB', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction('pdfs', 'readonly');
          const r = tx.objectStore('pdfs').get(bookKey);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => reject(r.error);
        });

        if (!result) {
          showToast('Arquivo não encontrado no armazenamento local.', 'error');
          return;
        }

        await savePDFToIndexedDB(book.name, result, 'current_pdf');
        localStorage.setItem('sr_current_filename', book.name);
        window.location.href = 'leitor.html?uploaded=1';
      } catch (err) {
        console.error('Erro ao abrir PDF local:', err);
        showToast('Não foi possível carregar este PDF local.', 'error');
      }
    });
  });

  // Listeners para excluir do IndexedDB e histórico
  uploadedBooksGrid.querySelectorAll('.btn-delete-local').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const book = uploadedBooks[idx];
      if (!book) return;

      const confirmar = confirm(`Deseja realmente excluir o arquivo "${book.name}" do seu dispositivo?`);
      if (!confirmar) return;

      try {
        await deletePDFFromIndexedDB(getUploadedBookKey(book.name));
        const atualizados = getUploadedBooks().filter(item => item.name !== book.name);
        setUploadedBooks(atualizados);
        if (localStorage.getItem('sr_current_filename') === book.name) {
          await deletePDFFromIndexedDB('current_pdf');
          localStorage.removeItem('sr_current_filename');
        }
        renderUploadedBooks();
        showToast('Documento excluído com sucesso do dispositivo.', 'info');
      } catch (err) {
        console.error('Erro ao excluir:', err);
        showToast('Falha ao excluir o documento local.', 'error');
      }
    });
  });
}

function syncUploadedBook(fileName, sizeInBytes, capaUrl = null) {
  const uploadedBooks = getUploadedBooks();
  const index = uploadedBooks.findIndex(b => b.name === fileName);

  const registro = {
    name: fileName,
    sizeLabel: `${(sizeInBytes / 1024).toFixed(0)} KB`,
    uploadedAt: new Date().toISOString(),
    capa: capaUrl || (index >= 0 ? uploadedBooks[index].capa : null)
  };

  if (index >= 0) {
    uploadedBooks[index] = registro;
  } else {
    uploadedBooks.unshift(registro);
  }

  setUploadedBooks(uploadedBooks.slice(0, 12));
  renderUploadedBooks();
}

async function openUploadedPDF(file) {
  if (!isPdfFile(file)) {
    showToast('Por favor, selecione um arquivo em formato PDF válido.', 'error');
    return;
  }

  showToast('Processando documento e gerando visualização...', 'info');

  try {
    const buffer = await file.arrayBuffer();
    const bookKey = getUploadedBookKey(file.name);

    // Gera thumbnail da capa do PDF em background
    let capa = null;
    try {
      capa = await gerarCapaPDF(buffer);
    } catch (e) {
      console.warn('Falha na geração de capa:', e);
    }

    await savePDFToIndexedDB(file.name, buffer, 'current_pdf');
    await savePDFToIndexedDB(file.name, buffer, bookKey);
    syncUploadedBook(file.name, file.size, capa);
    localStorage.setItem('sr_current_filename', file.name);
    window.location.href = 'leitor.html?uploaded=1';
  } catch (error) {
    console.error('Erro ao processar PDF enviado:', error);
    showToast('Falha ao processar o arquivo PDF selecionado.', 'error');
  }
}

/* ─── CARREGAR LIVROS DA API SUPABASE (RENDER) ─── */
async function fetchLivros() {
  try {
    if (libraryStatus) libraryStatus.textContent = 'Buscando acervo no servidor...';
    const response = await fetch(`${API_BASE_URL}/api/livros`);

    if (!response.ok) {
      throw new Error(`Falha HTTP ${response.status}`);
    }

    livrosData = await response.json();
    renderBooks(livrosData);

    const serverNotice = document.getElementById('server-notice');
    if (serverNotice) serverNotice.style.display = 'none';
  } catch (err) {
    console.error('Erro ao conectar com a API:', err);
    if (libraryStatus) libraryStatus.textContent = 'Erro ao carregar os livros. Certifique-se de que o servidor está rodando.';
    showToast('Erro ao conectar com a API', 'error');
  }
}

/* ─── RENDERIZAR CARDS DO ACERVO ONLINE ─── */
function renderBooks(books) {
  if (!booksGrid) return;
  booksGrid.innerHTML = '';
  const serverNotice = document.getElementById('server-notice');
  if (serverNotice) serverNotice.style.display = 'none';

  if (!books || books.length === 0) {
    if (libraryStatus) libraryStatus.textContent = 'Nenhum livro encontrado.';
    booksGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 32px; text-align: center; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius);">
        <p style="color: var(--text-sec); font-size: 14px; margin-bottom: 8px;">Nenhum livro encontrado no acervo.</p>
        <button type="button" class="btn-hero-primary" onclick="abrirModalNovoLivro()" style="font-size: 12px; padding: 6px 14px;">Cadastrar Primeira Obra</button>
      </div>
    `;
    return;
  }

  if (libraryStatus) {
    libraryStatus.textContent = `Exibindo ${books.length} livro(s) disponível(eis).`;
  }

  books.forEach(book => {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Livro: ${book.titulo || 'Sem título'}, por ${book.autor || 'Autor desconhecido'}`);

    const progressPage = getReadingProgress(book.titulo);
    const pdfProxyUrl = `${API_BASE_URL}/api/proxy-pdf?url=${encodeURIComponent(book.url_pdf)}`;

    card.innerHTML = `
      <div class="book-cover-wrap">
        ${
          book.capa_url
            ? `<img src="${book.capa_url}" alt="Capa de ${book.titulo || 'Sem título'}" class="book-cover-image" loading="lazy">`
            : `<div class="book-cover-fallback">
                <svg class="book-cover-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                <span style="font-size: 11px; font-weight: 700; color: var(--accent); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${book.titulo || 'Obra Digital'}</span>
              </div>`
        }
      </div>

      <div class="book-info">
        <div class="book-badge-row">
          <span class="badge-tag">Acervo Online</span>
          ${progressPage ? `<span class="badge-progress">Retomar Pág. ${progressPage}</span>` : `<span class="badge-tag" style="color:var(--text-hint);">Novo</span>`}
        </div>
        <h3 class="book-title" title="${book.titulo || 'Sem título'}">${book.titulo || 'Sem título'}</h3>
        <p class="book-author" title="${book.autor || 'Autor desconhecido'}">${book.autor || 'Autor desconhecido'}</p>
      </div>

      <div class="book-card-actions">
        <button type="button" class="btn-read-book btn-open-online" aria-label="Ler a obra ${book.titulo || 'Sem título'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Abrir Leitura
        </button>
        <button type="button" class="btn-tts-card btn-speak-title" aria-label="Ouvir título da obra" title="Ouvir título em voz alta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
      </div>
    `;

    const openBtn = card.querySelector('.btn-open-online');
    openBtn.addEventListener('click', () => {
      localStorage.setItem('sr_current_filename', book.titulo || 'Livro Selecionado');
      window.location.href = `leitor.html?pdf=${encodeURIComponent(pdfProxyUrl)}&title=${encodeURIComponent(book.titulo || '')}`;
    });

    const speakBtn = card.querySelector('.btn-speak-title');
    speakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      falarTexto(`Livro: ${book.titulo || 'Sem título'}. Autor: ${book.autor || 'desconhecido'}.`);
    });

    booksGrid.appendChild(card);
  });
}

/* ─── FILTRO E BUSCA EM TEMPO REAL ─── */
function filtrarAcervo() {
  const query = (searchInput?.value || '').toLowerCase().trim();

  if (btnClearSearch) {
    btnClearSearch.style.display = query ? 'inline-flex' : 'none';
  }

  const filtrados = livrosData.filter(b => {
    return (b.titulo && b.titulo.toLowerCase().includes(query)) ||
           (b.autor && b.autor.toLowerCase().includes(query));
  });

  renderBooks(filtrados);

  const localCards = uploadedBooksGrid?.querySelectorAll('.book-card') || [];
  let visiveisLocais = 0;
  localCards.forEach(card => {
    const text = card.textContent.toLowerCase();
    const matches = !query || text.includes(query);
    card.style.display = matches ? 'flex' : 'none';
    if (matches) visiveisLocais++;
  });

  if (localBooksCount) {
    localBooksCount.textContent = `${visiveisLocais} arquivo(s)`;
  }
}

if (searchInput) {
  searchInput.addEventListener('input', filtrarAcervo);
}

if (btnClearSearch) {
  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    filtrarAcervo();
    searchInput.focus();
  });
}

// Filtro de Chips (Todos / Acervo Nuvem / Meus Arquivos)
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;

    if (activeFilter === 'all') {
      if (sectionLocalBooks) sectionLocalBooks.style.display = 'block';
      if (sectionOnlineBooks) sectionOnlineBooks.style.display = 'block';
    } else if (activeFilter === 'online') {
      if (sectionLocalBooks) sectionLocalBooks.style.display = 'none';
      if (sectionOnlineBooks) sectionOnlineBooks.style.display = 'block';
    } else if (activeFilter === 'local') {
      if (sectionLocalBooks) sectionLocalBooks.style.display = 'block';
      if (sectionOnlineBooks) sectionOnlineBooks.style.display = 'none';
    }
  });
});

/* ─── SÍNTESE DE VOZ (TTS) & VLIBRAS ─── */
function falarTexto(texto) {
  if (typeof speechSynthesis === 'undefined') return;

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }

  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR';
  speechSynthesis.speak(utter);
}

document.getElementById('btn-read-catalog')?.addEventListener('click', () => {
  if (typeof speechSynthesis === 'undefined') return;

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    showToast('Leitura de catálogo interrompida.', 'info');
    return;
  }

  const titles = Array.from(document.querySelectorAll('.book-title')).map(el => el.textContent.trim());
  if (titles.length === 0) {
    showToast('Nenhum título no catálogo para leitura.', 'warning');
    return;
  }

  const texto = 'Livros disponíveis no catálogo: ' + titles.join(', ');
  falarTexto(texto);
  showToast('Lendo títulos do catálogo em voz alta...', 'info');
});

document.getElementById('btn-libras')?.addEventListener('click', () => {
  const vlibrasText = document.getElementById('vlibras-text');
  const titles = Array.from(document.querySelectorAll('.book-title')).map(el => el.textContent.trim());

  if (titles.length === 0 || !vlibrasText) return;

  vlibrasText.textContent = '';
  requestAnimationFrame(() => {
    vlibrasText.textContent = 'Catálogo de livros disponíveis: ' + titles.join('. ');
  });
  showToast('Conteúdo do catálogo enviado para o VLibras.', 'success');
});

/* ─── CONTROLE RESPONSIVO DA SIDEBAR ─── */
const sidebar = document.getElementById('sidebar');
const btnOpenSidebar = document.getElementById('btn-open-sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

btnToggleSidebar?.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('mobile-open', 'active');
    if (btnOpenSidebar) btnOpenSidebar.style.display = 'flex';
  } else {
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    if (btnOpenSidebar) btnOpenSidebar.style.display = isCollapsed ? 'flex' : 'none';
  }
});

btnOpenSidebar?.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.add('mobile-open', 'active');
  } else {
    sidebar.classList.remove('collapsed');
    btnOpenSidebar.style.display = 'none';
  }
});

document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768 && sidebar?.classList.contains('active')) {
    if (!sidebar.contains(e.target) && e.target !== btnOpenSidebar && !btnOpenSidebar.contains(e.target)) {
      sidebar.classList.remove('active', 'mobile-open');
    }
  }
});

/* ─── TEMAS VISUAIS WCAG (UNIFICADO NO :ROOT COM BFCache SYNC) ─── */
function setAppTheme(theme) {
  const cleanTheme = theme && theme.startsWith('theme-') ? theme : `theme-${theme || 'dark'}`;
  const dataTheme = cleanTheme.replace('theme-', '');

  document.documentElement.className = cleanTheme;
  document.documentElement.setAttribute('data-theme', dataTheme);
  document.body.className = cleanTheme;
  document.body.setAttribute('data-theme', dataTheme);
  localStorage.setItem('sr_theme', cleanTheme);

  document.querySelectorAll('.btn-theme').forEach(btn => {
    const isSelected = btn.dataset.theme === cleanTheme;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('sr_theme') || 'theme-dark';
  setAppTheme(savedTheme);

  document.querySelectorAll('.btn-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      setAppTheme(btn.dataset.theme);
      showToast(`Tema alterado para: ${btn.textContent.trim()}`, 'info');
    });
  });
}

// Sincroniza tema imediatamente ao voltar de outra página (Back/Forward Cache do navegador)
window.addEventListener('pageshow', () => {
  const savedTheme = localStorage.getItem('sr_theme') || 'theme-dark';
  setAppTheme(savedTheme);
});

/* ─── DRAG & DROP NO UPLOAD ZONE ─── */
if (libraryFileInput && libraryUploadZone) {
  libraryFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) openUploadedPDF(file);
  });

  libraryUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    libraryUploadZone.classList.add('drag-over');
  });

  libraryUploadZone.addEventListener('dragleave', () => {
    libraryUploadZone.classList.remove('drag-over');
  });

  libraryUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    libraryUploadZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) openUploadedPDF(file);
  });

  libraryUploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      libraryFileInput.click();
    }
  });
}

/* ─── MODAL DE AUTENTICAÇÃO COM SUPORTE À LGPD ─── */
function limparCamposAuth() {
  if (authEmail) authEmail.value = '';
  if (authSenha) authSenha.value = '';
  if (aceitarLgpd) aceitarLgpd.checked = false;
  if (lgpdError) lgpdError.style.display = 'none';
  formAuth?.reset();
}

function abrirLogin() {
  if (modalAuth) {
    modalAuth.classList.add('active');
    atualizarVisibilidadeLGPD();
  }
}
function fecharLogin() {
  if (modalAuth) {
    modalAuth.classList.remove('active');
    limparCamposAuth();
  }
}

function atualizarVisibilidadeLGPD() {
  if (lgpdAcceptance) {
    lgpdAcceptance.style.display = modoCadastro ? 'block' : 'none';
  }
  if (aceitarLgpd) {
    aceitarLgpd.required = modoCadastro;
    aceitarLgpd.checked = false;
  }
  if (lgpdError) {
    lgpdError.style.display = 'none';
  }
}

btnFecharAuth?.addEventListener('click', fecharLogin);
modalAuth?.addEventListener('click', (e) => {
  if (e.target === modalAuth) fecharLogin();
});

aceitarLgpd?.addEventListener('change', () => {
  if (aceitarLgpd.checked && lgpdError) {
    lgpdError.style.display = 'none';
  }
});

authToggleLink?.addEventListener('click', (e) => {
  e.preventDefault();
  modoCadastro = !modoCadastro;
  limparCamposAuth();
  authTitle.innerText = modoCadastro ? 'Criar Nova Conta' : 'Acessar Conta';
  btnAuthSubmit.innerText = modoCadastro ? 'Cadastrar-se' : 'Entrar';
  authToggleMsg.innerText = modoCadastro ? 'Já possui conta?' : 'Não possui uma conta?';
  authToggleLink.innerText = modoCadastro ? 'Fazer login' : 'Cadastrar-se';
  atualizarVisibilidadeLGPD();
});

formAuth?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authSenha.value;

  if (modoCadastro && aceitarLgpd && !aceitarLgpd.checked) {
    if (lgpdError) lgpdError.style.display = 'block';
    aceitarLgpd.focus();
    showToast('É necessário aceitar os termos da LGPD para criar uma conta.', 'warning');
    return;
  }

  if (!window.supabaseClient) {
    showToast('Serviço de autenticação temporariamente indisponível.', 'error');
    return;
  }

  btnAuthSubmit.disabled = true;
  btnAuthSubmit.innerText = 'Processando...';

  try {
    if (modoCadastro) {
      const { data, error } = await window.supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      if (data?.session) {
        showToast('Cadastro realizado! Sua conta foi criada e ativada.', 'success');
      } else {
        showToast('Cadastro realizado! Enviamos um link de confirmação para seu e-mail. Verifique também a caixa de spam.', 'info', 5000);
      }
    } else {
      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast('Login realizado com sucesso! Bem-vindo(a).', 'success');
    }
    fecharLogin();
    atualizarInterfaceUsuario();
  } catch (err) {
    showToast(err.message || 'Falha na autenticação.', 'error');
  } finally {
    btnAuthSubmit.disabled = false;
    btnAuthSubmit.innerText = modoCadastro ? 'Cadastrar-se' : 'Entrar';
  }
});

async function atualizarInterfaceUsuario() {
  const btnConta = document.getElementById('btn-conta-sidebar');
  if (!btnConta || !window.supabaseClient) return;

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (user) {
      const userIdent = user.email.split('@')[0];
      btnConta.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        ${userIdent} (Sair)
      `;
      btnConta.onclick = async () => {
        await window.supabaseClient.auth.signOut();
        showToast('Sessão encerrada com sucesso.', 'info');
        atualizarInterfaceUsuario();
      };
    } else {
      btnConta.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        Entrar / Cadastrar
      `;
      btnConta.onclick = abrirLogin;
    }
  } catch (err) {
    console.warn('Erro ao atualizar usuário:', err);
  }
}

/* ─── STATUS DE CONEXÃO NETWORK ─── */
function updateNetworkStatus() {
  const pill = document.getElementById('status-network-sidebar');
  const offlineBadge = document.getElementById('status-offline');
  const isOnline = navigator.onLine;

  if (pill) {
    pill.className = isOnline ? 'badge badge-online' : 'badge badge-offline';
    pill.textContent = isOnline ? 'Online' : 'Offline';
  }
  if (offlineBadge) {
    offlineBadge.style.display = isOnline ? 'none' : 'inline-flex';
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

/* ─── INICIALIZAÇÃO GERAL ─── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderUploadedBooks();
  fetchLivros();
  updateNetworkStatus();
  setTimeout(atualizarInterfaceUsuario, 300);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('[SW Registration Warning]:', err);
      });
    });
  }
});

// Atualizar ao focar a aba
window.addEventListener('focus', () => {
  renderUploadedBooks();
  fetchLivros();
});
