const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// ==================== CONFIGURACIÓN ====================
const PRIVATE_KEY = Buffer.from(process.env.PRIVATE_KEY_B64, 'base64').toString('utf-8');
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const CALENDAR_ID = process.env.CALENDAR_ID || 'potrillosterraza@gmail.com';
const ZONA_HORARIA = 'America/Bogota';

const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY,
  ['https://www.googleapis.com/auth/calendar']
);
const calendar = google.calendar({ version: 'v3', auth });

// ==================== HELPERS ====================
function decryptAES(encryptedData, aesKey, iv) {
  const TAG_LENGTH = 16;
  const encryptedBody = encryptedData.subarray(0, encryptedData.length - TAG_LENGTH);
  const authTag = encryptedData.subarray(encryptedData.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encryptedBody),
    decipher.final(),
  ]).toString('utf-8');
}

function encryptAES(data, aesKey, iv) {
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([encrypted, authTag]).toString('base64');
}

// Convierte un objeto Date (que JS siempre maneja internamente en UTC) a sus
// componentes de fecha y hora tal como se ven en Bogotá. Esto es OBLIGATORIO
// para leer horas de eventos de Google Calendar: usar .getHours() directo
// da la hora en la zona horaria del SERVIDOR (que en Render suele ser UTC),
// no la de Bogotá, y eso desfasa todo por 5 horas.
function obtenerFechaHoraBogota(fechaJS) {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partes = formateador.formatToParts(fechaJS);
  const obtener = (tipo) => partes.find(p => p.type === tipo).value;
  return {
    fecha: `${obtener('year')}-${obtener('month')}-${obtener('day')}`,
    hora: `${obtener('hour')}:${obtener('minute')}`,
  };
}

// Devuelve la fecha/hora actual en la zona horaria del negocio (Bogotá, sin horario de verano)
function ahoraEnBogota() {
  const ahora = new Date();
  return new Date(ahora.toLocaleString('en-US', { timeZone: ZONA_HORARIA }));
}

// Genera slots de horaInicio a horaFin, AMBOS extremos incluidos
// (antes usaba "menor que" horaFin, lo que cortaba la última hora reservable)
function generarSlots(horaInicio, horaFin, intervaloMinutos = 30) {
  const slots = [];
  let [h, m] = horaInicio.split(':').map(Number);
  const [finH, finM] = horaFin.split(':').map(Number);

  while (h < finH || (h === finH && m <= finM)) {
    const horaStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const titulo = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;

    slots.push({ id: horaStr, title: titulo });

    m += intervaloMinutos;
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }

  return slots;
}

function slotsDelDiaSegunDiaSemana(diaSemana) {
  if (diaSemana === 0) {
    // Domingo: 12:00-13:30 y 16:30-19:00
    return [
      ...generarSlots('12:00', '13:30'),
      ...generarSlots('16:30', '19:00')
    ];
  }
  // Lunes a Sábado: 12:00-21:00 (9:00 PM incluida)
  return generarSlots('12:00', '21:00');
}

// Si dateStr es HOY, quita los horarios que ya pasaron
function quitarHorasPasadasSiEsHoy(slots, dateStr) {
  const ahora = ahoraEnBogota();
  const hoyStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;

  if (dateStr !== hoyStr) return slots;

  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();

  return slots.filter(slot => {
    const [h, m] = slot.id.split(':').map(Number);
    return (h * 60 + m) > minutosAhora;
  });
}

// Cuenta cuántos nombres de festejados escribió realmente la persona.
function contarNombres(nombres) {
  if (!nombres || typeof nombres !== 'string') return 0;

  const normalizado = nombres
    .replace(/\s+y\s+/gi, ',')
    .replace(/\s+e\s+/gi, ',')
    .replace(/&/g, ',')
    .replace(/\n/g, ',');

  return normalizado
    .split(',')
    .map(n => n.trim())
    .filter(n => n.length > 0)
    .length;
}

