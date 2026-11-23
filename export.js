// ---- Exportar / compartir ----
// Genera archivos .xlsx y .docx reales (ZIP sin compresión) sin librerías externas.

const NOMBRES_UNIDAD = { c: 'Celsius (°C)', f: 'Fahrenheit (°F)', k: 'Kelvin (K)' };

// ---------- ZIP mínimo (método "store") ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function crearZip(archivos, fecha = new Date()) {
  const enc = new TextEncoder();
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
  const dia = ((Math.max(fecha.getFullYear(), 1980) - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  const partes = [];
  const central = [];
  let offset = 0;

  for (const [nombre, contenido] of Object.entries(archivos)) {
    const nom = enc.encode(nombre);
    const datos = typeof contenido === 'string' ? enc.encode(contenido) : contenido;
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);   // nombres en UTF-8
    local.setUint16(8, 0, true);        // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nom, datos);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, dia, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, datos.length, true);
    cd.setUint32(24, datos.length, true);
    cd.setUint16(28, nom.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nom);

    offset += 30 + nom.length + datos.length;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, Object.keys(archivos).length, true);
  fin.setUint16(10, Object.keys(archivos).length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  return [...partes, ...central, new Uint8Array(fin.buffer)];
}

// ---------- Datos a exportar ----------
const redondear = (n) => Math.round(n * 100) / 100;

function obtenerDatos() {
  const valor = parseFloat(inputTemp.value);
  if (Number.isNaN(valor)) return null;
  const desde = inputUnit.value;
  const hacia = outputUnit.value;
  const celsius = toCelsius(valor, desde);
  const fecha = new Date();
  const filas = [
    ['Concepto', 'Valor', 'Unidad'],
    ['Temperatura original', redondear(valor), NOMBRES_UNIDAD[desde]],
    ['Resultado', redondear(fromCelsius(celsius, hacia)), NOMBRES_UNIDAD[hacia]],
    ['Equivalencia', redondear(celsius), NOMBRES_UNIDAD.c],
    ['Equivalencia', redondear(fromCelsius(celsius, 'f')), NOMBRES_UNIDAD.f],
    ['Equivalencia', redondear(fromCelsius(celsius, 'k')), NOMBRES_UNIDAD.k],
    ['Fecha', fecha.toLocaleString('es-MX'), '']
  ];
  return { fecha, filas, desde, hacia };
}

const escXml = (s) => String(s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// ---------- Generadores de formato ----------
function generarCSV(filas) {
  const celda = (v) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

function generarXLSX(filas, fecha) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const letra = (i) => String.fromCharCode(65 + i);

  const sheetData = filas.map((fila, r) => {
    const celdas = fila.map((v, c) => {
      const ref = letra(c) + (r + 1);
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      const estilo = r === 0 ? ' s="1"' : '';
      return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');

  return crearZip({
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Conversión" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/></cols><sheetData>${sheetData}</sheetData></worksheet>`
  }, fecha);
}

function generarDOCX(filas, fecha) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const anchos = [3400, 2800, 2800];
  const borde = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;

  const parrafo = (texto, { negrita = false, tam = 22, centrado = false, despues = 120 } = {}) =>
    `<w:p><w:pPr><w:spacing w:after="${despues}"/>${centrado ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:r><w:rPr>${negrita ? '<w:b/>' : ''}<w:sz w:val="${tam}"/></w:rPr><w:t xml:space="preserve">${escXml(texto)}</w:t></w:r></w:p>`;

  const celdaDoc = (texto, c, encabezado) =>
    `<w:tc><w:tcPr><w:tcW w:w="${anchos[c]}" w:type="dxa"/>${encabezado ? '<w:shd w:val="clear" w:color="auto" w:fill="FBE4EC"/>' : ''}</w:tcPr>${parrafo(String(texto), { negrita: encabezado, despues: 40 })}</w:tc>`;

  const tabla = `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borde).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${anchos.map((a) => `<w:gridCol w:w="${a}"/>`).join('')}</w:tblGrid>${filas.map((f, r) => `<w:tr>${f.map((v, c) => celdaDoc(v, c, r === 0)).join('')}</w:tr>`).join('')}</w:tbl>`;

  const cuerpo =
    parrafo('Convertidor de temperatura', { negrita: true, tam: 36, despues: 80 }) +
    parrafo('Resultado de la conversión', { tam: 22, despues: 240 }) +
    tabla +
    parrafo('', { despues: 0 });

  return crearZip({
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  }, fecha);
}

function generarTexto(d) {
  const [, orig, res] = d.filas;
  return `${orig[1]} ${nombres[d.desde]} = ${res[1].toLocaleString('es-MX', { maximumFractionDigits: 1 })} ${nombres[d.hacia]}`;
}

function generarJSON(d) {
  const [, orig, res, c, f, k] = d.filas;
  return JSON.stringify({
    fecha: d.fecha.toISOString(),
    original: { valor: orig[1], unidad: d.desde },
    resultado: { valor: res[1], unidad: d.hacia },
    equivalencias: { celsius: c[1], fahrenheit: f[1], kelvin: k[1] }
  }, null, 2);
}

const FORMATOS = {
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', crear: (d) => generarXLSX(d.filas, d.fecha) },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', crear: (d) => generarDOCX(d.filas, d.fecha) },
  csv:  { ext: 'csv',  mime: 'text/csv;charset=utf-8', crear: (d) => generarCSV(d.filas) },
  json: { ext: 'json', mime: 'application/json', crear: generarJSON },
  txt:  { ext: 'txt',  mime: 'text/plain;charset=utf-8', crear: (d) => generarTexto(d) + '\n' }
};

if (typeof module !== 'undefined') {
  module.exports = { crearZip, generarXLSX, generarDOCX, generarCSV, crc32 };
}

// ---------- Interfaz: menú del botón Compartir ----------
if (typeof document !== 'undefined') {
  const menu = document.getElementById('share-menu');
  const btnShare = document.getElementById('btn-share');

  const cerrarMenu = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    btnShare.setAttribute('aria-expanded', 'false');
  };
  const abrirMenu = () => {
    menu.hidden = false;
    btnShare.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
  };

  btnShare.setAttribute('aria-haspopup', 'menu');
  btnShare.setAttribute('aria-expanded', 'false');
  btnShare.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? abrirMenu() : cerrarMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) cerrarMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { cerrarMenu(); btnShare.focus(); }
    if (menu.hidden || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  });

  function descargar(clave) {
    const d = obtenerDatos();
    if (!d) { avisar('Nada que exportar'); return; }
    const fmt = FORMATOS[clave];
    const contenido = fmt.crear(d);
    const blob = new Blob(Array.isArray(contenido) ? contenido : [contenido], { type: fmt.mime });
    const sello = d.fecha.toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const nombre = `conversion-temperatura-${sello}.${fmt.ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    avisar('Exportado: ' + nombre);
  }

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('button[data-accion]');
    if (!item) return;
    const accion = item.dataset.accion;
    cerrarMenu();
    if (accion === 'compartir') await compartirNativo();
    else if (accion === 'copiar') document.getElementById('btn-copy').click();
    else descargar(accion);
  });
}
