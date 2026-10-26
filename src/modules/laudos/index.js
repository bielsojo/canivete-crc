/* Gerador de laudos — Declaração de Doação ou Descarte em PDF (A4 paisagem), com as NFs, RATs e
   evidências anexadas. Tudo roda no navegador; o estado fica salvo no IndexedDB deste computador. */
import * as XLSX from 'xlsx';
import * as PDFLib from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { ASSETS } from './assets.js';
import { dbStore } from '../../core/db.js';
import { $, ic, esc, ask, alertBox, progress, pageHead, dropzone } from '../../core/ui.js';
import './laudos.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Namespace dos handlers inline da tabela (oninput="LD.updateCell(...)").
const LD = window.LD = {};
let equipments = [];
let uploadedFiles = []; // { name, size, buffer, extractedText, type: 'nf' | 'rat' | 'evidence' }
let nextEquipId = 1;
let mounted = false;

// Dados fixos da Low Cost
const LOW_COST_INFO = {
  name: "LOWCOST GERENCIAMENTO DE SERVIÇOS LTDA",
  cnpj: "01.482.939/0001-00",
  address: "Av. Tamboré, 1400, Sala 39 – Tamboré – Barueri – SP – Cep: 06.460-000",
  footerAddress: "Rua Manuel de Nobrega, 986 – 4º andar – Paraiso SP – CEP: 04001-003"
};

const alert = msg => alertBox('Atenção', esc(msg));
const toggleProgress = (show, title = '', subtitle = '', percent = 0) => progress(show, title, subtitle, percent);

/* =====================================================================
   TELA
   ===================================================================== */
function template(){
  return pageHead('Gerador de laudos', 'Monte a declaração de doação ou descarte, vincule NFs e RATs e baixe um PDF único com tudo anexado.',
    `<button class="btn ghost" id="clearBtn">${ic('rec','sm')} Limpar tudo</button><button class="btn primary" id="generateBtn">${ic('dl','sm')} Gerar laudo completo</button>`) + `
  <div class="ld-steps">
    <section class="card">
      <div class="card-h"><h3><span class="ld-n">1</span> Configurações do laudo</h3></div>
      <div class="card-b"><div class="ld-grid">
        <div class="field"><label for="operationType">Tipo de operação</label><select class="input" id="operationType"><option value="doacao" selected>Doação de equipamentos</option><option value="descarte">Descarte de equipamentos</option></select></div>
        <div class="field"><label for="laudoNumber">Número do laudo</label><input class="input mono" id="laudoNumber" placeholder="Ex.: 505" value="505"></div>
        <div class="field"><label for="destName">Razão social do destinatário</label><input class="input" id="destName" placeholder="Ex.: OMEGA INFORMATICA LTDA" value="OMEGA INFORMATICA INDUSTRIA E COMERCIO LTDA."></div>
        <div class="field"><label for="destCnpj">CNPJ do destinatário</label><input class="input mono" id="destCnpj" placeholder="00.000.000/0001-00" value="07.125.881/0001-16"></div>
      </div>
      <div class="field" style="margin-top:14px"><label for="destAddress">Endereço do destinatário</label><textarea class="input" id="destAddress" rows="2" placeholder="Endereço completo">RUA IRMAO LUIZ VICENTE, 292 - CAJURU, CURITIBA - PR, 82.900-140</textarea>
        <span class="help" id="descHelp" hidden>No descarte, o destinatário não é usado: o texto aponta para a planilha preenchida no SharePoint.</span></div>
      <textarea id="declarationText" hidden></textarea></div>
    </section>

    <section class="card">
      <div class="card-h"><h3><span class="ld-n">2</span> Equipamentos e documentos</h3><button class="btn sm" id="importExcelBtn">${ic('sheet','sm')} Importar planilha</button></div>
      <div class="card-b">
        <input type="file" id="fileExcel" accept=".xlsx" hidden>
        <div class="ld-drops">
          <button class="drop" id="dropzoneNf">${ic('doc')}<b>Notas fiscais (NF)</b><span class="req" style="color:var(--bad)">Obrigatório</span><span class="small">PDFs de envio e retorno</span></button>
          <button class="drop" id="dropzoneRat">${ic('list')}<b>Relatórios técnicos (RAT)</b><span class="req" style="color:var(--bad)">Obrigatório</span><span class="small">um por equipamento</span></button>
          <button class="drop" id="dropzoneEvidence">${ic('img')}<b>Evidências</b><span class="req">Opcional</span><span class="small">PDF ou imagem</span></button>
        </div>
        <input type="file" id="fileNf" accept=".pdf" multiple hidden><input type="file" id="fileRat" accept=".pdf" multiple hidden><input type="file" id="fileEvidence" accept=".pdf,image/*" multiple hidden>
        <div id="filesTrackerCard" style="display:none;margin-top:14px">
          <div class="sec-t">Arquivos carregados (<span id="uploadedFilesCount">0</span>)<button class="btn sm ghost" id="clearFilesBtn">${ic('trash','sm')} Remover todos</button></div>
          <div class="ld-files" id="uploadedFilesList"></div>
        </div>
      </div>
    </section>

    <section class="tbl-wrap">
      <div class="tbl-head"><h3><span class="ld-n">3</span> Conferência dos equipamentos</h3><button class="btn sm" id="addRowBtn">${ic('plus','sm')} Adicionar equipamento</button></div>
      <div class="tbl-scroll"><table class="ld-table"><thead><tr>
        <th style="width:40px">Nº</th><th style="min-width:220px">Origem / localidade</th><th style="min-width:180px">Marca / modelo</th><th style="min-width:130px">Serial</th>
        <th style="min-width:90px">Contador</th><th style="min-width:80px">Idade</th><th style="min-width:170px">NF envio</th><th style="min-width:170px">NF devolução</th><th>Obs.</th><th></th>
      </tr></thead><tbody id="equipTableBody"></tbody></table></div>
    </section>

    <section>
      <div class="sec-t" style="margin:6px 0 10px"><span>${ic('eye','sm')} Prévia da capa (A4 paisagem)</span><span class="small muted" style="text-transform:none;letter-spacing:0;font-weight:500">igual ao laudo oficial consolidado</span></div>
      <div class="a4-landscape-preview-wrapper" id="a4wrap"><div class="a4-scale" id="a4scale"><div class="a4-landscape-page" id="previewPage">
        <div class="pdf-header"><img id="previewLogo" class="pdf-logo" alt="Logo Low Cost">
          <div class="pdf-meta-right"><div class="doc-code">F.8.5A_ATIM002</div><div style="margin-top:5px">Nº:</div><div class="doc-number" id="previewDocNumber">505</div></div></div>
        <div class="pdf-title-container"><div class="pdf-title" id="previewDocTitle">Declaração de Doação</div><div class="pdf-date" id="previewDocDate"></div></div>
        <div class="pdf-body-text" id="previewDocText"></div>
        <div class="pdf-table-container"><table class="pdf-table"><thead><tr>
          <th style="width:3%">Nº</th><th style="width:25%">ORIGEM / LOCALIDADE</th><th style="width:22%">MARCA/MODELO</th><th style="width:12%">SERIAL</th><th style="width:8%">ÚLTIMO CONTADOR</th>
          <th style="width:9%">IDADE DO EQUIPAMENTO</th><th style="width:7%">NF DE ENVIO</th><th style="width:7%">NF DE DEVOLUÇÃO</th><th style="width:7%">OBSERVAÇÃO CONTADOR</th>
        </tr></thead><tbody id="previewTableBody"></tbody></table></div>
        <div style="display:flex;flex-direction:column;align-items:center;width:100%">
          <div id="previewFooterAddress" style="font-size:8px;color:#444;margin-bottom:5px;font-family:Arial,sans-serif;text-align:center"></div>
          <img id="previewFooterBanner" class="pdf-footer-banner" style="width:100%;object-fit:fill" alt="">
        </div>
      </div></div></div>
    </section>
  </div>`;
}

