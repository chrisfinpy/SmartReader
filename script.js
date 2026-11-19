/**
 * SmartReader · Leitor de PDF Acessível
 * IFNMG Janaúba · WCAG 2.2 AA / AAA
 * Funcionalidades: PDF.js, TTS (Web Speech), OCR (Tesseract.js), LIBRAS, Tradução, Anotações e PWA
 */

'use strict';

/* ─── ESTADO GLOBAL DO LEITOR ─── */
const state = {
  pdfDoc: null,
  pageNum: 1,
  scale: 1.5,
  isSpeaking: false,
  isPaused: false,
  currentTextItems: [],
  ocrText: '',
  ocrProcessed: new Set(),
  fileName: '',
  highlights: {}, // Formato: { [pageNum]: [ { x, y, width, height, text } ] }
  currentSearchTerm: '',
  searchResults: [],
  searchCurrentIndex: -1
};

/* ─── ELEMENTOS DOM ─── */
const $ = (id) => document.getElementById(id);

const canvas = $('pdf-render');
const ctx = canvas ? canvas.getContext('2d') : null;
const textLayer = $('text-layer');
const pdfContainer = $('pdf-container');
const emptyState = $('empty-state');
const fileInput = $('fileInput');
const uploadZone = $('upload-zone');
const fileInfo = $('file-info');
const pageInput = $('page-input');
const pageTotal = $('page-total');
const zoomDisplay = $('zoom-display');
const zoomSlider = $('zoom-slider');
const btnZoomFit = $('btn-zoom-fit');
const btnZoomReset = $('btn-zoom-reset');
const searchInput = $('search-input');
const searchResults = $('search-results');
const ocrStatus = $('ocr-status');
const docTitle = $('doc-title');
const statusMsg = $('status-msg');
const statusOcr = $('status-ocr-badge');
const statusOffline = $('status-offline');
const ttsRateInput = $('tts-rate');
const ttsPitchInput = $('tts-pitch');
const ttsRateVal = $('tts-rate-val');
const ttsPitchVal = $('tts-pitch-val');
const ttsVoiceSelect = $('tts-voice');
const vlibrasText = $('vlibras-text');
const btnTTSPlay = $('btn-tts-play');
const btnTTSStop = $('btn-tts-stop');
const ttsLabelEl = $('tts-btn-label');
const ttsPlayIcon = $('tts-icon-play');
const ttsPauseIcon = $('tts-icon-pause');
const toastEl = $('toast');
const sidebarEl = $('sidebar');
const btnOpenSidebar = $('btn-open-sidebar');
const btnToggleSidebar = $('btn-toggle-sidebar');
const modalShortcuts = $('modal-shortcuts');
const btnShowShortcuts = $('btn-show-shortcuts');
const btnFecharShortcuts = $('btn-fechar-shortcuts');

/* ─── CONFIGURAÇÃO WORKER PDF.js ─── */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

/* ─── SISTEMA PROFISSIONAL DE TOASTS ─── */
function showToast(msg, type = 'info', duration = 3000) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = `toast show toast-${type}`;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.className = 'toast';
  }, duration);
}

function setStatus(msg) {
  if (statusMsg) statusMsg.textContent = msg;
}

/* ─── ARMAZENAMENTO LOCAL (INDEXEDDB) ─── */
function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SmartReaderDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs');
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function savePDFToStorage(fileName, arrayBuffer) {
  try {
    const db = await getDB();
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(arrayBuffer, 'current_pdf');
    localStorage.setItem('sr_current_filename', fileName);
  } catch (err) {
    console.warn('[IndexedDB Warning] Falha ao persistir documento:', err);
  }
}

async function loadPDFFromStorage() {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('pdfs', 'readonly');
      const req = tx.objectStore('pdfs').get('current_pdf');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/* ─── PROGRESSO DE LEITURA (AUTO-SAVE) ─── */
function saveProgress(fileName, page) {
  if (!fileName || !page) return;
  try {
    const data = JSON.parse(localStorage.getItem('sr_progress') || '{}');
    data[fileName] = { page, savedAt: Date.now() };
    localStorage.setItem('sr_progress', JSON.stringify(data));
  } catch {
    // Storage indisponível
  }
}

function loadProgress(fileName) {
  if (!fileName) return null;
  try {
    const data = JSON.parse(localStorage.getItem('sr_progress') || '{}');
    return data[fileName]?.page || null;
  } catch {
    return null;
  }
}

/* ─── CARREGAMENTO DO PDF ─── */
if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadPDF(file);
  });
}

if (uploadZone) {
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file?.type === 'application/pdf') {
      loadPDF(file);
    } else {
      showToast('O arquivo enviado deve ser obrigatoriamente um PDF.', 'error');
    }
  });

  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
}

