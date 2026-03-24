// OmniConvert App Logic
// Built for 30 in 30 App Development Challenge

const DOM = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    workspace: document.getElementById('workspace'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    fileType: document.getElementById('file-type'),
    formatSelect: document.getElementById('format-select'),
    supportedArea: document.getElementById('supported-area'),
    unsupportedArea: document.getElementById('unsupported-area'),
    unsupportedReason: document.getElementById('unsupported-reason'),
    convertBtn: document.getElementById('convert-btn'),
    resetBtn: document.getElementById('reset-btn'),
    outputArea: document.getElementById('output-area'),
    outFileName: document.getElementById('out-file-name'),
    outFileSize: document.getElementById('out-file-size'),
    downloadLink: document.getElementById('download-link'),
    qualityWrapper: document.getElementById('quality-wrapper'),
    qualitySlider: document.getElementById('quality-slider'),
    qualityVal: document.getElementById('quality-val'),
    historyPanel: document.getElementById('history-panel'),
    formatsList: document.getElementById('supported-formats-list'),
    themeToggle: document.getElementById('theme-toggle'),
    themeIcon: document.getElementById('theme-icon')
};

let currentFile = null;
let currentCategory = null;

// Ensure pdf.js worker is loaded
if (window['pdfjs-dist/build/pdf']) {
    window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Interleave Audio Buffer to WAV helper
function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const bufferRes = new ArrayBuffer(44 + length);
    const view = new DataView(bufferRes);
    const channels = [];
    let sample = 0;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(36 + length); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit
    setUint32(0x61746164); // "data" - chunk
    setUint32(length);

    // write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    while (pos < buffer.length) {
        for (let i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][pos]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(44 + offset, sample, true);
            offset += 2;
        }
        pos++;
    }

    return new Blob([bufferRes], { type: "audio/wav" });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }
    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