// A prévia tem o tamanho real (1000×707); escala para caber na largura disponível.
let ro = null;
function fitPreview(){
  const w = $('#a4wrap'), box = $('#a4scale'), page = $('#previewPage');
  if (!w || !box || !page) return;
  const k = Math.min(1, (w.clientWidth - 32) / 1000);
  page.style.transform = `scale(${k})`;
  box.style.width = (1000 * k) + 'px'; box.style.height = (707 * k) + 'px';
}

function syncDestFields(){
  const isDescarte = $('#operationType').value === 'descarte';
  ['destName', 'destCnpj', 'destAddress'].forEach(id => { $('#' + id).disabled = isDescarte; });
  $('#descHelp').hidden = !isDescarte;
}

async function initLaudos(el){
  el.innerHTML = template();
  try {
    const cached = await dbStore.get('laudos_state');
    if (cached && cached.data){
      const st = cached.data;
      if (st.operationType) $('#operationType').value = st.operationType;
      ['laudoNumber', 'destName', 'destCnpj', 'destAddress'].forEach(k => { if (st[k] !== undefined) $('#' + k).value = st[k]; });
      if (st.equipments) equipments = st.equipments;
      if (st.uploadedFiles) uploadedFiles = st.uploadedFiles;
      if (st.nextEquipId) nextEquipId = st.nextEquipId;
    }
  } catch(e){ console.error('Erro ao carregar o laudo salvo:', e); }
  if (!mounted) return;
  if (uploadedFiles.length){ $('#filesTrackerCard').style.display = 'block'; updateFilesTracker(); }

  $('#operationType').addEventListener('change', e => { handleOperationChange(e); syncDestFields(); saveLaudosState(); });
  ['laudoNumber', 'destName', 'destCnpj', 'destAddress'].forEach(id => $('#' + id).addEventListener('input', () => { updatePreview(); saveLaudosState(); }));
  $('#addRowBtn').onclick = () => addNewRow();
  $('#clearBtn').onclick = clearAll;
  $('#clearFilesBtn').onclick = clearAllFiles;
  $('#generateBtn').onclick = generateReport;
  $('#importExcelBtn').onclick = () => $('#fileExcel').click();
  $('#fileExcel').onchange = e => { if (e.target.files.length) handleExcelUpload(e.target.files); e.target.value = ''; };
  dropzone($('#dropzoneNf'), $('#fileNf'), f => handleFilesUpload(f, 'nf'));
  dropzone($('#dropzoneRat'), $('#fileRat'), f => handleFilesUpload(f, 'rat'));
  dropzone($('#dropzoneEvidence'), $('#fileEvidence'), f => handleFilesUpload(f, 'evidence'));
  $('#uploadedFilesList').addEventListener('click', e => { const b = e.target.closest('[data-rmf]'); if (b) removeUploadedFile(+b.dataset.rmf); });

  syncDestFields();
  if (!equipments.length) addNewRow(); else renderTable();
  updatePreview();
  ro = new ResizeObserver(fitPreview); ro.observe($('#a4wrap')); fitPreview();
}

function updateFilesTracker(){
  const list = $('#uploadedFilesList'), count = $('#uploadedFilesCount');
  if (!list || !count) return;
  count.innerText = uploadedFiles.length;
  const tag = {nf:'<span class="badge b-acc">NF</span>', rat:'<span class="badge b-ok">RAT</span>', evidence:'<span class="badge">EVID</span>'};
  list.innerHTML = uploadedFiles.map((f, i) => `<span class="ld-file">${tag[f.type] || tag.evidence}<span class="trunc" title="${esc(f.name)}">${esc(f.name)}</span><button class="ibtn" data-rmf="${i}" title="Remover arquivo">${ic('x','sm')}</button></span>`).join('');
}