function loadPDF(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Selecione um arquivo PDF válido.', 'error');
    return;
  }

  state.fileName = file.name;
  state.ocrProcessed.clear();
  state.ocrText = '';
  state.highlights = {};

  setStatus('Carregando documento…');
  if (fileInfo) fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  if (docTitle) docTitle.textContent = file.name;

  const reader = new FileReader();
  reader.onload = function () {
    const arrayBuffer = this.result;
    const typedarray = new Uint8Array(arrayBuffer);

    // Persiste no IndexedDB para sobreviver a recarregamentos (F5)
    savePDFToStorage(file.name, arrayBuffer);

    pdfjsLib.getDocument(typedarray).promise
      .then((pdf) => {
        state.pdfDoc = pdf;
        state.pageNum = 1;

        // Restaura progresso prévio se houver
        const savedPage = loadProgress(file.name);
        if (savedPage && savedPage > 1 && savedPage <= pdf.numPages) {
          state.pageNum = savedPage;
          showToast(`Retomando leitura na página ${savedPage}`, 'info', 2500);
        }

        if (pageTotal) pageTotal.textContent = pdf.numPages;
        if (pageInput) {
          pageInput.max = pdf.numPages;
          pageInput.value = state.pageNum;
        }

        enableControls(true);
        renderPage(state.pageNum);
        showToast('Documento carregado com sucesso.', 'success');
      })
      .catch((err) => {
        console.error('Erro ao abrir PDF:', err);
        showToast('Erro ao abrir o PDF. Verifique se o arquivo não está corrompido.', 'error');
        setStatus('Erro ao carregar.');
      });
  };
  reader.readAsArrayBuffer(file);
}

/* ─── RENDERIZAR PÁGINA (CANVAS + TEXTLAYER) ─── */
function renderPage(num) {
  if (!state.pdfDoc) return;
  setStatus(`Renderizando página ${num}…`);
  if (statusOcr) statusOcr.style.display = 'none';

  state.pdfDoc.getPage(num).then((page) => {
    const viewport = page.getViewport({ scale: state.scale });

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.setAttribute('data-loaded', 'true');
    canvas.setAttribute('aria-label', `Página ${num} de ${state.pdfDoc.numPages}`);

    if (emptyState) emptyState.style.display = 'none';
    canvas.style.display = 'block';

    const renderCtx = { canvasContext: ctx, viewport };
    page.render(renderCtx).promise.then(() => {

      // Redesenha destaques salvos no canvas para esta página (corrige o bug de sumiço)
      renderSavedHighlightsForPage(num);

      // Renderiza TextLayer transparente sobre o canvas para seleção e busca
      if (textLayer) {
        textLayer.innerHTML = '';
        textLayer.style.width = canvas.width + 'px';
        textLayer.style.height = canvas.height + 'px';

        page.getTextContent().then((textContent) => {
          state.currentTextItems = textContent.items;
          state.ocrText = '';

          pdfjsLib.renderTextLayer({
            textContent,
            container: textLayer,
            viewport,
            textDivs: []
          });

          // Se OCR já foi processado nesta página anteriormente
          if (state.ocrProcessed.has(num) && statusOcr) {
            statusOcr.style.display = 'inline-flex';
          }

          // Atualiza região oculta do VLibras
          const fullText = textContent.items.map((i) => i.str).join(' ');
          updateVLibrasTarget(fullText);

          if (pageInput) pageInput.value = num;
          setStatus(`Página ${num} de ${state.pdfDoc.numPages}`);

          // Salva automaticamente o progresso da página lida
          if (state.fileName) {
            saveProgress(state.fileName, num);
          }
        });
      }
    });
  });
}

/* ─── DESTAQUES VISUAIS SALVOS ─── */
function renderSavedHighlightsForPage(num) {
  if (!state.highlights || !state.highlights[num] || !ctx) return;
  state.highlights[num].forEach((h) => {
    drawHighlightOnCanvas(h.x, h.y, h.width, h.height);
  });
}

function drawHighlightOnCanvas(x, y, w, h) {
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 0, 0.42)';
  ctx.fillRect(x * state.scale, y * state.scale, w * state.scale, h * state.scale);
  ctx.restore();
}

/* ─── NAVEGAÇÃO DE PÁGINAS ─── */
$('btn-prev')?.addEventListener('click', prevPage);
$('btn-next')?.addEventListener('click', nextPage);

function prevPage() {
  if (!state.pdfDoc || state.pageNum <= 1) return;
  state.pageNum--;
  renderPage(state.pageNum);
}

function nextPage() {
  if (!state.pdfDoc || state.pageNum >= state.pdfDoc.numPages) return;
  state.pageNum++;
  renderPage(state.pageNum);
}

if (pageInput) {
  pageInput.addEventListener('change', () => {
    const n = parseInt(pageInput.value);
    if (n >= 1 && n <= (state.pdfDoc?.numPages || 1)) {
      state.pageNum = n;
      renderPage(n);
    } else {
      pageInput.value = state.pageNum;
    }
  });
}

/* ─── ZOOM & ESCALA ─── */
$('btn-zoom-in')?.addEventListener('click', () => setZoom(state.scale + 0.2));
$('btn-zoom-out')?.addEventListener('click', () => setZoom(state.scale - 0.2));

if (zoomSlider) {
  zoomSlider.addEventListener('input', () => setZoom(zoomSlider.value / 100, false));
}

