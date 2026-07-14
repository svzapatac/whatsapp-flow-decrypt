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

function generarSlots(horaInicio, horaFin, intervaloMinutos = 30) {
  const slots = [];
  let [h, m] = horaInicio.split(':').map(Number);
  const [finH, finM] = horaFin.split(':').map(Number);

  while (h < finH || (h === finH && m < finM)) {
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

// ==================== ENDPOINT PRINCIPAL ====================
app.post('/flow', async (req, res) => {
  try {
    const body = req.body;

    // 1. Descifrar AES key con RSA
    const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    const decryptedAesKey = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedAesKey
    );

    // 2. Preparar IV y datos encriptados
    const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64');
    const initialVector = Buffer.from(body.initial_vector, 'base64');

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
        responseData = { status: 'ok' };
        break;

      case 'data_exchange':
        const trigger = decryptedBody.data?.trigger;

        if (trigger === 'consultar_disponibilidad') {
          // Consultar Google Calendar - próximos 14 días
          const now = new Date();
          const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

          const events = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: now.toISOString(),
            timeMax: twoWeeks.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });

          // Agrupar eventos por fecha y hora
          const reservasPorFechaHora = {};
          events.data.items?.forEach(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const fecha = start.toISOString().split('T')[0];
            const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
            
            if (!reservasPorFechaHora[fecha]) reservasPorFechaHora[fecha] = {};
            if (!reservasPorFechaHora[fecha][hora]) reservasPorFechaHora[fecha][hora] = 0;
            reservasPorFechaHora[fecha][hora]++;
          });

          // Generar fechas disponibles
          const fechasDisponibles = [];
          for (let i = 0; i < 14; i++) {
            const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            const diaSemana = date.getDay();

            let slotsDelDia = [];
            if (diaSemana === 0) {
              // Domingo: 12:00-13:30 y 16:30-19:00
              slotsDelDia = [
                ...generarSlots('12:00', '13:30'),
                ...generarSlots('16:30', '19:00')
              ];
            } else {
              // Lunes a Sábado: 12:00-21:00
              slotsDelDia = generarSlots('12:00', '21:00');
            }

            // Filtrar slots con menos de 20 reservas
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

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
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

          let slotsDelDia = [];
          if (diaSemana === 0) {
            slotsDelDia = [
              ...generarSlots('12:00', '13:30'),
              ...generarSlots('16:30', '19:00')
            ];
          } else {
            slotsDelDia = generarSlots('12:00', '21:00');
          }

          const horariosDisponibles = slotsDelDia.filter(slot => {
            const reservas = reservasPorHora[slot.id] || 0;
            return reservas < 20;
          });

          responseData = {
            screen: 'SELECCION_HORARIO',
            data: {
              nombre_festejado: decryptedBody.data.nombre_festejado,
              numero_personas: decryptedBody.data.numero_personas,
              fechas_disponibles: decryptedBody.data.fechas_disponibles || [],
              horarios_disponibles: horariosDisponibles
            }
          };
        }

        else {
          responseData = { error: 'Trigger desconocido: ' + trigger };
        }
        break;

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

    // 5. Preparar IV de respuesta
    const responseIv = Buffer.from(initialVector.subarray(0, 12));
    responseIv[responseIv.length - 1] ^= 1;

    // 6. Encriptar respuesta
    const encryptedResponse = encryptAES(responseData, decryptedAesKey, responseIv);

  res.json({
  encrypted_response: encryptedResponse
});

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-flow-server' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