// Tabela de conferência: cada equipamento tem uma linha de dados e uma linha de vínculos (NF, RAT, evidência).
function renderTable(){
  const tbody = $('#equipTableBody');
  if (!tbody) return;
  const opts = (type, ph) => `<option value="">${ph}</option>` + uploadedFiles.filter(f => f.type === type).map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  const nfOptions = opts('nf', '— NF —'), ratOptions = opts('rat', '— selecione o RAT —'), evOptions = opts('evidence', '— selecione a evidência —');
  const inp = (eq, field, val, cls = '') => `<input class="input ld-cell ${cls}" value="${esc(val)}" oninput="LD.updateCell(${eq.id}, '${field}', this.value)">`;
  tbody.innerHTML = equipments.map((eq, index) => {
    const envio = eq.nfEnvio || (eq.nfEnvioFile ? extractNfNumber(eq.nfEnvioFile) : '');
    const devol = eq.nfDevolucao || (eq.nfDevolucaoFile ? extractNfNumber(eq.nfDevolucaoFile) : '');
    const ok = (on, yes, no, req = true) => on ? `<span class="badge b-ok">${ic('check')}${yes}</span>` : req ? `<span class="badge b-bad">${ic('x')}${no}</span>` : '';
    return `<tr class="ld-main">
      <td class="strong" style="text-align:center">${index + 1}</td>
      <td>${inp(eq, 'origin', eq.origin)}</td><td>${inp(eq, 'model', eq.model)}</td><td>${inp(eq, 'serial', eq.serial, 'mono')}</td>
      <td>${inp(eq, 'counter', eq.counter)}</td><td>${inp(eq, 'age', eq.age)}</td>
      <td><div class="ld-stack">${inp(eq, 'nfEnvio', envio, 'mono')}<select class="input ld-cell" data-v="${esc(eq.nfEnvioFile || '')}" onchange="LD.updateCell(${eq.id}, 'nfEnvioFile', this.value)">${nfOptions}</select></div></td>
      <td><div class="ld-stack">${inp(eq, 'nfDevolucao', devol, 'mono')}<select class="input ld-cell" data-v="${esc(eq.nfDevolucaoFile || '')}" onchange="LD.updateCell(${eq.id}, 'nfDevolucaoFile', this.value)">${nfOptions}</select></div></td>
      <td><span class="badge">${esc(eq.observation)}</span></td>
      <td><button class="ibtn" title="Remover equipamento" onclick="LD.removeRow(${eq.id})" style="color:var(--bad)">${ic('trash','sm')}</button></td>
    </tr>
    <tr class="ld-links"><td></td>
      <td colspan="5"><div class="ld-badges">${ok(eq.nfEnvioFile, 'NF de envio vinculada', 'Sem NF de envio (obrigatório)')}${ok(eq.ratFile, 'RAT vinculado', 'Sem RAT (obrigatório)')}${ok(eq.evidenceFile, 'Evidência vinculada', '', false)}</div></td>
      <td colspan="4"><div class="ld-binds">
        <label>RAT <select class="input ld-cell" data-v="${esc(eq.ratFile || '')}" onchange="LD.updateCell(${eq.id}, 'ratFile', this.value)">${ratOptions}</select></label>
        <label>Evidência <select class="input ld-cell" data-v="${esc(eq.evidenceFile || '')}" onchange="LD.updateCell(${eq.id}, 'evidenceFile', this.value)">${evOptions}</select></label>
      </div></td></tr>`;
  }).join('');
  tbody.querySelectorAll('select[data-v]').forEach(s => { if (s.dataset.v) s.value = s.dataset.v; });
}

async function clearAll(){
  if (!await ask('Limpar o laudo?', 'Equipamentos, arquivos e dados do destinatário serão apagados deste navegador.', 'Limpar tudo', 'bad')) return;
  equipments = []; uploadedFiles = []; nextEquipId = 1;
  ['laudoNumber', 'destName', 'destCnpj', 'destAddress'].forEach(id => $('#' + id).value = '');
  $('#filesTrackerCard').style.display = 'none';
  updateFilesTracker();
  addNewRow();
  updatePreview();
}
async function clearAllFiles(){
  if (!await ask('Remover todos os arquivos?', 'As NFs, RATs e evidências carregadas saem do laudo e os vínculos com os equipamentos são desfeitos.', 'Remover', 'bad')) return;
  uploadedFiles = [];
  equipments.forEach(eq => { eq.nfEnvioFile = null; eq.nfDevolucaoFile = null; eq.ratFile = null; eq.evidenceFile = null; });
  $('#filesTrackerCard').style.display = 'none';
  updateFilesTracker(); renderTable(); updatePreview(); saveLaudosState();
}

/* =====================================================================
   LÓGICA DO LAUDO (Gerador de Laudos v1.7, sem alterações de regra)
   ===================================================================== */
// Operation Type change handler
function handleOperationChange(e) {
    const op = e ? e.target.value : (document.getElementById("operationType")?.value || "doacao");
    const val = op === "doacao" ? "DOAÇÃO" : "DESCARTE";
    const isDescarte = op === "descarte";

    const destName = document.getElementById("destName");
    const destCnpj = document.getElementById("destCnpj");
    const destAddress = document.getElementById("destAddress");

    if (destName) destName.disabled = isDescarte;
    if (destCnpj) destCnpj.disabled = isDescarte;
    if (destAddress) destAddress.disabled = isDescarte;

    equipments.forEach(eq => {
        eq.observation = val;
    });

    renderTable();
    updatePreview();
}
// Process Excel Upload
function handleExcelUpload(files) {
    const file = files[0];
    if (!file) return;

    toggleProgress(true, "Lendo Planilha Excel", "Carregando dados dos equipamentos...", 20);

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Extract metadata (Laudo #)
            const j4Val = worksheet['J4'] ? worksheet['J4'].v : (worksheet['J3'] ? worksheet['J3'].v : null);
            if (j4Val) {
                document.getElementById("laudoNumber").value = j4Val;
            }

            // Parse table row headers
            const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            let startRowIdx = 18;
            let headerFound = false;

            for (let i = 0; i < Math.min(30, jsonRows.length); i++) {
                const row = jsonRows[i];
                if (row && row.some(cell => typeof cell === 'string' && cell.toUpperCase().includes('SERIAL'))) {
                    startRowIdx = i;
                    headerFound = true;
                    break;
                }
            }

            if (headerFound) {
                const headers = jsonRows[startRowIdx].map(h => h ? h.toString().toUpperCase().trim() : '');

                const idxSerial = headers.findIndex(h => h.includes('SERIAL'));
                const idxOrigem = headers.findIndex(h => h.includes('ORIGEM') || h.includes('LOCALIDADE'));
                const idxModelo = headers.findIndex(h => h.includes('MARCA') || h.includes('MODELO'));
                const idxContador = headers.findIndex(h => h.includes('CONTADOR') || h.includes('CÓD.'));
                const idxIdade = headers.findIndex(h => h.includes('IDADE'));
                const idxNfEnvio = headers.findIndex(h => h.includes('NF DE ENVIO') || h.includes('NF ENVIO') || h.includes('NF DE SAÍDA') || h.includes('ENVIO'));
                const idxNfDevolucao = headers.findIndex(h => h.includes('NF DE DEVOLUÇÃO') || h.includes('DEVOLUÇÃO') || h.includes('RETORNO'));

                equipments = [];
                nextEquipId = 1;

                const currentOp = document.getElementById("operationType").value;
                const opText = currentOp === "doacao" ? "DOAÇÃO" : "DESCARTE";

                for (let r = startRowIdx + 1; r < jsonRows.length; r++) {
                    const row = jsonRows[r];
                    if (!row || !row[idxSerial]) continue;

                    const serial = row[idxSerial].toString().trim();
                    const origin = idxOrigem !== -1 && row[idxOrigem] ? row[idxOrigem].toString().trim() : '';
                    const model = idxModelo !== -1 && row[idxModelo] ? row[idxModelo].toString().trim() : '';
                    const counter = idxContador !== -1 && row[idxContador] ? row[idxContador].toString().trim() : '0';
                    const age = idxIdade !== -1 && row[idxIdade] ? row[idxIdade].toString().trim() : '';
                    const nfEnvio = idxNfEnvio !== -1 && row[idxNfEnvio] ? row[idxNfEnvio].toString().trim() : '';
                    const nfDevolucao = idxNfDevolucao !== -1 && row[idxNfDevolucao] ? row[idxNfDevolucao].toString().trim() : '';

                    equipments.push({
                        id: nextEquipId++,
                        origin: origin,
                        model: model,
                        serial: serial,
                        counter: counter,
                        age: age,
                        nfEnvio: nfEnvio,
                        nfDevolucao: nfDevolucao,
                        observation: opText,
                        nfEnvioFile: null,
                        nfDevolucaoFile: null,
                        ratFile: null
                    });
                }
            } else {
                alert("Não foi possível encontrar a linha de cabeçalho na planilha.");
            }

            if (equipments.length === 0) addNewRow();

            autoMatchFiles();
            renderTable();
            updatePreview();
            toggleProgress(false);
            saveLaudosState();

        } catch (error) {
            console.error(error);
            alert("Erro ao processar o arquivo Excel.");
            toggleProgress(false);
        }
    };
    reader.readAsArrayBuffer(file);
}
// Fast fallback to extract readable strings and serials from binary PDF buffer
function extractRawStringsFromBuffer(buffer) {
    try {
        const uint8 = new Uint8Array(buffer);
        let result = "";
        let str = "";
        const len = uint8.length;
        for (let i = 0; i < len; i++) {
            const byte = uint8[i];
            if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || (byte >= 192 && byte <= 255)) {
                str += String.fromCharCode(byte);
            } else {
                if (str.length > 2) {
                    result += str + " ";
                }
                str = "";
            }
        }
        if (str.length > 2) result += str;
        return result;
    } catch (e) {
        return "";
    }
}