btnZoomReset?.addEventListener('click', () => setZoom(1.0));
btnZoomFit?.addEventListener('click', fitToWidth);

function setZoom(newScale, updateSlider = true) {
  newScale = Math.min(3.0, Math.max(0.5, newScale));
  state.scale = parseFloat(newScale.toFixed(2));
  if (zoomDisplay) zoomDisplay.textContent = Math.round(state.scale * 100) + '%';
  if (updateSlider && zoomSlider) zoomSlider.value = Math.round(state.scale * 100);
  renderPage(state.pageNum);
}

function fitToWidth() {
  if (!state.pdfDoc) return;
  const wrapper = $('pdf-scroll-wrapper');
  if (!wrapper) return;
  const containerWidth = wrapper.clientWidth - 48;

  state.pdfDoc.getPage(state.pageNum).then((page) => {
    const originalViewport = page.getViewport({ scale: 1.0 });
    const calculatedScale = containerWidth / originalViewport.width;
    setZoom(calculatedScale);
    showToast('Ajustado à largura da janela.', 'info');
  });
}

/* ─── SÍNTESE DE VOZ (TEXT-TO-SPEECH) ─── */
function loadVoices() {
  if (typeof speechSynthesis === 'undefined' || !ttsVoiceSelect) return;

  const allVoices = speechSynthesis.getVoices();
  const ptVoices = allVoices.filter((v) => v.lang.startsWith('pt'));
  const enVoices = allVoices.filter((v) => v.lang.startsWith('en'));
  const displayVoices = ptVoices.length > 0 ? [...ptVoices, ...enVoices] : allVoices;

  if (displayVoices.length === 0) {
    ttsVoiceSelect.innerHTML = '<option value="">Voz padrão do sistema</option>';
    return;
  }

  ttsVoiceSelect.innerHTML = displayVoices.map((v, idx) => {
    const isSelected = v.lang.startsWith('pt-BR') && idx === 0;
    return `<option value="${v.name}" ${isSelected ? 'selected' : ''}>${v.name} (${v.lang})</option>`;
  }).join('');
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

ttsRateInput?.addEventListener('input', () => {
  if (ttsRateVal) ttsRateVal.textContent = parseFloat(ttsRateInput.value).toFixed(1) + '×';
});

ttsPitchInput?.addEventListener('input', () => {
  if (ttsPitchVal) ttsPitchVal.textContent = parseFloat(ttsPitchInput.value).toFixed(1);
});

btnTTSPlay?.addEventListener('click', () => {
  if (state.isSpeaking && !state.isPaused) {
    speechSynthesis.pause();
    state.isPaused = true;
    setTTSState('paused');
    setStatus('Leitura pausada.');
  } else if (state.isPaused) {
    speechSynthesis.resume();
    state.isPaused = false;
    setTTSState('playing');
    setStatus('Lendo…');
  } else {
    startReading();
  }
});

btnTTSStop?.addEventListener('click', stopReading);

function getTextToRead() {
  if (state.ocrText) return state.ocrText;
  return state.currentTextItems.map((i) => i.str).join(' ').trim();
}

function startReading(customText = null) {
  const text = customText || getTextToRead();
  if (!text) {
    showToast('Nenhum texto encontrado nesta página. Tente executar o OCR.', 'warning');
    return;
  }

  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'pt-BR';
  if (ttsRateInput) utter.rate = parseFloat(ttsRateInput.value);
  if (ttsPitchInput) utter.pitch = parseFloat(ttsPitchInput.value);

  const allVoices = speechSynthesis.getVoices();
  const selectedName = ttsVoiceSelect?.value;
  const chosenVoice = allVoices.find((v) => v.name === selectedName);
  if (chosenVoice) {
    utter.voice = chosenVoice;
    utter.lang = chosenVoice.lang;
  }

  utter.onstart = () => {
    state.isSpeaking = true;
    state.isPaused = false;
    setTTSState('playing');
    setStatus('Lendo página em voz alta…');
  };

  utter.onend = utter.onerror = () => {
    state.isSpeaking = false;
    state.isPaused = false;
    setTTSState('idle');
    setStatus(`Página ${state.pageNum} de ${state.pdfDoc?.numPages || '—'}`);
  };

  speechSynthesis.speak(utter);
}

function stopReading() {
  speechSynthesis.cancel();
  state.isSpeaking = false;
  state.isPaused = false;
  setTTSState('idle');
}

function setTTSState(s) {
  if (!btnTTSPlay || !ttsLabelEl) return;

  if (s === 'playing') {
    btnTTSPlay.classList.add('speaking');
    ttsLabelEl.textContent = 'Pausar';
    if (ttsPlayIcon) ttsPlayIcon.style.display = 'none';
    if (ttsPauseIcon) ttsPauseIcon.style.display = 'block';
    if (btnTTSStop) btnTTSStop.disabled = false;
  } else if (s === 'paused') {
    btnTTSPlay.classList.remove('speaking');
    ttsLabelEl.textContent = 'Retomar';
    if (ttsPlayIcon) ttsPlayIcon.style.display = 'block';
    if (ttsPauseIcon) ttsPauseIcon.style.display = 'none';
    if (btnTTSStop) btnTTSStop.disabled = false;
  } else {
    btnTTSPlay.classList.remove('speaking');
    ttsLabelEl.textContent = 'Ler Página';
    if (ttsPlayIcon) ttsPlayIcon.style.display = 'block';
    if (ttsPauseIcon) ttsPauseIcon.style.display = 'none';
    if (btnTTSStop) btnTTSStop.disabled = true;
  }
}

/* ─── BUSCA TEXTUAL NO DOCUMENTO ─── */
$('btn-search')?.addEventListener('click', performSearch);
if (searchInput) {
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

function performSearch() {
  const term = (searchInput?.value || '').trim().toLowerCase();
  if (!term || !textLayer) return;

  const spans = textLayer.querySelectorAll('span');
  let count = 0;
  spans.forEach((span) => {
    span.classList.remove('highlight', 'highlight-active');
    if (span.textContent.toLowerCase().includes(term)) {
      span.classList.add('highlight');
      count++;
    }
  });

  const first = textLayer.querySelector('.highlight');
  if (first) {
    first.classList.add('highlight-active');
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (searchResults) {
    searchResults.textContent = count > 0
      ? `${count} ocorrência(s) encontrada(s).`
      : 'Nenhuma ocorrência encontrada nesta página.';
  }
}

/* ─── MARCAÇÕES & EXPORTAÇÃO COM PDF-LIB (ÚNICA & ROBUSTA) ─── */
let currentSelectionData = null;

const selectionToolbar = $('selection-toolbar');
const selBtnHighlight = $('sel-btn-highlight');
const selBtnSpeak = $('sel-btn-speak');
const selBtnLibras = $('sel-btn-libras');
const selBtnCopy = $('sel-btn-copy');

function hideSelectionToolbar() {
  if (selectionToolbar) {
    selectionToolbar.style.display = 'none';
  }
}

function showSelectionToolbar(range) {
  if (!selectionToolbar || !pdfContainer) return;
  const rect = range.getBoundingClientRect();
  const containerRect = pdfContainer.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    hideSelectionToolbar();
    return;
  }

  const left = rect.left - containerRect.left + (rect.width / 2);
  const top = rect.top - containerRect.top;

  selectionToolbar.style.left = `${Math.max(60, left)}px`;
  selectionToolbar.style.top = `${Math.max(10, top)}px`;
  selectionToolbar.style.display = 'flex';
}

if (textLayer) {
  textLayer.addEventListener('mouseup', captureSelection);
  textLayer.addEventListener('touchend', captureSelection);
}

document.addEventListener('mousedown', (e) => {
  if (selectionToolbar && !selectionToolbar.contains(e.target) && e.target !== textLayer) {
    hideSelectionToolbar();
  }
});

function captureSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (!selectedText || !state.pdfDoc) {
    currentSelectionData = null;
    hideSelectionToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const layerRect = textLayer.getBoundingClientRect();

  currentSelectionData = {
    pageNum: state.pageNum,
    text: selectedText,
    rects: Array.from(rects).map((rect) => ({
      x: (rect.left - layerRect.left) / state.scale,
      y: (rect.top - layerRect.top) / state.scale,
      width: rect.width / state.scale,
      height: rect.height / state.scale
    }))
  };

  showSelectionToolbar(range);
}

selBtnHighlight?.addEventListener('click', (e) => {
  e.stopPropagation();
  aplicarDestaqueManual();
  hideSelectionToolbar();
});

selBtnSpeak?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentSelectionData?.text) return;
  const text = currentSelectionData.text;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = parseFloat(ttsRateInput?.value || '1.0');
  utterance.pitch = parseFloat(ttsPitchInput?.value || '1.0');
  window.speechSynthesis.speak(utterance);
  showToast('Reproduzindo trecho selecionado…', 'info', 2000);
  hideSelectionToolbar();
});

