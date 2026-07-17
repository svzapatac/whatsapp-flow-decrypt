const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ==================== CONFIGURACIÓN ====================
const PRIVATE_KEY = Buffer.from(process.env.PRIVATE_KEY_B64, 'base64').toString('utf-8');

// ==================== BASE DE DATOS DE COLEGIOS ====================
const COLEGIOS = [
  { nombre: 'Colegio Distrital Paulo Freire', direccion: 'Cra. 11 #65D 50 Sur' },
  { nombre: 'COLEGIO SAN JOSÉ DE USME IED', direccion: 'A #, Cl. 96 Sur #11' },
  { nombre: 'Colegio Juan Luis Londoño IED - La Salle', direccion: 'Cra 7H 66A #20 sur' },
  { nombre: 'Colegio Liceo Comercial Nuevo Alejandrinos', direccion: 'Carrera 4B, Cl. 30 Sur #No. 56 - 24' },
  { nombre: 'COLEGIO FERNANDO GONZALEZ OCHOA (IED)', direccion: 'Cra. 4d Este #89 Sur77' },
  { nombre: 'Colegio Santa Martha I.E.D.', direccion: 'Cra. 1b Bis Este' },
  { nombre: 'COLEGIO ATABANZHA (IED)', direccion: 'Cl. 92 Sur #2-43' },
  { nombre: 'I.E.D BRASILIA USME', direccion: 'Cl. 73b Sur #1 a 73b' },
  { nombre: 'COLEGIO NUEVA ESPERANZA I.E.D. SEDE A', direccion: 'Cl. 76b Sur' },
  { nombre: 'Colegio Ofelia Uribe de Acosta', direccion: 'Cl. 81a Sur #6 Este40' },
  { nombre: 'Colegio Centro Cultural', direccion: 'Cl. 72A Sur' },
  { nombre: 'Instituto El Ingenioso Hidalgo', direccion: 'Cl. 89 Sur #18' },
  { nombre: 'Colegio Santa María de La Paz', direccion: 'Kr 3F #73b Sur21' },
  { nombre: 'Colegio Brazuelos IED', direccion: 'Cl. 104 Sur #1b-81' },
  { nombre: 'Colegio Isidro Molina', direccion: 'Calle 78 Sur #1h-16E, Betania' },
  { nombre: 'Ced Gran Yomasa', direccion: 'Cl. 81c Sur' },
  { nombre: 'Colegio IED La Aurora', direccion: 'Kr 14L #7103' },
  { nombre: 'Colegio Andrés Escobar', direccion: 'Cra. 4 #55b - 15 sur' },
  { nombre: 'IED San Cayetano', direccion: 'Cl. 74a Sur &, Cra. 17 Este' },
  { nombre: 'Colegio Santa Librada IED', direccion: 'Cl. 75b Sur #1b Este-1 a, Cra. 1b Este #65' },
  { nombre: 'Colegio Eduardo Umaña Mendoza', direccion: 'Calle 111 sur N° 4 B - 07 Este' },
  { nombre: 'Liceo María Nell', direccion: 'Cra 8 #81 58 sur' },
  { nombre: 'Liceo Adolfo León Gómez', direccion: 'Cra. 3 Este #101a Sur8' },
  { nombre: 'COLEGIO FEDERICO GARCIA LORCA (IED)', direccion: 'Cra. 4 Este #82 Sur45' },
  { nombre: 'Colegio Miguel De Cervantes Saavedra', direccion: 'a 1c-30, Dg. 76b Sur #1c-2' },
  { nombre: 'COLEGIO LOS COMUNEROS - OSWALDO GUAYAZAMIN (IED) - SEDE A', direccion: 'Cl. 94a Sur' },
  { nombre: 'Colegio los Tejares IED', direccion: 'Cl. 75c Bis Sur #5-41' },
  { nombre: 'COLEGIO ARIEL DAVID', direccion: 'Cl. 88 Sur #2a Este-40 a, Cra 8 #2' },
  { nombre: 'Colegio Estanislao Zuleta I.E.D Sede B', direccion: 'Cra. 5h Este #Sur-44 a, Calle 90 D Sur #2' },
  { nombre: 'Colegio El Virrey José Solis', direccion: 'Cra. 2b Este #92-41' },
  { nombre: 'Liceo Max Planck', direccion: '1c Este-22, Cl. 81a Sur' },
  { nombre: 'Colegio San Juan de Los Pastos', direccion: 'Cl. 77 Sur #10 - 28' },
  { nombre: 'Colegio El Triunfo', direccion: 'Tv. 3g Bis A' },
  { nombre: 'Colegio Juan Rulfo', direccion: 'Cra. 12 #75a Sur40' },
  { nombre: 'Colegio Luis Eduardo Mora Osejo', direccion: 'Cl. 97B Sur #14B 64' },
  { nombre: 'Ied Tenerife Granada Sur sede A', direccion: 'Cra. 14B Bis #91 Sur14' },
  { nombre: 'Colegio San Marino', direccion: 'Cl. 10 #15' },
  { nombre: 'Colegio Miravalle', direccion: 'Cl. 76 Sur #14P-10' },
  { nombre: 'Liceo Latinoamericano del Sur', direccion: 'Cl. 78 Sur #1 H 13' },
  { nombre: 'Colegio José Eustasio Rivera IED', direccion: 'Dg. 136 Bis Sur #14-98' },
  { nombre: 'Colegio Almirante Padilla I.E.D. - Sede A', direccion: 'Cl. 76a Sur #1d Este' },
  { nombre: 'Liceo Nueva Colombia', direccion: 'Cra. 6f Este' },
  { nombre: 'Colegio Orlando Fals Borda', direccion: 'Cra. 1b Este #72 Sur-41 a 72 Sur-79' },
  { nombre: 'Colegio San Isidro', direccion: '# a 79 39, Cra. 1 Bis Este' },
  { nombre: 'Colegio Psicopedagógico Villaverde', direccion: 'Cra. 1c Este #91b Sur-04' },
  { nombre: 'Colegio Chuniza IED', direccion: 'Cra. 1g Este #84a Sur-42' },
  { nombre: 'IED Nuevo San Andrés De Los Altos', direccion: 'Cl. 69a Sur #1-7' },
  { nombre: 'Colegio Usminia Sede A', direccion: 'Carrera 9A Sur # 103A 17' },
  { nombre: 'COLEGIO ALFONSO LÓPEZ PUMAREJO (PRIVADO)', direccion: 'Cra 7A Este # 91-35 sur' },
  { nombre: 'Colegio Nuevo Mundo', direccion: 'Tv. 3c Bis #70a Sur15' },
  { nombre: 'JARDIN INFANTIL CASITA DEL SOL English Preschool', direccion: 'Cl. 73b Sur #14C-17' },
  { nombre: 'Colegio Ciudad Chengdu', direccion: 'Cra. 14C #74a Sur-6' },
  { nombre: 'Colegio Francisco Antonio Zea', direccion: 'Cl. 136 Sur #239' },
  { nombre: 'Liceo Juan Verdejo', direccion: 'Cl. 77a Sur #14' },
  { nombre: 'Instituto Técnico Comercial Julio Cortazar', direccion: 'Cra. 9A #16' },
  { nombre: 'Colegio El Cortijo - Vianey Sede A', direccion: 'Cra. 2a #74b Bis Sur0' },
  { nombre: 'Colegio Distrital Juan Rey Sede A (IED)', direccion: 'Calle 70 Sur # 13 B-27 Este' },
  { nombre: 'Colegio Nuevo San Andrés', direccion: 'Cl. 89C Sur #4i Este9' },
  { nombre: 'Colegio el virrey', direccion: 'Cl. 91 Sur #8' },
  { nombre: 'I.E.D Tenerife Granada Sur Sede B', direccion: 'Cl. 73 Sur #326' },
  { nombre: 'Colegio Fabio Lozano Simonelli', direccion: 'Calle 63 Sur # 16A63, La Fiscala Alta' },
  { nombre: 'Colegio Ciudad Bolívar', direccion: 'Cra. 14C #74a Sur5' },
  { nombre: 'Colegio Cristiano Elohim', direccion: 'Cra 14 #72 Sur-64' },
  { nombre: 'Ced Provincia de Quebec', direccion: 'Cl. 74c Sur #14 Este40' },
  { nombre: 'Colegio Chuniza Fámaco IED', direccion: 'Carrera 1 C Este #91B - 04 Sur' },
  { nombre: 'Ipres', direccion: 'Cra. 12 #2 a 76a' },
  { nombre: 'Colegio Fabio Lozano Simónelli sede A', direccion: 'Carrera 5B #64 Sur-80, Fiscala Alta' },
  { nombre: 'Colegio Maranata', direccion: 'Dg. 98 Sur #5i Este-2 a 5i Este-98' },
  { nombre: 'COLEGIO T.A.A.C. SAN GREGORIO HERNANDEZ', direccion: 'Cl. 76a Sur #12 05' },
  { nombre: 'Colegio Jaime Alberto Bonilla', direccion: 'Kr 14L #68b Sur-20' },
  { nombre: 'Colegio India Catalina', direccion: 'Kr 14L' },
  { nombre: 'Colegio Fe y Alegría Danubio Azul', direccion: 'Tv. 3b Este' },
  { nombre: 'Colegio Club Krwanis Bogotá', direccion: 'Cra. 4g Bis Este #90 Sur15' },
  { nombre: 'COLEGIO LOS TEJARES', direccion: 'Cl. 50 Sur #3 Este-21' },
  { nombre: 'Escuela Santa Librada', direccion: 'Cra. 1b Este #75-26' },
  { nombre: 'Colegio Pilares de La Paz', direccion: 'Cl. 90 Sur #5c Este11' },
  { nombre: 'Liceo pedagogico paraiso infantil', direccion: 'Cl. 102 Sur #5-14' },
  { nombre: 'Instituto Femenino San Antonio De Padua', direccion: 'Cl. 56 Sur #42 A' },
  { nombre: 'Colegio Gloria Valencia de Castaño', direccion: 'Ak. 15 Este #61a Sur-9 a 61a Sur-21' },
  { nombre: 'Colegio metrovivienda', direccion: 'KR 3, Cl. 133c Sur' },
  { nombre: 'Colegio Distrital San José Sur Oriental', direccion: 'Cl. 42 Sur' },
  { nombre: 'Colegio Naval Santafé de Bogotá', direccion: 'Colegio Naval, Cl. 66c #66 15' },
  { nombre: 'Centro Integral José Maria Córdoba I.E.D', direccion: 'Dg 48b Sur #24a73' },
  { nombre: 'Gimnasio Del Corazón De María', direccion: 'Cl. 73 Sur #24' },
  { nombre: 'Jardín Infantil Mis Primeros Pasos', direccion: 'Cl. 70 Sur #14A - 82' },
  { nombre: 'Colegio diego montaña cuellar', direccion: 'Cra 1 #97 Sur-77' },
  { nombre: 'Liceo Santa Ana del Sur', direccion: 'Cl 75 Sur #10-42' },
  { nombre: 'IED Juan Evangelista Gómez', direccion: 'Dg. 39 Sur #2 Este' },
  { nombre: 'Escuela Palermo Sur', direccion: 'Tv. 2d' },
  { nombre: 'Colegio El Nogal IED', direccion: 'Tv. 54 #71 Sur' },
  { nombre: 'Liceo Alameda', direccion: 'Cl. 89C Sur #09' },
  { nombre: 'Jardin Infantil Nueva Roma', direccion: 'Cra. 4 Este #50' },
  { nombre: 'CENTRO EDUCATIVO PROEDUCAR SANTA LIBRADA', direccion: 'Av Caracas #76 Sur-22' }
];