// Arma el texto final del resumen de precio ya formateado.
function construirResumenPrecio(comboAdicional, cantidadCombos, costoCombo) {
  let resumen = 'Pack de cumpleaños: $50.000';
  const cantidad = parseInt(cantidadCombos, 10) || 0;

  if (comboAdicional === 'si' && cantidad > 0) {
    resumen += ` + ${cantidad} combo(s) adicional(es): $${Number(costoCombo).toLocaleString('es-CO')}`;
  }

  return resumen;
}

// Consulta Google Calendar y arma las fechas disponibles (próximos 14 días)
// Saca las últimas 4 cifras de un número de teléfono/user_id, que es el
// código con el que se etiquetan los eventos en Google Calendar
// (ej. "Cumpleaños-Sofia Codigo:1965").
function obtenerUltimos4Digitos(valor) {
  const soloDigitos = String(valor || '').replace(/\D/g, '');
  return soloDigitos.slice(-4);
}

// El flow_token del Flow "Gestionar reserva" se arma como
// "gestionar-reserva-<user_id>-<timestamp>" (ver instrucciones del HTTP que
// envía el Flow). Esto nos da una forma de recuperar el número del cliente
// que NO depende de que "data.user_id" se haya propagado bien entre
// pantallas de n8n — el flow_token siempre llega intacto en cada petición,
// directo del protocolo de WhatsApp, sin pasar por nuestra propia lógica.
function extraerUserIdDeFlowToken(flowToken) {
  const match = String(flowToken || '').match(/^gestionar-reserva-(\d+)-/);
  return match ? match[1] : null;
}

// Busca en Google Calendar el próximo evento (dentro de los próximos 90 días)
// cuyo título termine en "Codigo:XXXX" con el código dado.
async function buscarReservaPorCodigo(codigo) {
  if (!codigo || codigo.length < 4) return null;

  const ahora = new Date();
  const limite = new Date(ahora.getTime() + 90 * 24 * 60 * 60 * 1000);

  const events = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: ahora.toISOString(),
    timeMax: limite.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    // No usamos "q" (búsqueda de texto de Google): no es confiable para
    // encontrar "1965" dentro de "Codigo:1965" pegado sin espacio. Traemos
    // todos los eventos del rango y filtramos nosotros mismos abajo.
  });

  const regexCodigo = new RegExp(`Codigo:${codigo}$`);
  const encontrado = (events.data.items || []).find(ev => regexCodigo.test(ev.summary || ''));

  if (!encontrado) return null;

  const inicio = new Date(encontrado.start.dateTime || encontrado.start.date);
  const fin = new Date(encontrado.end.dateTime || encontrado.end.date);
  const { fecha, hora } = obtenerFechaHoraBogota(inicio);

  return {
    event_id: encontrado.id,
    titulo: encontrado.summary,
    fecha,
    fecha_legible: inicio.toLocaleDateString('es-CO', { timeZone: ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' }),
    hora,
    hora_legible: inicio.toLocaleTimeString('es-CO', { timeZone: ZONA_HORARIA, hour: 'numeric', minute: '2-digit', hour12: true }),
    duracion_ms: fin - inicio,
  };
}

async function obtenerFechasDisponibles() {
  const ahoraReal = new Date();
  const ahoraBogota = ahoraEnBogota();
  const limiteReal = new Date(ahoraReal.getTime() + 14 * 24 * 60 * 60 * 1000);

  const events = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: ahoraReal.toISOString(),
    timeMax: limiteReal.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const reservasPorFechaHora = {};
  events.data.items?.forEach(event => {
    const start = new Date(event.start.dateTime || event.start.date);
    const { fecha, hora } = obtenerFechaHoraBogota(start);

    if (!reservasPorFechaHora[fecha]) reservasPorFechaHora[fecha] = {};
    if (!reservasPorFechaHora[fecha][hora]) reservasPorFechaHora[fecha][hora] = 0;
    reservasPorFechaHora[fecha][hora]++;
  });

  const fechasDisponibles = [];
  for (let i = 0; i < 14; i++) {
    // Sumamos días sobre la fecha "de Bogotá" (no la del servidor), para que
    // "hoy" siempre sea el día real en Bogotá sin importar en qué zona
    // horaria esté corriendo el servidor.
    const diaBogota = new Date(ahoraBogota.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = `${diaBogota.getFullYear()}-${String(diaBogota.getMonth() + 1).padStart(2, '0')}-${String(diaBogota.getDate()).padStart(2, '0')}`;
    const diaSemana = diaBogota.getDay();

    let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);

    // Si el día es hoy, quitar las horas que ya pasaron ANTES de revisar disponibilidad
    slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, dateStr);

    const slotsDisponibles = slotsDelDia.filter(slot => {
      const reservas = reservasPorFechaHora[dateStr]?.[slot.id] || 0;
      return reservas < 20;
    });

    if (slotsDisponibles.length > 0) {
      const options = { weekday: 'long', day: 'numeric', month: 'long' };
      fechasDisponibles.push({
        id: dateStr,
        title: diaBogota.toLocaleDateString('es-CO', options)
      });
    }
  }

  return fechasDisponibles;
}