selBtnLibras?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentSelectionData?.text) return;
  const text = currentSelectionData.text;
  updateVLibrasTarget(text);
  const vlibrasBtn = document.querySelector('[vw-access-button]') || document.querySelector('.vw-plugin-top-wrapper');
  if (vlibrasBtn && !document.querySelector('.active[vw-plugin-wrapper]')) {
    vlibrasBtn.click();
  }
  showToast('Trecho enviado ao avatar do VLibras.', 'success');
  hideSelectionToolbar();
});

selBtnCopy?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentSelectionData?.text) return;
  try {
    await navigator.clipboard.writeText(currentSelectionData.text);
    showToast('Texto copiado para a área de transferência!', 'success');
  } catch (err) {
    showToast('Falha ao copiar texto selecionado.', 'error');
  }
  hideSelectionToolbar();
});

$('btn-highlight')?.addEventListener('click', aplicarDestaqueManual);
$('btn-download-pdf')?.addEventListener('click', downloadModifiedPDF);

function aplicarDestaqueManual() {
  if (!currentSelectionData || currentSelectionData.pageNum !== state.pageNum) {
    showToast('Selecione um trecho de texto no documento antes de destacar.', 'warning');
    return;
  }

  if (!state.highlights[state.pageNum]) {
    state.highlights[state.pageNum] = [];
  }

  currentSelectionData.rects.forEach((r) => {
    state.highlights[state.pageNum].push({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      text: currentSelectionData.text
    });
    drawHighlightOnCanvas(r.x, r.y, r.width, r.height);
  });

  showToast('Destaque inserido com sucesso.', 'success');
  window.getSelection().removeAllRanges();
  currentSelectionData = null;
  hideSelectionToolbar();
}