// Conversion Engine modular setup
const converters = {
    image: {
        handles: ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'],
        targets: [
            { id: 'png', name: 'PNG Image', ext: 'png', mime: 'image/png' },
            { id: 'jpeg', name: 'JPEG Image', ext: 'jpg', mime: 'image/jpeg' },
            { id: 'webp', name: 'WebP Image', ext: 'webp', mime: 'image/webp' },
            { id: 'base64', name: 'Base64 String', ext: 'txt', mime: 'text/plain' }
        ],
        convert: async (file, targetId) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (targetId === 'base64') {
                        const blob = new Blob([e.target.result], { type: 'text/plain' });
                        return resolve({ blob, ext: 'txt' });
                    }
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        
                        const targetMime = converters.image.targets.find(t => t.id === targetId).mime;
                        const quality = targetMime === 'image/jpeg' || targetMime === 'image/webp' 
                            ? parseInt(DOM.qualitySlider.value) / 100 : undefined;
                        
                        canvas.toBlob((blob) => {
                            if (!blob) reject(new Error("Canvas toBlob failed"));
                            resolve({ blob, ext: converters.image.targets.find(t => t.id === targetId).ext });
                        }, targetMime, quality);
                    };
                    img.onerror = () => reject(new Error("Image parsing failed"));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error("File reading failed"));
                if (targetId === 'base64') {
                    reader.readAsDataURL(file);
                } else {
                    reader.readAsDataURL(file);
                }
            });
        }
    },
    data: {
        handles: ['application/json', 'text/csv', 'text/tab-separated-values', 'text/plain'],
        targets: [
            { id: 'json', name: 'JSON', ext: 'json', mime: 'application/json' },
            { id: 'csv', name: 'CSV', ext: 'csv', mime: 'text/csv' },
            { id: 'tsv', name: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values' },
            { id: 'xml', name: 'XML', ext: 'xml', mime: 'application/xml' }
        ],
        convert: async (file, targetId) => {
            const text = await file.text();
            let parsedData = null;
            let outputText = "";
            let ext = targetId;
            let mime = "text/plain";
            
            // Try identifying input format and parse to common JS Object[]
            try {
                if (file.type === 'application/json' || file.name.endsWith('.json')) {
                    parsedData = JSON.parse(text);
                } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                    parsedData = parseDelimited(text, ',');
                } else if (file.type === 'text/tab-separated-values' || file.name.endsWith('.tsv')) {
                    parsedData = parseDelimited(text, '\t');
                } else {
                    // For plain text containing commas/tabs
                    if (text.includes(',')) parsedData = parseDelimited(text, ',');
                    else if (text.includes('\t')) parsedData = parseDelimited(text, '\t');
                    else throw new Error("Could not interpret plain text as data records.");
                }
            } catch (e) {
                throw new Error("Failed to parse input data: " + e.message);
            }

            // Converter functions
            if (targetId === 'json') {
                outputText = JSON.stringify(parsedData, null, 2);
                mime = 'application/json';
            } else if (targetId === 'csv') {
                outputText = toDelimited(parsedData, ',');
                mime = 'text/csv';
            } else if (targetId === 'tsv') {
                outputText = toDelimited(parsedData, '\t');
                mime = 'text/tab-separated-values';
            } else if (targetId === 'xml') {
                outputText = toXML(parsedData);
                mime = 'application/xml';
            }

            const blob = new Blob([outputText], { type: mime });
            return { blob, ext };
        }
    },
    document: {
        handles: ['text/plain', 'text/html', 'application/json', 'application/pdf'],
        targets: [
            { id: 'pdf', name: 'PDF Document (from Text/JSON)', ext: 'pdf', mime: 'application/pdf' },
            { id: 'txt', name: 'Plain Text', ext: 'txt', mime: 'text/plain' },
            { id: 'doc', name: 'DOC Base (from Text)', ext: 'doc', mime: 'application/msword' }
        ],
        convert: async (file, targetId) => {
            if (file.type === 'application/pdf') {
                if (targetId !== 'txt') throw new Error("Can only extract text from PDF in browser.");
                const arrayBuffer = await file.arrayBuffer();
                const pdfjsLib = window['pdfjs-dist/build/pdf'];
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    fullText += content.items.map(item => item.str).join(' ') + "\n";
                }
                const blob = new Blob([fullText], { type: 'text/plain' });
                return { blob, ext: 'txt' };
            }

            const text = await file.text();
            
            if (targetId === 'pdf') {
                if (!window.jspdf) throw new Error("PDF library not loaded.");
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                
                const splitText = doc.splitTextToSize(text, 180);
                doc.text(splitText, 15, 15);
                const pdfBlob = doc.output('blob');
                return { blob: pdfBlob, ext: 'pdf' };
            } 
            else if (targetId === 'txt') {
                const blob = new Blob([text], { type: 'text/plain' });
                return { blob, ext: 'txt' };
            }
            else if (targetId === 'doc') {
                // Extremely basic Word Doc generation using HTML string
                const content = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body><pre>${text}</pre></body></html>`;
                const blob = new Blob([content], { type: 'application/msword' });
                return { blob, ext: 'doc' };
            }
        }
    },
    audio: {
        handles: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp3', 'video/mp4'],
        targets: [
            { id: 'wav', name: 'WAV Audio', ext: 'wav', mime: 'audio/wav' },
            { id: 'base64', name: 'Base64 String', ext: 'txt', mime: 'text/plain' }
        ],
        convert: async (file, targetId) => {
            if (targetId === 'base64') {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const blob = new Blob([e.target.result], { type: 'text/plain' });
                        resolve({ blob, ext: 'txt' });
                    };
                    reader.onerror = () => reject(new Error("File reading failed"));
                    reader.readAsDataURL(file);
                });
            } else if (targetId === 'wav') {
                const arrayBuffer = await file.arrayBuffer();
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                const wavBlob = audioBufferToWav(audioBuffer);
                return { blob: wavBlob, ext: 'wav' };
            }
        }
    },
    unsupported: {
        handles: [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
            'application/x-zip-compressed'
        ],
        targets: [],
        convert: async () => { throw new Error("Unsupported format"); }
    }
};

// Data Helpers
function parseDelimited(text, delimiter) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(delimiter).map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(delimiter);
        let obj = {};
        headers.forEach((h, i) => obj[h] = values[i] ? values[i].trim() : "");
        return obj;
    });
}
function toDelimited(data, delimiter) {
    if (!Array.isArray(data) || data.length === 0) return "";
    const headers = Object.keys(data[0]);
    const headerRow = headers.join(delimiter);
    const rows = data.map(item => headers.map(h => {
        let val = item[h] || "";
        if (typeof val === 'object') val = JSON.stringify(val);
        // Basic escaping
        if (String(val).includes(delimiter)) val = `"${val}"`;
        return val;
    }).join(delimiter));
    return [headerRow, ...rows].join('\n');
}
function toXML(data) {
    if (!Array.isArray(data)) data = [data];
    let xml = `<?xml version="1.0" encoding="UTF-8"?><root>\n`;
    data.forEach(item => {
        xml += `  <row>\n`;
        Object.keys(item).forEach(key => {
            const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
            xml += `    <${safeKey}>${item[key]}</${safeKey}>\n`;
        });
        xml += `  </row>\n`;
    });
    xml += `</root>`;
    return xml;
}

// Format Size Helper
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Theme Management
let currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
updateThemeIcon();

DOM.themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeIcon();
});

function updateThemeIcon() {
    DOM.themeIcon.textContent = currentTheme === 'light' ? '🌙' : '☀️';
}

// Event Listeners
DOM.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.add('dragover');
});
DOM.dropZone.addEventListener('dragleave', () => DOM.dropZone.classList.remove('dragover'));
DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});
DOM.resetBtn.addEventListener('click', resetApp);
DOM.qualitySlider.addEventListener('input', (e) => DOM.qualityVal.textContent = e.target.value);
DOM.formatSelect.addEventListener('change', (e) => {
    DOM.convertBtn.disabled = !e.target.value;
    
    // Show quality slider for JPEG/WEBP
    if (e.target.value === 'jpeg' || e.target.value === 'webp') {
        DOM.qualityWrapper.style.display = 'flex';
    } else {
        DOM.qualityWrapper.style.display = 'none';
    }
});

DOM.convertBtn.addEventListener('click', async () => {
    if (!currentFile || !currentCategory) return;
    const targetId = DOM.formatSelect.value;
    
    DOM.convertBtn.textContent = 'Converting...';
    DOM.convertBtn.disabled = true;

    try {
        const { blob, ext } = await converters[currentCategory].convert(currentFile, targetId);
        
        let outName = currentFile.name;
        if (outName.lastIndexOf('.') !== -1) {
            outName = outName.substring(0, outName.lastIndexOf('.'));
        }
        outName = `${outName}.${ext}`;

        const url = URL.createObjectURL(blob);
        DOM.outFileName.textContent = outName;
        DOM.outFileSize.textContent = formatBytes(blob.size);
        DOM.downloadLink.href = url;
        DOM.downloadLink.download = outName;

        DOM.outputArea.style.display = 'block';
        
        addHistory(currentFile.name, outName);
    } catch (err) {
        alert("Conversion failed: " + err.message);
    } finally {
        DOM.convertBtn.textContent = 'Convert File';
        DOM.convertBtn.disabled = false;
    }
});

function handleFile(file) {
    currentFile = file;
    DOM.dropZone.style.display = 'none';
    DOM.formatsList.style.display = 'none';
    DOM.workspace.style.display = 'block';
    DOM.outputArea.style.display = 'none';
    DOM.qualityWrapper.style.display = 'none';
    
    DOM.fileName.textContent = file.name;
    DOM.fileSize.textContent = formatBytes(file.size);

    // Identify category
    let typeToUse = file.type;
    let extToUse = file.name.split('.').pop().toLowerCase();
    
    // Type resolving for cases where MIME is empty or vague
    if (!typeToUse) {
        if (extToUse === 'csv') typeToUse = 'text/csv';
        if (extToUse === 'tsv') typeToUse = 'text/tab-separated-values';
        if (extToUse === 'json') typeToUse = 'application/json';
        if (extToUse === 'xml') typeToUse = 'application/xml';
    }

    DOM.fileType.textContent = typeToUse || (extToUse ? extToUse.toUpperCase() : 'Unknown');

    currentCategory = null;
    let categoryFound = null;

    // Check unsupported first
    if (converters.unsupported.handles.includes(typeToUse) || 
        ['docx', 'pptx', 'mp4', 'mkv', 'wav', 'mp3'].includes(extToUse)) {
        categoryFound = 'unsupported';
    } else {
        // Find supporting converter
        for (const [key, category] of Object.entries(converters)) {
            if (key === 'unsupported') continue;
            if (category.handles.includes(typeToUse) || category.handles.some(h => extToUse && h.includes(extToUse))) {
                categoryFound = key;
                break;
            }
        }
    }

    if (categoryFound === 'unsupported' || (!categoryFound && (typeToUse.startsWith('video/') || typeToUse.startsWith('audio/')))) {
        DOM.supportedArea.style.display = 'none';
        DOM.unsupportedArea.style.display = 'block';
        DOM.unsupportedReason.textContent = "This conversion requires server-side processing and is not available in browser.";
    } else if (categoryFound) {
        currentCategory = categoryFound;
        DOM.supportedArea.style.display = 'block';
        DOM.unsupportedArea.style.display = 'none';
        
        // Populate formats
        DOM.formatSelect.innerHTML = '<option value="" disabled selected>Select a format</option>';
        converters[categoryFound].targets.forEach(target => {
            // Prevent same format converting to same format implicitly if basic
            if (!currentFile.type.includes(target.id) && !currentFile.name.endsWith("."+target.ext)) {
                
                // Special case: PDF can only convert to TXT explicitly
                if (currentFile.type === 'application/pdf' && target.id !== 'txt') return;

                const opt = document.createElement('option');
                opt.value = target.id;
                opt.textContent = target.name;
                DOM.formatSelect.appendChild(opt);
            }
        });
        DOM.convertBtn.disabled = true;
    } else {
        DOM.supportedArea.style.display = 'none';
        DOM.unsupportedArea.style.display = 'block';
        DOM.unsupportedReason.textContent = "Unrecognized file format or unsupported conversion.";
    }
}

function resetApp() {
    currentFile = null;
    currentCategory = null;
    DOM.dropZone.style.display = 'block';
    DOM.formatsList.style.display = 'block';
    DOM.workspace.style.display = 'none';
    DOM.fileInput.value = '';
}

function addHistory(original, converted) {
    DOM.historyPanel.style.display = 'block';
    const li = document.createElement('li');
    li.innerHTML = `
        <span class="name">${original} ➔ ${converted}</span>
        <span class="meta">${new Date().toLocaleTimeString()}</span>
    `;
    DOM.historyList.prepend(li);
}