// Process separate uploads for NF, RAT, Evidence
async function handleFilesUpload(files, type) {
    if (!files || files.length === 0) return;

    const trackerCard = document.getElementById("filesTrackerCard");
    if (trackerCard) trackerCard.style.display = "block";
    toggleProgress(true, "Processando Documentos", "Lendo arquivos selecionados...", 0);

    const total = files.length;
    for (let i = 0; i < total; i++) {
        const file = files[i];
        const percent = Math.round((i / total) * 100);
        toggleProgress(true, "Processando Documentos", `Lendo ${file.name} (${i + 1}/${total})...`, percent);

        try {
            const buffer = await file.arrayBuffer();
            let text = "";
            if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
                try {
                    text = await extractTextFromPdf(buffer.slice(0));
                } catch (extractErr) {
                    console.warn("PDF extract fallback for " + file.name, extractErr);
                    text = extractRawStringsFromBuffer(buffer);
                }
            }

            // Keep tracker, separate by type
            const existingIdx = uploadedFiles.findIndex(f => f.name === file.name && f.size === file.size);
            const fileObj = {
                name: file.name,
                size: file.size,
                buffer: buffer,
                extractedText: text || "",
                type: type // 'nf' | 'rat' | 'evidence'
            };

            if (existingIdx >= 0) {
                uploadedFiles[existingIdx] = fileObj;
            } else {
                uploadedFiles.push(fileObj);
            }
        } catch (e) {
            console.error("Error reading file:", file.name, e);
        }
    }

    updateFilesTracker();

    toggleProgress(true, "Associação Automática", "Mapeando notas fiscais e relatórios técnicos aos equipamentos...", 85);
    autoMatchFiles();

    renderTable();
    updatePreview();
    toggleProgress(false);
    saveLaudosState();
}

// Text extraction using PDF.js with graceful fallback
async function extractTextFromPdf(arrayBuffer) {
    try {
        if (pdfjsLib) {
            try {
                const loadingTask = pdfjsLib.getDocument({
                    data: new Uint8Array(arrayBuffer),
                    isEvalSupported: false,
                    useSystemFonts: true
                });
                const pdf = await loadingTask.promise;
                let fullText = "";
                const maxPages = Math.min(10, pdf.numPages);
                for (let i = 1; i <= maxPages; i++) {
                    try {
                        const page = await pdf.getPage(i);
                        const content = await page.getTextContent();
                        const pageText = content.items.map(item => item.str || "").join(" ");
                        fullText += pageText + "\n";
                    } catch (pageErr) {
                        console.warn("Error reading page " + i, pageErr);
                    }
                }
                if (fullText.trim().length > 0) {
                    return fullText;
                }
            } catch (pdfErr) {
                console.warn("PDF.js worker unavailable, falling back to raw buffer:", pdfErr);
            }
        }
        return extractRawStringsFromBuffer(arrayBuffer);
    } catch (err) {
        console.warn("PDF extraction fallback error:", err);
        return extractRawStringsFromBuffer(arrayBuffer);
    }
}
// Remove uploaded file
function removeUploadedFile(index) {
    const file = uploadedFiles[index];
    if (!file) return;

    equipments.forEach(eq => {
        if (eq.nfEnvioFile === file.name) eq.nfEnvioFile = null;
        if (eq.nfDevolucaoFile === file.name) eq.nfDevolucaoFile = null;
        if (eq.ratFile === file.name) eq.ratFile = null;
        if (eq.evidenceFile === file.name) eq.evidenceFile = null;
    });

    uploadedFiles.splice(index, 1);
    updateFilesTracker();
    renderTable();
    updatePreview();

    if (uploadedFiles.length === 0) {
        document.getElementById("filesTrackerCard").style.display = "none";
    }
    saveLaudosState();
}
// Helper to extract NF number from filename or extracted text
function extractNfNumber(filename, text = "") {
    if (!filename) return "";
    const baseName = filename.split(/[/\\]/).pop().replace(/\.[^/.]+$/, "").trim();
    const digitsMatches = baseName.match(/\d+/g);
    if (digitsMatches && digitsMatches.length > 0) {
        const longMatch = digitsMatches.find(m => m.length >= 4);
        return longMatch || digitsMatches[0];
    }
    if (text) {
        const textMatch = text.match(/(?:N[ºo°\.]|NF|NFE|NOTA\s+FISCAL|DANFE|NÚMERO)[\s:]*([0-9]{1,9})/i);
        if (textMatch) return textMatch[1];
        const anyNumber = text.match(/\b\d{4,9}\b/);
        if (anyNumber) return anyNumber[0];
    }
    return baseName;
}