async function downloadModifiedPDF() {
  if (!state.pdfDoc) return;
  setStatus('Preparando documento com anotações…');

  if (!window.PDFLib) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    document.head.appendChild(script);
    await new Promise((res, rej) => {
      script.onload = res;
      script.onerror = rej;
    });
  }

  try {
    const originalBytes = await loadPDFFromStorage();
    if (!originalBytes) {
      throw new Error('Bytes originais do PDF não encontrados no armazenamento local.');
    }

    const pdfDocModifier = await PDFLib.PDFDocument.load(originalBytes);
    const pages = pdfDocModifier.getPages();

    Object.keys(state.highlights).forEach((pageIdx) => {
      const pageNum = parseInt(pageIdx);
      if (pageNum <= pages.length) {
        const pdfLibPage = pages[pageNum - 1];
        const { height } = pdfLibPage.getSize();

        state.highlights[pageIdx].forEach((h) => {
          // Inversão de coordenadas (PDF.js topo-esquerdo -> PDF-Lib base-esquerda)
          const pdfY = height - (h.y + h.height);
          pdfLibPage.drawRectangle({
            x: h.x,
            y: pdfY,
            width: h.width,
            height: h.height,
            color: PDFLib.rgb(1, 1, 0),
            opacity: 0.45
          });
        });
      }
    });

    const modifiedBytes = await pdfDocModifier.save();
    const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `smartreader_${state.fileName || 'documento'}.pdf`;
    link.click();

    showToast('Download do PDF anotado iniciado!', 'success');
  } catch (err) {
    console.error('Erro na exportação:', err);
    showToast('Falha ao exportar PDF modificado.', 'error');
  } finally {
    setStatus(`Página ${state.pageNum} de ${state.pdfDoc?.numPages || '—'}`);
  }
}

/* ─── OCR COM TESSERACT.js v5 (LAZY LOADING) ─── */
$('btn-ocr')?.addEventListener('click', runOCR);

async function runOCR() {
  if (!state.pdfDoc || !canvas) return;

  if (!window.Tesseract) {
    showToast('Carregando biblioteca de visão computacional (OCR)...', 'info');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    document.head.appendChild(script);
    await new Promise((res, rej) => {
      script.onload = res;
      script.onerror = rej;
    });
  }

  if (ocrStatus) {
    ocrStatus.innerHTML = `
      <div class="ocr-progress">
        <div class="progress-bar"><div class="progress-fill" id="ocr-bar" style="width:0%"></div></div>
        <span id="ocr-pct" style="font-family:var(--font-mono); font-size:11px;">0%</span>
      </div>
    `;
  }
  setStatus('Processando OCR na página…');
  $('btn-ocr').disabled = true;

  try {
    const worker = await Tesseract.createWorker('por', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          const bar = $('ocr-bar');
          const pctEl = $('ocr-pct');
          if (bar) bar.style.width = pct + '%';
          if (pctEl) pctEl.textContent = pct + '%';
        }
      }
    });

    const imageData = canvas.toDataURL('image/png');
    const { data } = await worker.recognize(imageData);
    await worker.terminate();

    state.ocrText = data.text;
    state.ocrProcessed.add(state.pageNum);
    if (statusOcr) statusOcr.style.display = 'inline-flex';

    const wordCount = data.text.split(/\s+/).filter(Boolean).length;
    if (ocrStatus) {
      ocrStatus.innerHTML = `
        <span style="color:var(--success); font-weight:600;">✓ OCR Concluído:</span>
        ${wordCount} palavras extraídas. Agora disponíveis para TTS e Tradução.
      `;
    }

    updateVLibrasTarget(data.text);
    setStatus(`Página ${state.pageNum} — OCR Concluído`);
    showToast(`OCR concluído com sucesso (${wordCount} palavras).`, 'success');
  } catch (err) {
    console.error('Erro no OCR:', err);
    if (ocrStatus) ocrStatus.textContent = 'Erro ao processar imagem da página.';
    showToast('Falha ao executar OCR.', 'error');
  } finally {
    $('btn-ocr').disabled = false;
  }
}

/* ─── TRADUÇÃO DE IDIOMAS & RECURSOS ASSISTIVOS ─── */
const btnTranslate = $('btn-translate');
const translateStatus = $('translate-status');