// Normaliza texto para comparar (minúsculas, sin tildes, sin espacios extra)
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/\s+/g, ' ')
    .trim();
}

// Busca el colegio cuyo nombre coincida (exacto o que lo contenga) con lo escrito
function buscarColegio(textoEscrito) {
  const buscado = normalizar(textoEscrito);
  if (!buscado) return null;

  // 1. Coincidencia exacta
  let encontrado = COLEGIOS.find(c => normalizar(c.nombre) === buscado);
  if (encontrado) return encontrado;

  // 2. El nombre del colegio contiene lo escrito, o lo escrito contiene el nombre
  encontrado = COLEGIOS.find(c => {
    const nombreNorm = normalizar(c.nombre);
    return nombreNorm.includes(buscado) || buscado.includes(nombreNorm);
  });
  if (encontrado) return encontrado;

  // 3. Coincidencia por palabras clave (todas las palabras del texto escrito
  // están presentes en el nombre del colegio)
  const palabras = buscado.split(' ').filter(p => p.length > 2);
  encontrado = COLEGIOS.find(c => {
    const nombreNorm = normalizar(c.nombre);
    return palabras.length > 0 && palabras.every(p => nombreNorm.includes(p));
  });
  return encontrado || null;
}

// ==================== HELPERS DE CIFRADO ====================
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