// Auto match uploaded files based on type and content
function autoMatchFiles() {
    if (uploadedFiles.length === 0 || equipments.length === 0) return;

    equipments.forEach(eq => {
        const serialClean = eq.serial ? eq.serial.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
        const nfEnvioClean = eq.nfEnvio ? eq.nfEnvio.toUpperCase().replace(/[^0-9]/g, '') : '';
        const nfDevolucaoClean = eq.nfDevolucao ? eq.nfDevolucao.toUpperCase().replace(/[^0-9]/g, '') : '';

        uploadedFiles.forEach(file => {
            const fileNameUpper = file.name.toUpperCase();
            const textUpper = (file.extractedText || '').toUpperCase();
            const textClean = textUpper.replace(/[^A-Z0-9]/g, '');

            // 1. Match RAT / OS by Serial Number in RAT-type files
            if (file.type === 'rat' && serialClean) {
                if (fileNameUpper.includes(serialClean) || textClean.includes(serialClean)) {
                    if (!eq.ratFile) eq.ratFile = file.name;
                }
            }

            // 2. Match NFs in NF-type files by Invoice Numbers or Serials
            if (file.type === 'nf') {
                const isMatchEnvio = (nfEnvioClean && (fileNameUpper.includes(nfEnvioClean) || textClean.includes(nfEnvioClean))) ||
                                    (serialClean && (fileNameUpper.includes(serialClean) || textClean.includes(serialClean)));
                
                const isMatchDevolucao = nfDevolucaoClean && (fileNameUpper.includes(nfDevolucaoClean) || textClean.includes(nfDevolucaoClean));

                if (isMatchEnvio && !eq.nfEnvioFile) {
                    eq.nfEnvioFile = file.name;
                    const num = extractNfNumber(file.name, file.extractedText);
                    if (num && (!eq.nfEnvio || eq.nfEnvio === '-')) eq.nfEnvio = num;
                }

                if (isMatchDevolucao && !eq.nfDevolucaoFile) {
                    eq.nfDevolucaoFile = file.name;
                    const num = extractNfNumber(file.name, file.extractedText);
                    if (num && (!eq.nfDevolucao || eq.nfDevolucao === '-')) eq.nfDevolucao = num;
                }

                // If single equipment and files uploaded as NF
                if (equipments.length === 1) {
                    const isRetorno = fileNameUpper.includes('RETORNO') || fileNameUpper.includes('DEV');
                    if (isRetorno && !eq.nfDevolucaoFile) {
                        eq.nfDevolucaoFile = file.name;
                        const num = extractNfNumber(file.name, file.extractedText);
                        if (num && (!eq.nfDevolucao || eq.nfDevolucao === '-')) eq.nfDevolucao = num;
                    } else if (!isRetorno && !eq.nfEnvioFile) {
                        eq.nfEnvioFile = file.name;
                        const num = extractNfNumber(file.name, file.extractedText);
                        if (num && (!eq.nfEnvio || eq.nfEnvio === '-')) eq.nfEnvio = num;
                    }
                }
            }
        });

        // Auto extract NF numbers if files are selected
        if (eq.nfEnvioFile && (!eq.nfEnvio || eq.nfEnvio.trim() === '' || eq.nfEnvio.trim() === '-')) {
            const f = uploadedFiles.find(u => u.name === eq.nfEnvioFile);
            eq.nfEnvio = extractNfNumber(eq.nfEnvioFile, f ? f.extractedText : "");
        }
        if (eq.nfDevolucaoFile && (!eq.nfDevolucao || eq.nfDevolucao.trim() === '' || eq.nfDevolucao.trim() === '-')) {
            const f = uploadedFiles.find(u => u.name === eq.nfDevolucaoFile);
            eq.nfDevolucao = extractNfNumber(eq.nfDevolucaoFile, f ? f.extractedText : "");
        }
    });
}

// Add equipment row manually
function addNewRow() {
    const currentOp = document.getElementById("operationType").value;
    const opText = currentOp === "doacao" ? "DOAÇÃO" : "DESCARTE";

    equipments.push({
        id: nextEquipId++,
        origin: "",
        model: "",
        serial: "",
        counter: "",
        age: "",
        nfEnvio: "",
        nfDevolucao: "",
        observation: opText,
        nfEnvioFile: null,
        nfDevolucaoFile: null,
        ratFile: null,
        evidenceFile: null
    });

    renderTable();
    updatePreview();
    saveLaudosState();
}

function removeRow(id) {
    equipments = equipments.filter(eq => eq.id !== id);
    if (equipments.length === 0) {
        addNewRow();
    } else {
        renderTable();
        updatePreview();
    }
    saveLaudosState();
}

function updateCell(id, field, value) {
    const eq = equipments.find(eq => eq.id === id);
    if (eq) {
        eq[field] = value;

        // Automatically extract and set NF number if file is updated
        if (field === 'nfEnvioFile' && value) {
            const fileObj = uploadedFiles.find(f => f.name === value);
            const extracted = extractNfNumber(value, fileObj ? fileObj.extractedText : "");
            if (extracted) {
                eq.nfEnvio = extracted;
            }
        } else if (field === 'nfDevolucaoFile' && value) {
            const fileObj = uploadedFiles.find(f => f.name === value);
            const extracted = extractNfNumber(value, fileObj ? fileObj.extractedText : "");
            if (extracted) {
                eq.nfDevolucao = extracted;
            }
        }

        updatePreview();
        // If file relationship is updated, re-render the table to refresh status badges and cell inputs
        if (field === 'nfEnvioFile' || field === 'nfDevolucaoFile' || field === 'ratFile' || field === 'evidenceFile') {
            renderTable();
        }
        saveLaudosState();
    }
}
function base64ToUint8Array(base64Str) {
    const rawBase64 = base64Str.includes(',') ? base64Str.split(',')[1] : base64Str;
    const binaryString = atob(rawBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Convert ISO date string to written Portuguese
function formatPortugueseDate(dateStr) {
    if (!dateStr) return "";
    const dateParts = dateStr.split('-');
    if (dateParts.length !== 3) return dateStr;

    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);

    const date = new Date(year, month, day);

    const weekDays = [
        "domingo", "segunda-feira", "terça-feira", "quarta-feira",
        "quinta-feira", "sexta-feira", "sábado"
    ];

    const months = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];

    const weekDay = weekDays[date.getDay()];
    const dayVal = date.getDate();
    const monthName = months[date.getMonth()];
    const yearVal = date.getFullYear();

    return `${weekDay}, ${dayVal} de ${monthName} de ${yearVal}`;
}