if (btnTranslate) {
  btnTranslate.addEventListener('click', async () => {
    let texto = window.getSelection().toString().trim();
    if (!texto && state.ocrText) texto = state.ocrText;
    if (!texto && state.currentTextItems.length > 0) {
      texto = state.currentTextItems.map((i) => i.str).join(' ').trim();
    }

    if (!texto) {
      showToast('Selecione um trecho de texto no documento para traduzir.', 'warning');
      return;
    }

    btnTranslate.disabled = true;
    if (translateStatus) translateStatus.textContent = 'Traduzindo texto para o Português...';

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Falha na API de tradução.');

      const data = await res.json();
      const traducao = data[0].map((item) => item[0]).join('');

      if (translateStatus) {
        translateStatus.innerHTML = `
          <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px; margin-top:8px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <strong style="color:var(--accent); font-size:11px; text-transform:uppercase;">Tradução (PT-BR):</strong>
              <div style="display:flex; gap:6px;">
                <button class="btn-icon" id="btn-copy-trans" title="Copiar tradução" style="width:26px; height:26px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="btn-icon" id="btn-speak-trans" title="Ouvir tradução" style="width:26px; height:26px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </button>
              </div>
            </div>
            <p id="trans-text" style="font-size:12px; color:var(--text-primary); max-height:160px; overflow-y:auto; line-height:1.45; white-space:pre-wrap;">${traducao}</p>
          </div>
        `;

        $('btn-copy-trans')?.addEventListener('click', () => {
          navigator.clipboard.writeText(traducao);
          showToast('Tradução copiada para a área de transferência!', 'success');
        });

        $('btn-speak-trans')?.addEventListener('click', () => {
          startReading(traducao);
        });
      }

      showToast('Tradução concluída com sucesso.', 'success');
    } catch (err) {
      console.error('Erro na tradução:', err);
      if (translateStatus) translateStatus.textContent = 'Erro ao processar tradução.';
      showToast('Falha na comunicação com o serviço de tradução.', 'error');
    } finally {
      btnTranslate.disabled = false;
    }
  });
}

/* ─── LIBRAS (VLIBRAS) ─── */
$('btn-libras')?.addEventListener('click', () => {
  const text = getTextToRead();
  if (!text) {
    showToast('Nenhum texto disponível para tradução em LIBRAS.', 'warning');
    return;
  }
  updateVLibrasTarget(text);
  showToast('Conteúdo enviado ao avatar do VLibras.', 'success');
});

function updateVLibrasTarget(text) {
  if (!vlibrasText || !text) return;
  vlibrasText.textContent = '';
  requestAnimationFrame(() => {
    vlibrasText.textContent = text;
  });
}

/* ─── SALVAR PROGRESSO MANUAL (BOTÃO) ─── */
$('btn-save-progress')?.addEventListener('click', () => {
  if (!state.pdfDoc || !state.fileName) return;
  saveProgress(state.fileName, state.pageNum);
  showToast(`Progresso salvo: Página ${state.pageNum}.`, 'success');
});

/* ─── FULLSCREEN ─── */
$('btn-fullscreen')?.addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

/* ─── SIDEBAR & GAVETA MOBILE ─── */
btnToggleSidebar?.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebarEl?.classList.remove('mobile-open', 'active');
    if (btnOpenSidebar) btnOpenSidebar.style.display = 'flex';
  } else {
    sidebarEl?.classList.toggle('collapsed');
    const isCollapsed = sidebarEl?.classList.contains('collapsed');
    if (btnOpenSidebar) btnOpenSidebar.style.display = isCollapsed ? 'flex' : 'none';
  }
});

btnOpenSidebar?.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebarEl?.classList.add('mobile-open', 'active');
  } else {
    sidebarEl?.classList.remove('collapsed');
    btnOpenSidebar.style.display = 'none';
  }
});

// Fechar sidebar ao clicar no visualizador em telas mobile
$('pdf-scroll-wrapper')?.addEventListener('click', () => {
  if (window.innerWidth <= 768 && sidebarEl?.classList.contains('active')) {
    sidebarEl.classList.remove('active', 'mobile-open');
  }
});

/* ─── RESIZER DE LARGURA DA SIDEBAR ─── */
function initSidebarResizer() {
  if (!sidebarEl) return;

  const resizer = document.createElement('div');
  resizer.className = 'sidebar-resizer';
  sidebarEl.appendChild(resizer);

  let isDragging = false;

  resizer.addEventListener('pointerdown', (e) => {
    if (sidebarEl.classList.contains('collapsed') || window.innerWidth <= 768) return;
    isDragging = true;
    resizer.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    resizer.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    let newWidth = e.clientX;
    if (newWidth < 220) newWidth = 220;
    if (newWidth > 480) newWidth = 480;

    sidebarEl.style.width = `${newWidth}px`;
    sidebarEl.style.flex = `0 0 ${newWidth}px`;
  });

  document.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');
    resizer.releasePointerCapture(e.pointerId);

    if (window.innerWidth > 768 && !sidebarEl.classList.contains('collapsed')) {
      localStorage.setItem('sr_sidebar_width', sidebarEl.style.width);
    }
  });

  const savedWidth = localStorage.getItem('sr_sidebar_width');
  if (savedWidth && window.innerWidth > 768 && !sidebarEl.classList.contains('collapsed')) {
    sidebarEl.style.width = savedWidth;
    sidebarEl.style.flex = `0 0 ${savedWidth}`;
  }
}