// ==================== ENDPOINT PRINCIPAL ====================
app.post('/flow', async (req, res) => {
  let decryptedAesKey, initialVector;

  try {
    const body = req.body;

    // 1. Descifrar AES key con RSA
    const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedAesKey
    );

    // 2. Preparar IV y datos encriptados
    const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64');
    initialVector = Buffer.from(body.initial_vector, 'base64');

    // 3. Descifrar payload
    const decryptedJSON = decryptAES(encryptedFlowData, decryptedAesKey, initialVector);
    const decryptedBody = JSON.parse(decryptedJSON);

    console.log('=== REQUEST ===');
    console.log('Action:', decryptedBody.action);
    console.log('Data:', JSON.stringify(decryptedBody.data, null, 2));

    let responseData = {};

    // 4. Lógica según la acción
    switch (decryptedBody.action) {
      case 'ping':
        responseData = { data: { status: 'active' } };
        break;

      case 'data_exchange': {
        const trigger = decryptedBody.data?.trigger;

        if (trigger === 'validar_festejados') {
          const nombreFestejado = decryptedBody.data.nombre_festejado || '';
          const numeroFestejados = parseInt(decryptedBody.data.numero_festejados, 10) || 0;
          const numeroPersonas = decryptedBody.data.numero_personas;
          const decoracion = decryptedBody.data.decoracion || 'si';
          const tipoDecoracion = decryptedBody.data.tipo_decoracion || 'cumpleanos';

          // Nota: WhatsApp Flow no permite regresar a la misma pantalla (ni ciclos
          // entre pantallas) desde data_exchange, así que no bloqueamos el avance
          // con un mensaje de "corrige esto". Solo usamos el número de festejados
          // para decidir el siguiente paso.

          // --- 0 o 1 festejado: no tiene sentido preguntar por combo adicional ---
          if (numeroFestejados <= 1) {
            const fechasDisponibles = await obtenerFechasDisponibles();
            responseData = {
              screen: 'SELECCION_HORARIO',
              data: {
                nombre_festejado: nombreFestejado,
                numero_festejados: String(numeroFestejados || 1),
                numero_personas: numeroPersonas,
                decoracion,
                tipo_decoracion: tipoDecoracion,
                combo_adicional: 'no',
                cantidad_combos: '0',
                costo_combo: '0',
                resumen_precio: construirResumenPrecio('no', '0', '0'),
                fechas_disponibles: fechasDisponibles,
                horarios_disponibles: []
              }
            };
          }
          // --- 2 o más festejados: sí se pregunta por el combo adicional ---
          else {
            responseData = {
              screen: 'COMBO_ADICIONAL',
              data: {
                nombre_festejado: nombreFestejado,
                numero_festejados: String(numeroFestejados),
                numero_personas: numeroPersonas,
                decoracion,
                tipo_decoracion: tipoDecoracion
              }
            };
          }
        }

        else if (trigger === 'consultar_disponibilidad') {
          const fechasDisponibles = await obtenerFechasDisponibles();
          const comboAdicional = decryptedBody.data.combo_adicional || 'no';
          // El Flow no puede multiplicar (${form.x * 19000} no se evalúa), así que
          // el costo del combo se calcula aquí, con el número de combos ya limpio.
          const cantidadCombos = String(parseInt(decryptedBody.data.cantidad_combos, 10) || 0);
          const costoCombo = String((parseInt(cantidadCombos, 10) || 0) * 19000);

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_festejados: decryptedBody.data.numero_festejados || '1',
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'cumpleanos',
              combo_adicional: comboAdicional,
              cantidad_combos: cantidadCombos,
              costo_combo: costoCombo,
              resumen_precio: construirResumenPrecio(comboAdicional, cantidadCombos, costoCombo),
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horarios') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          // Consultar eventos para esa fecha
          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);

          // Quitar horas ya pasadas si la fecha elegida es hoy
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          const comboAdicional = decryptedBody.data.combo_adicional || 'no';
          const cantidadCombos = decryptedBody.data.cantidad_combos || '0';
          const costoCombo = decryptedBody.data.costo_combo || '0';

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_festejados: decryptedBody.data.numero_festejados || '1',
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'cumpleanos',
              combo_adicional: comboAdicional,
              cantidad_combos: cantidadCombos,
              costo_combo: costoCombo,
              resumen_precio: construirResumenPrecio(comboAdicional, cantidadCombos, costoCombo),
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else if (trigger === 'validar_reserva_sin_tematica') {
          const aNombreDe = decryptedBody.data.a_nombre_de || '';
          const numeroPersonas = decryptedBody.data.numero_personas || '';

          const fechasDisponibles = await obtenerFechasDisponibles();

          responseData = {
            screen: 'SELECCION_HORARIO_SIN_TEMATICA',
            data: {
              a_nombre_de: aNombreDe,
              numero_personas: numeroPersonas,
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horarios_sin_tematica') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_HORARIO_SIN_TEMATICA',
            data: {
              a_nombre_de: decryptedBody.data.a_nombre_de,
              numero_personas: decryptedBody.data.numero_personas,
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else if (trigger === 'consultar_disponibilidad_bautizo') {
          const fechasDisponibles = await obtenerFechasDisponibles();

          responseData = {
            screen: 'SELECCION_HORARIO_BAUTIZO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'bautizo',
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horarios_bautizo') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_HORARIO_BAUTIZO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'bautizo',
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else if (trigger === 'consultar_disponibilidad_aniversario') {
          const fechasDisponibles = await obtenerFechasDisponibles();

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'aniversario',
              tipo_pack: decryptedBody.data.tipo_pack || '',
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horarios_aniversario') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'aniversario',
              tipo_pack: decryptedBody.data.tipo_pack || '',
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else if (trigger === 'consultar_disponibilidad_grado') {
          const fechasDisponibles = await obtenerFechasDisponibles();

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'grado',
              tipo_pack: decryptedBody.data.tipo_pack || '',
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horarios_grado') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              decoracion: decryptedBody.data.decoracion || 'si',
              tipo_decoracion: decryptedBody.data.tipo_decoracion || 'grado',
              tipo_pack: decryptedBody.data.tipo_pack || '',
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        // ==================== GESTIONAR RESERVA (cambiar hora / cancelar) ====================

        else if (trigger === 'procesar_opcion_otros') {
          const opcionMenu = decryptedBody.data.opcion_menu;

          if (opcionMenu === 'pqrs') {
            responseData = { screen: 'SELECCION_TIPO_PQRS', data: {} };
          } else if (opcionMenu === 'preguntas_frecuentes') {
            responseData = { screen: 'FORM_PREGUNTA', data: {} };
          } else if (opcionMenu === 'hablar_asesor') {
            responseData = { screen: 'FORM_ASESOR', data: {} };
          } else {
            responseData = { error: 'Opción de menú desconocida' };
          }
        }

        else if (trigger === 'procesar_opcion_menu') {
          const opcionMenu = decryptedBody.data.opcion_menu;
          // Preferimos el user_id que venga en "data", pero si llega vacío
          // (por cualquier problema de propagación en n8n), lo recuperamos
          // directo del flow_token, que siempre llega intacto.
          const userIdDeData = decryptedBody.data.user_id;
          const userIdDeToken = extraerUserIdDeFlowToken(decryptedBody.flow_token);
          const userId = userIdDeData || userIdDeToken;

          console.log('[gestionar_reserva] user_id de data:', userIdDeData, '| de flow_token:', userIdDeToken, '| usado:', userId);

          if (opcionMenu === 'hablar_asesor') {
            responseData = { screen: 'CONTACTO_ASESOR', data: {} };
          }

          else if (opcionMenu === 'preguntas_generales') {
            responseData = { screen: 'REDIRIGIR_PREGUNTAS', data: {} };
          }

          else if (opcionMenu === 'cambiar_hora' || opcionMenu === 'cancelar_reserva') {
            const codigo = obtenerUltimos4Digitos(userId);
            const reserva = await buscarReservaPorCodigo(codigo);

            if (!reserva) {
              responseData = {
                screen: 'NO_SE_ENCONTRO_RESERVA',
                data: { opcion_menu: opcionMenu }
              };
            } else {
              const screenDestino = opcionMenu === 'cancelar_reserva' ? 'CONFIRMAR_CANCELACION' : 'CONFIRMAR_REUBICACION';
              const resumenReserva = `Encontramos tu reserva: ${reserva.titulo.replace(/Codigo:\d+$/, '').trim()}, para el ${reserva.fecha_legible} a las ${reserva.hora_legible}.`;

              responseData = {
                screen: screenDestino,
                data: {
                  event_id: reserva.event_id,
                  resumen_reserva: resumenReserva
                }
              };
            }
          }

          else {
            responseData = { error: 'Opción de menú desconocida' };
          }
        }

        else if (trigger === 'buscar_por_numero_manual') {
          const telefono = decryptedBody.data.telefono;
          const opcionMenu = decryptedBody.data.opcion_menu;
          const codigo = obtenerUltimos4Digitos(telefono);
          const reserva = await buscarReservaPorCodigo(codigo);

          if (!reserva) {
            responseData = {
              screen: 'NO_SE_ENCONTRO_RESERVA',
              data: { opcion_menu: opcionMenu }
            };
          } else {
            const screenDestino = opcionMenu === 'cancelar_reserva' ? 'CONFIRMAR_CANCELACION' : 'CONFIRMAR_REUBICACION';
            const resumenReserva = `Encontramos tu reserva: ${reserva.titulo.replace(/Codigo:\d+$/, '').trim()}, para el ${reserva.fecha_legible} a las ${reserva.hora_legible}.`;

            responseData = {
              screen: screenDestino,
              data: {
                event_id: reserva.event_id,
                resumen_reserva: resumenReserva
              }
            };
          }
        }

        else if (trigger === 'confirmar_cancelacion') {
          const eventId = decryptedBody.data.event_id;
          try {
            await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
          } catch (err) {
            console.error('Error cancelando evento:', err.message);
          }
          responseData = { screen: 'RESERVA_CANCELADA', data: {} };
        }

        else if (trigger === 'consultar_fechas_reubicar') {
          const fechasDisponibles = await obtenerFechasDisponibles();
          responseData = {
            screen: 'SELECCION_NUEVA_HORA',
            data: {
              event_id: decryptedBody.data.event_id,
              resumen_reserva: decryptedBody.data.resumen_reserva,
              fechas_disponibles: fechasDisponibles,
              horarios_disponibles: []
            }
          };
        }

        else if (trigger === 'consultar_horas_reubicar') {
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const date = new Date(fechaSeleccionada + 'T00:00:00');
          const diaSemana = date.getDay();

          const inicioDia = new Date(date);
          inicioDia.setHours(0, 0, 0, 0);
          const finDia = new Date(date);
          finDia.setHours(23, 59, 59, 999);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicioDia.toISOString(),
            timeMax: finDia.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          const reservasPorHora = {};
          events.data.items?.forEach(event => {
            // No contar el propio evento que se está moviendo
            if (event.id === decryptedBody.data.event_id) return;
            const start = new Date(event.start.dateTime || event.start.date);
            const hora = obtenerFechaHoraBogota(start).hora;
            if (!reservasPorHora[hora]) reservasPorHora[hora] = 0;
            reservasPorHora[hora]++;
          });

          let slotsDelDia = slotsDelDiaSegunDiaSemana(diaSemana);
          slotsDelDia = quitarHorasPasadasSiEsHoy(slotsDelDia, fechaSeleccionada);

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_NUEVA_HORA',
            data: {
              event_id: decryptedBody.data.event_id,
              resumen_reserva: decryptedBody.data.resumen_reserva,
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else if (trigger === 'confirmar_reubicacion') {
          const eventId = decryptedBody.data.event_id;
          const fechaSeleccionada = decryptedBody.data.fecha_seleccionada;
          const horaSeleccionada = decryptedBody.data.hora_seleccionada;

          try {
            const existente = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
            const inicioViejo = new Date(existente.data.start.dateTime || existente.data.start.date);
            const finViejo = new Date(existente.data.end.dateTime || existente.data.end.date);
            const duracionMs = finViejo - inicioViejo;

            // OJO: construimos el ISO string con el offset -05:00 explícito
            // (Bogotá no tiene horario de verano). Si dejamos que JS
            // interprete "fechaT hora:00" sin offset, lo toma como hora
            // LOCAL DEL SERVIDOR (UTC en Render), desfasando todo por 5h.
            const nuevoInicio = new Date(`${fechaSeleccionada}T${horaSeleccionada}:00-05:00`);
            const nuevoFin = new Date(nuevoInicio.getTime() + duracionMs);

            await calendar.events.patch({
              calendarId: CALENDAR_ID,
              eventId,
              requestBody: {
                start: { dateTime: nuevoInicio.toISOString() },
                end: { dateTime: nuevoFin.toISOString() },
              },
            });
          } catch (err) {
            console.error('Error reubicando evento:', err.message);
          }

          responseData = {
            screen: 'RESERVA_REUBICADA',
            data: {
              fecha_seleccionada: fechaSeleccionada,
              hora_seleccionada: horaSeleccionada,
            }
          };
        }

        else {
          responseData = { error: 'Trigger desconocido: ' + trigger };
        }
        break;
      }

      case 'complete':
        console.log('=== RESERVA CONFIRMADA ===');
        console.log(decryptedBody.data);

        responseData = {
          status: 'success',
          message: 'Reserva confirmada exitosamente'
        };
        break;

      default:
        responseData = { error: 'Acción desconocida: ' + decryptedBody.action };
    }

    // 5. Preparar IV de respuesta: invertir TODOS los bits del IV original
    const responseIv = Buffer.from(initialVector.map(byte => ~byte & 0xFF));

    // 6. Encriptar respuesta
    const encryptedResponse = encryptAES(responseData, decryptedAesKey, responseIv);

    console.log('=== RESPONSE DEBUG ===');
    console.log('encryptedResponse length:', encryptedResponse.length);
    console.log('First 50 chars:', encryptedResponse.substring(0, 50));

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);

  } catch (err) {
    console.error('=== ERROR EN /flow ===');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-flow-server' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