// Generate the text block containing destination company details
function generateTextDeclaration() {
    const opType = document.getElementById("operationType")?.value || "doacao";

    if (opType === "descarte") {
        return `Declaramos a quem possa interessar que a empresa Low Cost Gerenciamento de Serviços Ltda. – CNPJ 01.482.939/0001-00, situada na Av. Tamboré, 1400, Sala 39 – Tamboré – Barueri – SP – Cep: 06.460-000; vem através desta realizar o processo de descarte vide planilha preenchida na rota Documento > CUSTOMER SERVICE > SUPORTE ADM_CRC > 15 - DECLARAÇÃO DE DOAÇÃO > DECLARAÇÕES_PREENCHIDAS > DOAÇÕES EM ANDAMENTO.`;
    }

    const destName = document.getElementById("destName").value.trim();
    const destCnpj = document.getElementById("destCnpj").value.trim();
    const destAddress = document.getElementById("destAddress").value.trim();

    let base = `Declaramos a quem possa interessar que a empresa Low Cost Gerenciamento de Serviços Ltda. – CNPJ 01.482.939/0001-00, situada na Av. Tamboré, 1400, Sala 39 – Tamboré – Barueri – SP – Cep: 06.460-000; vem através desta doar os equipamentos abaixo`;

    if (destName) {
        base += ` para ${destName}`;
        if (destCnpj) base += `.- CNPJ: ${destCnpj}`;
        if (destAddress) base += ` - Endereço: ${destAddress}`;
    } else {
        base += `.`;
    }

    return base;
}