/* ─── TEMAS VISUAIS WCAG (UNIFICADO NO :ROOT COM BFCache SYNC) ─── */
function setAppTheme(theme) {
  const cleanTheme = theme && theme.startsWith('theme-') ? theme : `theme-${theme || 'dark'}`;
  const dataTheme = cleanTheme.replace('theme-', '');

  document.documentElement.className = cleanTheme;
  document.documentElement.setAttribute('data-theme', dataTheme);
  document.body.className = cleanTheme;
  document.body.setAttribute('data-theme', dataTheme);
  localStorage.setItem('sr_theme', cleanTheme);

  document.querySelectorAll('.btn-theme').forEach((btn) => {
    const isSelected = btn.dataset.theme === cleanTheme;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('sr_theme') || 'theme-dark';
  setAppTheme(savedTheme);

  document.querySelectorAll('.btn-theme').forEach((btn) => {
    btn.addEventListener('click', () => {
      setAppTheme(btn.dataset.theme);
      showToast(`Tema alterado para: ${btn.textContent.trim()}`, 'info');
    });
  });
}

window.addEventListener('pageshow', () => {
  const savedTheme = localStorage.getItem('sr_theme') || 'theme-dark';
  setAppTheme(savedTheme);
});

/* ─── ATALHOS DE TECLADO ─── */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;

  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      e.preventDefault();
      nextPage();
      break;
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault();
      prevPage();
      break;
    case '+':
    case '=':
      e.preventDefault();
      setZoom(state.scale + 0.2);
      break;
    case '-':
    case '_':
      e.preventDefault();
      setZoom(state.scale - 0.2);
      break;
    case 'r':
    case 'R':
      e.preventDefault();
      if (!state.isSpeaking) startReading();
      else stopReading();
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'o':
    case 'O':
      e.preventDefault();
      fileInput?.click();
      break;
    case 's':
    case 'S':
      e.preventDefault();
      if (state.pdfDoc && state.fileName) {
        saveProgress(state.fileName, state.pageNum);
        showToast(`Progresso salvo: Página ${state.pageNum}.`, 'success');
      }
      break;
    case '?':
      abrirModalShortcuts();
      break;
    case 'Escape':
      stopReading();
      fecharModalShortcuts();
      fecharLogin();
      break;
  }
});

/* ─── MODAL GUIA DE ATALHOS ─── */
function abrirModalShortcuts() {
  if (modalShortcuts) modalShortcuts.classList.add('active');
}
function fecharModalShortcuts() {
  if (modalShortcuts) modalShortcuts.classList.remove('active');
}

btnShowShortcuts?.addEventListener('click', abrirModalShortcuts);
btnFecharShortcuts?.addEventListener('click', fecharModalShortcuts);
modalShortcuts?.addEventListener('click', (e) => {
  if (e.target === modalShortcuts) fecharModalShortcuts();
});

/* ─── HABILITAR/DESABILITAR CONTROLES ─── */
function enableControls(enabled) {
  const ids = [
    'btn-prev', 'btn-next', 'btn-zoom-in', 'btn-zoom-out',
    'btn-zoom-fit', 'btn-zoom-reset', 'page-input', 'zoom-slider',
    'btn-tts-play', 'search-input', 'btn-search', 'btn-ocr',
    'btn-libras', 'btn-highlight', 'btn-download-pdf', 'btn-save-progress'
  ];

  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !enabled;
  });
}

/* ─── SUPABASE AUTH MODAL ─── */
const modalAuth = $('modal-auth');
const formAuth = $('form-auth');
const authEmail = $('auth-email');
const authSenha = $('auth-senha');
const btnAuthSubmit = $('btn-auth-submit');
const authTitle = $('auth-title');
const authToggleLink = $('auth-toggle-link');
const authToggleMsg = $('auth-toggle-msg');
const btnFecharAuth = $('btn-fechar-auth');
let modoCadastro = false;

function abrirLogin() {
  if (modalAuth) modalAuth.classList.add('active');
}
function fecharLogin() {
  if (modalAuth) modalAuth.classList.remove('active');
}

btnFecharAuth?.addEventListener('click', fecharLogin);
modalAuth?.addEventListener('click', (e) => {
  if (e.target === modalAuth) fecharLogin();
});

authToggleLink?.addEventListener('click', (e) => {
  e.preventDefault();
  modoCadastro = !modoCadastro;
  authTitle.innerText = modoCadastro ? 'Criar Nova Conta' : 'Acessar Conta';
  btnAuthSubmit.innerText = modoCadastro ? 'Cadastrar-se' : 'Entrar';
  authToggleMsg.innerText = modoCadastro ? 'Já possui conta?' : 'Não possui uma conta?';
  authToggleLink.innerText = modoCadastro ? 'Fazer login' : 'Cadastrar-se';
});

