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
  ['https://www.googleapis.com/auth/calendar.readonly']
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
async function obtenerFechasDisponibles() {
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const events = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: twoWeeks.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const reservasPorFechaHora = {};
  events.data.items?.forEach(event => {
    const start = new Date(event.start.dateTime || event.start.date);
    const fecha = start.toISOString().split('T')[0];
    const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;

    if (!reservasPorFechaHora[fecha]) reservasPorFechaHora[fecha] = {};
    if (!reservasPorFechaHora[fecha][hora]) reservasPorFechaHora[fecha][hora] = 0;
    reservasPorFechaHora[fecha][hora]++;
  });

  const fechasDisponibles = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const diaSemana = date.getDay();

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
        title: date.toLocaleDateString('es-CO', options)
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
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
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
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
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
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
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
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
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
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
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
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
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