// Update live preview layout
function updatePreview() {
    // Number
    const number = document.getElementById("laudoNumber").value || "---";
    document.getElementById("previewDocNumber").innerText = number;

    // Logo & Banner
    document.getElementById("previewLogo").src = ASSETS.logo;
    document.getElementById("previewFooterBanner").src = ASSETS.bannerClassic;

    // Title
    const opType = document.getElementById("operationType")?.value || "doacao";
    document.getElementById("previewDocTitle").innerText = opType === "descarte" ? "Declaração de Descarte" : "Declaração de Doação";

    // Text Declaration
    const textVal = generateTextDeclaration();
    document.getElementById("previewDocText").innerText = textVal;
    document.getElementById("declarationText").value = textVal;

    // Today's date automatically
    const today = new Date();
    const dateFormatted = formatPortugueseDate(today.toISOString().split('T')[0]);
    document.getElementById("previewDocDate").innerText = dateFormatted;

    // Address
    document.getElementById("previewFooterAddress").innerText = LOW_COST_INFO.footerAddress;

    // Populate preview table rows
    const tableBody = document.getElementById("previewTableBody");
    if (tableBody) {
        tableBody.innerHTML = "";
        equipments.forEach((eq, index) => {
            const envioNum = eq.nfEnvio || (eq.nfEnvioFile ? extractNfNumber(eq.nfEnvioFile) : '-');
            const devolucaoNum = eq.nfDevolucao || (eq.nfDevolucaoFile ? extractNfNumber(eq.nfDevolucaoFile) : '-');

            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td style="text-align: center;">${index + 1}</td>
        <td>${esc(eq.origin || '-')}</td>
        <td>${esc(eq.model || '-')}</td>
        <td style="font-weight: bold;">${esc(eq.serial || '-')}</td>
        <td style="text-align: center;">${esc(eq.counter || '0')}</td>
        <td style="text-align: center;">${esc(eq.age || '-')}</td>
        <td style="text-align: center;">${esc(envioNum)}</td>
        <td style="text-align: center;">${esc(devolucaoNum)}</td>
        <td style="text-align: center; font-weight: bold;">${esc(eq.observation || '-')}</td>
    `;
            tableBody.appendChild(tr);
        });
    }
}
async function saveLaudosState() {
    try {
        const state = {
            operationType: document.getElementById("operationType")?.value || "doacao",
            laudoNumber: document.getElementById("laudoNumber")?.value || "",
            destName: document.getElementById("destName")?.value || "",
            destCnpj: document.getElementById("destCnpj")?.value || "",
            destAddress: document.getElementById("destAddress")?.value || "",
            equipments: equipments,
            uploadedFiles: uploadedFiles,
            nextEquipId: nextEquipId
        };
        await dbStore.save("laudos_state", "state", new Date().toISOString(), state);
    } catch (e) {
        console.error("Failed to save laudos state:", e);
    }
}
// Consolidated PDF generation client-side using pdf-lib
async function generateReport() {
    // Filter out completely empty rows (where all main fields are empty)
    const activeEquipments = equipments.filter(eq =>
        (eq.serial || '').trim() ||
        (eq.model || '').trim() ||
        (eq.origin || '').trim()
    );

    if (activeEquipments.length === 0) {
        alert("Adicione pelo menos um equipamento válido ao laudo.");
        return;
    }

    // 1. Mandatory Files Validations
    let missingNf = [];
    let missingRat = [];

    activeEquipments.forEach((eq, idx) => {
        if (!eq.nfEnvioFile && eq.nfEnvio && eq.nfEnvio !== '0') {
            missingNf.push(idx + 1);
        }
        if (!eq.ratFile) {
            missingRat.push(idx + 1);
        }
    });

    if (missingNf.length > 0) {
        alert(`Geração bloqueada! A(s) Nota(s) Fiscal(is) correspondente(s) aos itens Nº: [ ${missingNf.join(', ')} ] não foram carregadas ou vinculadas.`);
        return;
    }

    if (missingRat.length > 0) {
        alert(`Geração bloqueada! Os Relatórios Técnicos (RAT) correspondentes aos itens Nº: [ ${missingRat.join(', ')} ] não foram carregados ou vinculados.`);
        return;
    }

    toggleProgress(true, "Gerando Laudo PDF", "Renderizando a capa oficial e carregando anexos...", 10);

    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;

        // Create PDF
        const mergedPdf = await PDFDocument.create();

        // Cover A4 Landscape Page (Page 1)
        const coverPage = mergedPdf.addPage([841.89, 595.27]);

        // Embed assets
        const logoImg = await mergedPdf.embedJpg(base64ToUint8Array(ASSETS.logo));
        const bannerImg = await mergedPdf.embedJpg(base64ToUint8Array(ASSETS.bannerClassic));

        // Embed font
        const fontNormal = await mergedPdf.embedFont(StandardFonts.Helvetica);
        const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

        // Draw Header Logo
        coverPage.drawImage(logoImg, {
            x: 40,
            y: 508,
            width: 178,
            height: 48
        });

        // Draw Top Right Meta
        const metaText = "F.8.5A_ATIM002";
        const metaW = fontBold.widthOfTextAtSize(metaText, 6);
        coverPage.drawText(metaText, {
            x: 695 + (110 - metaW) / 2,
            y: 544,
            size: 6,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2)
        });

        const labelText = "Nº:";
        const labelW = fontBold.widthOfTextAtSize(labelText, 8);
        coverPage.drawText(labelText, {
            x: 695 + (110 - labelW) / 2,
            y: 532,
            size: 8,
            font: fontBold,
            color: rgb(0, 0, 0)
        });

        const numText = document.getElementById("laudoNumber").value || "000";
        // Draw a light gray box for the number
        coverPage.drawRectangle({
            x: 695,
            y: 505,
            width: 110,
            height: 22,
            color: rgb(0.95, 0.95, 0.95),
            borderColor: rgb(0, 0, 0),
            borderWidth: 1.5
        });

        const numW = fontBold.widthOfTextAtSize(numText, 14);
        coverPage.drawText(numText, {
            x: 695 + (110 - numW) / 2,
            y: 512,
            size: 14,
            font: fontBold,
            color: rgb(0, 0, 0)
        });

        // Draw Header bottom line
        coverPage.drawLine({
            start: { x: 40, y: 472 },
            end: { x: 801.89, y: 472 },
            thickness: 2,
            color: rgb(0, 0, 0)
        });

        // Title
        const opType = document.getElementById("operationType")?.value || "doacao";
        const titleText = opType === "descarte" ? "Declaração de Descarte" : "Declaração de Doação";
        const titleWidth = fontBold.widthOfTextAtSize(titleText, 20);
        coverPage.drawText(titleText, {
            x: (841.89 - titleWidth) / 2,
            y: 512,
            size: 20,
            font: fontBold,
            color: rgb(0, 0, 0)
        });

        // Date
        const today = new Date();
        const dateText = formatPortugueseDate(today.toISOString().split('T')[0]);
        const dateWidth = fontNormal.widthOfTextAtSize(dateText, 7.5);
        coverPage.drawText(dateText, {
            x: 801.89 - dateWidth,
            y: 483,
            size: 7.5,
            font: fontNormal,
            color: rgb(0, 0, 0)
        });

        // Paragraph text formatting with justification
        const decText = generateTextDeclaration();
        const paragraphs = decText.split('\n');
        let currentY = 445;
        const maxWidth = 762;
        const fontSize = 9.5;
        const lineHeight = 13.5;

        paragraphs.forEach(p => {
            const pTrim = p.trim();
            if (!pTrim) return;

            const words = pTrim.split(' ');
            let currentLineWords = [];

            for (let n = 0; n < words.length; n++) {
                const testLine = [...currentLineWords, words[n]].join(' ');
                const testWidth = fontNormal.widthOfTextAtSize(testLine, fontSize);

                if (testWidth > maxWidth && currentLineWords.length > 0) {
                    // Draw justified line across maxWidth
                    const totalWordsWidth = currentLineWords.reduce((sum, w) => sum + fontNormal.widthOfTextAtSize(w, fontSize), 0);
                    const gaps = currentLineWords.length - 1;
                    const spaceWidth = gaps > 0 ? (maxWidth - totalWordsWidth) / gaps : fontNormal.widthOfTextAtSize(' ', fontSize);

                    let curX = 40;
                    currentLineWords.forEach(w => {
                        coverPage.drawText(w, {
                            x: curX,
                            y: currentY,
                            size: fontSize,
                            font: fontNormal,
                            color: rgb(0, 0, 0)
                        });
                        curX += fontNormal.widthOfTextAtSize(w, fontSize) + spaceWidth;
                    });

                    currentY -= lineHeight;
                    currentLineWords = [words[n]];
                } else {
                    currentLineWords.push(words[n]);
                }
            }

            // Last line of paragraph (left aligned, normal spacing)
            if (currentLineWords.length > 0) {
                const lastLineText = currentLineWords.join(' ');
                coverPage.drawText(lastLineText, {
                    x: 40,
                    y: currentY,
                    size: fontSize,
                    font: fontNormal,
                    color: rgb(0, 0, 0)
                });
                currentY -= (lineHeight + 3);
            }
        });

        // Table layout definitions
        const colWidths = [20, 185, 175, 90, 60, 65, 55, 55, 57]; // total 762
        const colHeaders = [
            ["Nº"],
            ["ORIGEM /", "LOCALIDADE"],
            ["MARCA/MODELO"],
            ["SERIAL"],
            ["ÚLTIMO", "CONTADOR"],
            ["IDADE DO", "EQUIPAMENTO"],
            ["NF DE", "ENVIO"],
            ["NF DE", "DEVOLUÇÃO"],
            ["OBSERVAÇÃO", "CONTADOR"]
        ];
        const tableStartX = 40;
        let tableY = currentY - 5;
        const headerHeight = 22;

        // Header rectangle
        coverPage.drawRectangle({
            x: tableStartX,
            y: tableY - headerHeight,
            width: 762,
            height: headerHeight,
            color: rgb(0.95, 0.96, 0.98),
            borderColor: rgb(0, 0, 0),
            borderWidth: 1
        });

        let curX = tableStartX;
        colHeaders.forEach((lines, idx) => {
            const colW = colWidths[idx];
            const size = 6.5;

            // Center text block vertically
            const totalTextHeight = lines.length * size + (lines.length - 1) * 2;
            const startY = tableY - (headerHeight - totalTextHeight) / 2 - size;

            lines.forEach((lineText, lineIdx) => {
                const textW = fontBold.widthOfTextAtSize(lineText, size);
                coverPage.drawText(lineText, {
                    x: curX + (colW - textW) / 2,
                    y: startY - lineIdx * (size + 2),
                    size: size,
                    font: fontBold,
                    color: rgb(0, 0, 0)
                });
            });

            // Draw column separator lines
            if (idx > 0) {
                coverPage.drawLine({
                    start: { x: curX, y: tableY },
                    end: { x: curX, y: tableY - headerHeight },
                    thickness: 1,
                    color: rgb(0, 0, 0)
                });
            }
            curX += colW;
        });

        tableY -= headerHeight;

        // Draw rows
        activeEquipments.forEach((eq, index) => {
            coverPage.drawRectangle({
                x: tableStartX,
                y: tableY - 16,
                width: 762,
                height: 16,
                color: rgb(1, 1, 1),
                borderColor: rgb(0, 0, 0),
                borderWidth: 1
            });

            const vals = [
                (index + 1).toString(),
                eq.origin || '',
                eq.model || '',
                eq.serial || '',
                eq.counter || '0',
                eq.age || '',
                eq.nfEnvio || (eq.nfEnvioFile ? extractNfNumber(eq.nfEnvioFile) : '-'),
                eq.nfDevolucao || (eq.nfDevolucaoFile ? extractNfNumber(eq.nfDevolucaoFile) : '-'),
                eq.observation || ''
            ];

            let curX = tableStartX;
            vals.forEach((val, idx) => {
                const colW = colWidths[idx];
                const isBold = idx === 3 || idx === 8;
                const font = isBold ? fontBold : fontNormal;
                const size = idx === 1 || idx === 2 ? 7 : 7.5;

                // Truncate text if it overflows columns
                let displayVal = val;
                const maxChars = idx === 1 ? 40 : (idx === 2 ? 35 : 20);
                if (displayVal.length > maxChars) {
                    displayVal = displayVal.substring(0, maxChars - 3) + "...";
                }

                const textW = font.widthOfTextAtSize(displayVal, size);

                // Align text
                const alignX = curX + (colW - textW) / 2;

                coverPage.drawText(displayVal, {
                    x: alignX,
                    y: tableY - 11,
                    size: size,
                    font: font,
                    color: rgb(0, 0, 0)
                });

                // Draw inner column borders
                if (idx > 0) {
                    coverPage.drawLine({
                        start: { x: curX, y: tableY },
                        end: { x: curX, y: tableY - 16 },
                        thickness: 1,
                        color: rgb(0, 0, 0)
                    });
                }
                curX += colW;
            });

            tableY -= 16;
        });

        // Draw Footer Centralized Address
        const fAddress = LOW_COST_INFO.footerAddress;
        const fAddressW = fontNormal.widthOfTextAtSize(fAddress, 8);
        coverPage.drawText(fAddress, {
            x: (841.89 - fAddressW) / 2,
            y: 76,
            size: 8,
            font: fontNormal,
            color: rgb(0.2, 0.2, 0.2)
        });

        // Draw Extended Footer Banner (spanning de margem a margem)
        coverPage.drawImage(bannerImg, {
            x: 40,
            y: 10,
            width: 762,
            height: 57.15
        });

        // 3. Document merging
        toggleProgress(true, "Mesclando Arquivos", "Copiando páginas das Notas Fiscais e RATs...", 40);

        // Unique NF Envio
        const uniqueNfEnvioFiles = new Set();
        activeEquipments.forEach(eq => {
            if (eq.nfEnvioFile) uniqueNfEnvioFiles.add(eq.nfEnvioFile);
        });

        // Unique NF Devolucao
        const uniqueNfDevolucaoFiles = new Set();
        activeEquipments.forEach(eq => {
            if (eq.nfDevolucaoFile) uniqueNfDevolucaoFiles.add(eq.nfDevolucaoFile);
        });

        let stepCount = 0;
        const totalSteps = uniqueNfEnvioFiles.size + uniqueNfDevolucaoFiles.size + activeEquipments.length;

        // Merge NF Envio
        for (const nfName of uniqueNfEnvioFiles) {
            stepCount++;
            const percent = 40 + Math.round((stepCount / totalSteps) * 40);
            toggleProgress(true, "Mesclando Arquivos", `Mesclando nota de envio: ${nfName}...`, percent);

            const fileObj = uploadedFiles.find(f => f.name === nfName);
            if (fileObj) {
                const extDoc = await PDFDocument.load(fileObj.buffer.slice(0));
                const pages = await mergedPdf.copyPages(extDoc, extDoc.getPageIndices());
                pages.forEach(p => mergedPdf.addPage(p));
            }
        }

        // Merge NF Devolucao
        for (const nfName of uniqueNfDevolucaoFiles) {
            stepCount++;
            const percent = 40 + Math.round((stepCount / totalSteps) * 40);
            toggleProgress(true, "Mesclando Arquivos", `Mesclando nota de retorno: ${nfName}...`, percent);

            const fileObj = uploadedFiles.find(f => f.name === nfName);
            if (fileObj) {
                const extDoc = await PDFDocument.load(fileObj.buffer.slice(0));
                const pages = await mergedPdf.copyPages(extDoc, extDoc.getPageIndices());
                pages.forEach(p => mergedPdf.addPage(p));
            }
        }

        // RATs
        for (let i = 0; i < activeEquipments.length; i++) {
            const eq = activeEquipments[i];
            stepCount++;
            const percent = 40 + Math.round((stepCount / totalSteps) * 40);

            if (eq.ratFile) {
                toggleProgress(true, "Mesclando Arquivos", `Mesclando RAT (${i + 1}/${activeEquipments.length}): ${eq.ratFile}...`, percent);
                const fileObj = uploadedFiles.find(f => f.name === eq.ratFile);
                if (fileObj) {
                    const extDoc = await PDFDocument.load(fileObj.buffer.slice(0));
                    const pages = await mergedPdf.copyPages(extDoc, extDoc.getPageIndices());
                    pages.forEach(p => mergedPdf.addPage(p));
                }
            }
        }

        // Evidences
        const evidenceFiles = uploadedFiles.filter(f => f.type === 'evidence');
        for (const fileObj of evidenceFiles) {
            toggleProgress(true, "Mesclando Arquivos", `Mesclando evidência: ${fileObj.name}...`, 90);
            const extDoc = await PDFDocument.load(fileObj.buffer.slice(0));
            const pages = await mergedPdf.copyPages(extDoc, extDoc.getPageIndices());
            pages.forEach(p => mergedPdf.addPage(p));
        }

        // Save and Download
        toggleProgress(true, "Finalizando PDF", "Gerando laudo consolidado para download...", 95);

        const pdfBytes = await mergedPdf.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `LAUDO - ${numText}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toggleProgress(false);

    } catch (e) {
        console.error(e);
        alert("Ocorreu um erro ao gerar o PDF. Verifique os logs do console.");
        toggleProgress(false);
    }
}



Object.assign(LD, {updateCell, removeRow});

export default {
  async mount(el){ mounted = true; await initLaudos(el); },
  unmount(){ mounted = false; progress(false); if (ro){ ro.disconnect(); ro = null; } }
};