formAuth?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authSenha.value;

  if (!window.supabaseClient) {
    showToast('Serviço de autenticação temporariamente indisponível.', 'error');
    return;
  }

  try {
    if (modoCadastro) {
      const { error } = await window.supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      showToast('Conta criada com sucesso!', 'success');
    } else {
      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast('Login realizado com sucesso!', 'success');
    }
    fecharLogin();
    atualizarInterfaceUsuario();
  } catch (err) {
    showToast(err.message || 'Erro ao realizar login.', 'error');
  }
});

async function atualizarInterfaceUsuario() {
  const btnConta = $('btn-conta-sidebar');
  if (!btnConta || !window.supabaseClient) return;

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (user) {
      const userIdent = user.email.split('@')[0];
      btnConta.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        ${userIdent} (Sair)
      `;
      btnConta.onclick = async () => {
        await window.supabaseClient.auth.signOut();
        showToast('Você saiu da conta.', 'info');
        atualizarInterfaceUsuario();
      };
    } else {
      btnConta.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        Entrar / Cadastrar
      `;
      btnConta.onclick = abrirLogin;
    }
  } catch (err) {
    console.warn('Erro ao verificar usuário:', err);
  }
}

/* ─── STATUS DE REDE (ONLINE/OFFLINE) ─── */
function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  const pill = $('status-network-sidebar');
  if (pill) {
    pill.className = isOnline ? 'badge badge-online' : 'badge badge-offline';
    pill.textContent = isOnline ? 'Online' : 'Offline';
  }
  if (statusOffline) {
    statusOffline.style.display = isOnline ? 'none' : 'inline-flex';
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

/* ─── CARREGAR LIVRO SELECIONADO NA BIBLIOTECA (VIA QUERY STRING) ─── */
async function carregarLivroSelecionado() {
  const parametros = new URLSearchParams(window.location.search);
  const pdfUrl = parametros.get('pdf');
  const titulo = parametros.get('title') || 'Livro Selecionado';

  if (!pdfUrl) return false;

  try {
    setStatus('Buscando obra no acervo em nuvem…');
    if (docTitle) docTitle.textContent = titulo;
    if (fileInfo) fileInfo.textContent = `${titulo} (Acervo Nuvem)`;

    let res;
    try {
      res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (directErr) {
      console.warn('Tentativa direta falhou ou bloqueada por CORS, tentando proxy seguro...', directErr);
      if (!pdfUrl.includes('/api/proxy-pdf')) {
        res = await fetch(`/api/proxy-pdf?url=${encodeURIComponent(pdfUrl)}`);
        if (!res.ok) throw new Error(`Falha no proxy HTTP ${res.status}`);
      } else {
        throw directErr;
      }
    }

    const blob = await res.blob();
    const nomeArquivo = titulo.toLowerCase().endsWith('.pdf') ? titulo : `${titulo}.pdf`;
    const arquivo = new File([blob], nomeArquivo, { type: 'application/pdf' });

    loadPDF(arquivo);
    return true;
  } catch (err) {
    console.error('Erro ao abrir livro selecionado:', err);
    showToast('Falha ao carregar o livro da nuvem.', 'error');
    setStatus('Erro ao carregar livro.');
    return false;
  }
}

/* ─── AUTO-RESTAURAÇÃO DE SESSÃO AO CARREGAR ─── */
(async function initSession() {
  initTheme();
  initSidebarResizer();
  enableControls(false);
  updateNetworkStatus();
  setTimeout(atualizarInterfaceUsuario, 300);

  const parametros = new URLSearchParams(window.location.search);

  // 1. Se veio com parâmetro ?pdf=... (abre livro da biblioteca)
  if (parametros.get('pdf')) {
    const loaded = await carregarLivroSelecionado();
    if (loaded) return;
  }

  const savedName = localStorage.getItem('sr_current_filename');
  const arrayBuffer = await loadPDFFromStorage();

  // 2. Se veio de um upload local ?uploaded=1 ou tem sessão anterior no IndexedDB
  if (arrayBuffer && savedName) {
    setStatus('Restaurando sessão de leitura anterior…');
    state.fileName = savedName;
    state.ocrProcessed.clear();
    state.ocrText = '';

    if (docTitle) docTitle.textContent = savedName;
    if (fileInfo) fileInfo.textContent = `${savedName} (Sessão Restaurada)`;

    const typedarray = new Uint8Array(arrayBuffer);

    pdfjsLib.getDocument(typedarray).promise
      .then((pdf) => {
        state.pdfDoc = pdf;
        const savedPage = loadProgress(savedName) || 1;
        state.pageNum = savedPage <= pdf.numPages ? savedPage : 1;

        if (pageTotal) pageTotal.textContent = pdf.numPages;
        if (pageInput) {
          pageInput.max = pdf.numPages;
          pageInput.value = state.pageNum;
        }

        enableControls(true);
        renderPage(state.pageNum);
        showToast('Sessão restaurada com sucesso.', 'info', 2000);
      })
      .catch((err) => {
        console.warn('Erro ao restaurar PDF do storage:', err);
        setStatus('Pronto');
      });
  } else {
    setStatus('Pronto para leitura');
  }
})();