// ==================== ENDPOINT PRINCIPAL ====================
app.post('/flow', async (req, res) => {
  let decryptedAesKey, initialVector;

  try {
    const body = req.body;

    const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedAesKey
    );

    const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64');
    initialVector = Buffer.from(body.initial_vector, 'base64');

    const decryptedJSON = decryptAES(encryptedFlowData, decryptedAesKey, initialVector);
    const decryptedBody = JSON.parse(decryptedJSON);

    console.log('=== REQUEST ===');
    console.log('Action:', decryptedBody.action);
    console.log('Data:', JSON.stringify(decryptedBody.data, null, 2));

    let responseData = {};

    switch (decryptedBody.action) {
      case 'ping':
        responseData = { data: { status: 'active' } };
        break;

      case 'data_exchange': {
        const trigger = decryptedBody.data?.trigger;

        if (trigger === 'procesar_tipo_lugar') {
          const nombreDomicilio = decryptedBody.data.nombre_domicilio;
          const tipoLugar = decryptedBody.data.tipo_lugar;

          if (tipoLugar === 'colegio') {
            responseData = {
              screen: 'SELECCION_COLEGIO',
              data: { nombre_domicilio: nombreDomicilio }
            };
          } else {
            responseData = {
              screen: 'DATOS_DIRECCION',
              data: { nombre_domicilio: nombreDomicilio, tipo_lugar: tipoLugar }
            };
          }
        }

        else if (trigger === 'procesar_colegio') {
          const nombreDomicilio = decryptedBody.data.nombre_domicilio;
          const colegioNombre = decryptedBody.data.colegio_nombre;

          const colegio = buscarColegio(colegioNombre);

          if (!colegio) {
            responseData = {
              screen: 'COLEGIO_OTRO',
              data: { nombre_domicilio: nombreDomicilio, colegio_nombre: colegioNombre }
            };
          } else {
            responseData = {
              screen: 'INDICACIONES',
              data: {
                nombre_domicilio: nombreDomicilio,
                tipo_lugar: 'colegio',
                nombre_colegio: colegio.nombre,
                direccion: colegio.direccion,
                barrio: ''
              }
            };
          }
        }

        else {
          responseData = { error: 'Trigger desconocido: ' + trigger };
        }
        break;
      }

      case 'complete':
        console.log('=== DATOS DE DOMICILIO CONFIRMADOS ===');
        console.log(decryptedBody.data);

        responseData = {
          status: 'success',
          message: 'Datos de domicilio confirmados'
        };
        break;

      default:
        responseData = { error: 'Acción desconocida: ' + decryptedBody.action };
    }

    const responseIv = Buffer.from(initialVector.map(byte => ~byte & 0xFF));
    const encryptedResponse = encryptAES(responseData, decryptedAesKey, responseIv);

    console.log('=== RESPONSE DEBUG ===');
    console.log('encryptedResponse length:', encryptedResponse.length);

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);

  } catch (err) {
    console.error('=== ERROR EN /flow ===');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-flow-domicilios' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
