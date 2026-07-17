const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ==================== CONFIGURACIÓN ====================
// Este servidor es SOLO para el Flow de "Datos de domicilio" (colegios,
// direcciones, barrios). No comparte nada con el servidor de Calendar/reservas.
const PRIVATE_KEY = Buffer.from(process.env.PRIVATE_KEY_B64, 'base64').toString('utf-8');

// ==================== BASE DE DATOS DE COLEGIOS ====================
// id -> { nombre, direccion }
const COLEGIOS = {
  'colegio_distrital_paulo_freire': { nombre: 'Colegio Distrital Paulo Freire', direccion: 'Cra. 11 #65D 50 Sur' },
  'colegio_san_josé_de_usme_ied': { nombre: 'COLEGIO SAN JOSÉ DE USME IED', direccion: 'A #, Cl. 96 Sur #11' },
  'colegio_juan_luis_londoño_ied_': { nombre: 'Colegio Juan Luis Londoño IED - La Salle', direccion: 'Cra 7H 66A #20 sur' },
  'colegio_liceo_comercial_nuevo_': { nombre: 'Colegio Liceo Comercial Nuevo Alejandrinos', direccion: 'Carrera 4B, Cl. 30 Sur #No. 56 - 24' },
  'colegio_fernando_gonzalez_ocho': { nombre: 'COLEGIO FERNANDO GONZALEZ OCHOA (IED)', direccion: 'Cra. 4d Este #89 Sur77' },
  'colegio_santa_martha_i_e_d': { nombre: 'Colegio Santa Martha I.E.D.', direccion: 'Cra. 1b Bis Este' },
  'colegio_atabanzha_ied': { nombre: 'COLEGIO ATABANZHA (IED)', direccion: 'Cl. 92 Sur #2-43' },
  'i_e_d_brasilia_usme': { nombre: 'I.E.D BRASILIA USME', direccion: 'Cl. 73b Sur #1 a 73b' },
  'colegio_nueva_esperanza_i_e_d_': { nombre: 'COLEGIO NUEVA ESPERANZA I.E.D. SEDE A', direccion: 'Cl. 76b Sur' },
  'colegio_ofelia_uribe_de_acosta': { nombre: 'Colegio Ofelia Uribe de Acosta', direccion: 'Cl. 81a Sur #6 Este40' },
  'colegio_centro_cultural': { nombre: 'Colegio Centro Cultural', direccion: 'Cl. 72A Sur' },
  'instituto_el_ingenioso_hidalgo': { nombre: 'Instituto El Ingenioso Hidalgo', direccion: 'Cl. 89 Sur #18' },
  'colegio_santa_maría_de_la_paz': { nombre: 'Colegio Santa María de La Paz', direccion: 'Kr 3F #73b Sur21' },
  'colegio_brazuelos_ied': { nombre: 'Colegio Brazuelos IED', direccion: 'Cl. 104 Sur #1b-81' },
  'colegio_isidro_molina': { nombre: 'Colegio Isidro Molina', direccion: 'Calle 78 Sur #1h-16E, Betania' },
  'ced_gran_yomasa': { nombre: 'Ced Gran Yomasa', direccion: 'Cl. 81c Sur' },
  'colegio_ied_la_aurora': { nombre: 'Colegio IED La Aurora', direccion: 'Kr 14L #7103' },
  'colegio_andrés_escobar': { nombre: 'Colegio Andrés Escobar', direccion: 'Cra. 4 #55b - 15 sur' },
  'ied_san_cayetano': { nombre: 'IED San Cayetano', direccion: 'Cl. 74a Sur &, Cra. 17 Este' },
  'colegio_santa_librada_ied': { nombre: 'Colegio Santa Librada IED', direccion: 'Cl. 75b Sur #1b Este-1 a, Cra. 1b Este #65' },
  'colegio_eduardo_umaña_mendoza': { nombre: 'Colegio Eduardo Umaña Mendoza', direccion: 'Calle 111 sur N° 4 B - 07 Este' },
  'liceo_maría_nell': { nombre: 'Liceo María Nell', direccion: 'Cra 8 #81 58 sur' },
  'liceo_adolfo_león_gómez': { nombre: 'Liceo Adolfo León Gómez', direccion: 'Cra. 3 Este #101a Sur8' },
  'colegio_federico_garcia_lorca_': { nombre: 'COLEGIO FEDERICO GARCIA LORCA (IED)', direccion: 'Cra. 4 Este #82 Sur45' },
  'colegio_miguel_de_cervantes_sa': { nombre: 'Colegio Miguel De Cervantes Saavedra', direccion: 'a 1c-30, Dg. 76b Sur #1c-2' },
  'colegio_los_comuneros_oswaldo_': { nombre: 'COLEGIO LOS COMUNEROS - OSWALDO GUAYAZAMIN (IED) - SEDE A', direccion: 'Cl. 94a Sur' },
  'colegio_los_tejares_ied': { nombre: 'Colegio los Tejares IED', direccion: 'Cl. 75c Bis Sur #5-41' },
  'colegio_ariel_david': { nombre: 'COLEGIO ARIEL DAVID', direccion: 'Cl. 88 Sur #2a Este-40 a, Cra 8 #2' },
  'colegio_estanislao_zuleta_i_e_': { nombre: 'Colegio Estanislao Zuleta I.E.D Sede B', direccion: 'Cra. 5h Este #Sur-44 a, Calle 90 D Sur #2' },
  'colegio_el_virrey_josé_solis': { nombre: 'Colegio El Virrey José Solis', direccion: 'Cra. 2b Este #92-41' },
  'liceo_max_planck': { nombre: 'Liceo Max Planck', direccion: '1c Este-22, Cl. 81a Sur' },
  'colegio_san_juan_de_los_pastos': { nombre: 'Colegio San Juan de Los Pastos', direccion: 'Cl. 77 Sur #10 - 28' },
  'colegio_el_triunfo': { nombre: 'Colegio El Triunfo', direccion: 'Tv. 3g Bis A' },
  'colegio_juan_rulfo': { nombre: 'Colegio Juan Rulfo', direccion: 'Cra. 12 #75a Sur40' },
  'colegio_luis_eduardo_mora_osej': { nombre: 'Colegio Luis Eduardo Mora Osejo', direccion: 'Cl. 97B Sur #14B 64' },
  'ied_tenerife_granada_sur_sede_': { nombre: 'Ied Tenerife Granada Sur sede A', direccion: 'Cra. 14B Bis #91 Sur14' },
  'colegio_san_marino': { nombre: 'Colegio San Marino', direccion: 'Cl. 10 #15' },
  'colegio_miravalle': { nombre: 'Colegio Miravalle', direccion: 'Cl. 76 Sur #14P-10' },
  'liceo_latinoamericano_del_sur': { nombre: 'Liceo Latinoamericano del Sur', direccion: 'Cl. 78 Sur #1 H 13' },
  'colegio_josé_eustasio_rivera_i': { nombre: 'Colegio José Eustasio Rivera IED', direccion: 'Dg. 136 Bis Sur #14-98' },
  'colegio_almirante_padilla_i_e_': { nombre: 'Colegio Almirante Padilla I.E.D. - Sede A', direccion: 'Cl. 76a Sur #1d Este' },
  'liceo_nueva_colombia': { nombre: 'Liceo Nueva Colombia', direccion: 'Cra. 6f Este' },
  'colegio_orlando_fals_borda': { nombre: 'Colegio Orlando Fals Borda', direccion: 'Cra. 1b Este #72 Sur-41 a 72 Sur-79' },
  'colegio_san_isidro': { nombre: 'Colegio San Isidro', direccion: '# a 79 39, Cra. 1 Bis Este' },
  'colegio_psicopedagógico_villav': { nombre: 'Colegio Psicopedagógico Villaverde', direccion: 'Cra. 1c Este #91b Sur-04' },
  'colegio_chuniza_ied': { nombre: 'Colegio Chuniza IED', direccion: 'Cra. 1g Este #84a Sur-42' },
  'ied_nuevo_san_andrés_de_los_al': { nombre: 'IED Nuevo San Andrés De Los Altos', direccion: 'Cl. 69a Sur #1-7' },
  'colegio_usminia_sede_a': { nombre: 'Colegio Usminia Sede A', direccion: 'Carrera 9A Sur # 103A 17' },
  'colegio_alfonso_lópez_pumarejo': { nombre: 'COLEGIO ALFONSO LÓPEZ PUMAREJO (PRIVADO)', direccion: 'Cra 7A Este # 91-35 sur' },
  'colegio_nuevo_mundo': { nombre: 'Colegio Nuevo Mundo', direccion: 'Tv. 3c Bis #70a Sur15' },
  'jardin_infantil_casita_del_sol': { nombre: 'JARDIN INFANTIL CASITA DEL SOL English Preschool', direccion: 'Cl. 73b Sur #14C-17' },
  'colegio_ciudad_chengdu': { nombre: 'Colegio Ciudad Chengdu', direccion: 'Cra. 14C #74a Sur-6' },
  'colegio_francisco_antonio_zea': { nombre: 'Colegio Francisco Antonio Zea', direccion: 'Cl. 136 Sur #239' },
  'liceo_juan_verdejo': { nombre: 'Liceo Juan Verdejo', direccion: 'Cl. 77a Sur #14' },
  'instituto_técnico_comercial_ju': { nombre: 'Instituto Técnico Comercial Julio Cortazar', direccion: 'Cra. 9A #16' },
  'colegio_el_cortijo_vianey_sede': { nombre: 'Colegio El Cortijo - Vianey Sede A', direccion: 'Cra. 2a #74b Bis Sur0' },
  'colegio_distrital_juan_rey_sed': { nombre: 'Colegio Distrital Juan Rey Sede A (IED)', direccion: 'Calle 70 Sur # 13 B-27 Este' },
  'colegio_nuevo_san_andrés': { nombre: 'Colegio Nuevo San Andrés', direccion: 'Cl. 89C Sur #4i Este9' },
  'colegio_el_virrey': { nombre: 'Colegio el virrey', direccion: 'Cl. 91 Sur #8' },
  'i_e_d_tenerife_granada_sur_sed': { nombre: 'I.E.D Tenerife Granada Sur Sede B', direccion: 'Cl. 73 Sur #326' },
  'colegio_fabio_lozano_simonelli': { nombre: 'Colegio Fabio Lozano Simonelli', direccion: 'Calle 63 Sur # 16A63, La Fiscala Alta' },
  'colegio_ciudad_bolívar': { nombre: 'Colegio Ciudad Bolívar', direccion: 'Cra. 14C #74a Sur5' },
  'colegio_cristiano_elohim': { nombre: 'Colegio Cristiano Elohim', direccion: 'Cra 14 #72 Sur-64' },
  'ced_provincia_de_quebec': { nombre: 'Ced Provincia de Quebec', direccion: 'Cl. 74c Sur #14 Este40' },
  'colegio_chuniza_fámaco_ied': { nombre: 'Colegio Chuniza Fámaco IED', direccion: 'Carrera 1 C Este #91B - 04 Sur' },
  'ipres': { nombre: 'Ipres', direccion: 'Cra. 12 #2 a 76a' },
  'colegio_fabio_lozano_simónelli': { nombre: 'Colegio Fabio Lozano Simónelli sede A', direccion: 'Carrera 5B #64 Sur-80, Fiscala Alta' },
  'colegio_maranata': { nombre: 'Colegio Maranata', direccion: 'Dg. 98 Sur #5i Este-2 a 5i Este-98' },
  'colegio_t_a_a_c_san_gregorio_h': { nombre: 'COLEGIO T.A.A.C. SAN GREGORIO HERNANDEZ', direccion: 'Cl. 76a Sur #12 05' },
  'colegio_jaime_alberto_bonilla': { nombre: 'Colegio Jaime Alberto Bonilla', direccion: 'Kr 14L #68b Sur-20' },
  'colegio_india_catalina': { nombre: 'Colegio India Catalina', direccion: 'Kr 14L' },
  'colegio_fe_y_alegría_danubio_a': { nombre: 'Colegio Fe y Alegría Danubio Azul', direccion: 'Tv. 3b Este' },
  'colegio_club_krwanis_bogotá': { nombre: 'Colegio Club Krwanis Bogotá', direccion: 'Cra. 4g Bis Este #90 Sur15' },
  'colegio_los_tejares': { nombre: 'COLEGIO LOS TEJARES', direccion: 'Cl. 50 Sur #3 Este-21' },
  'escuela_santa_librada': { nombre: 'Escuela Santa Librada', direccion: 'Cra. 1b Este #75-26' },
  'colegio_pilares_de_la_paz': { nombre: 'Colegio Pilares de La Paz', direccion: 'Cl. 90 Sur #5c Este11' },
  'liceo_pedagogico_paraiso_infan': { nombre: 'Liceo pedagogico paraiso infantil', direccion: 'Cl. 102 Sur #5-14' },
  'instituto_femenino_san_antonio': { nombre: 'Instituto Femenino San Antonio De Padua', direccion: 'Cl. 56 Sur #42 A' },
  'colegio_gloria_valencia_de_cas': { nombre: 'Colegio Gloria Valencia de Castaño', direccion: 'Ak. 15 Este #61a Sur-9 a 61a Sur-21' },
  'colegio_metrovivienda': { nombre: 'Colegio metrovivienda', direccion: 'KR 3, Cl. 133c Sur' },
  'colegio_distrital_san_josé_sur': { nombre: 'Colegio Distrital San José Sur Oriental', direccion: 'Cl. 42 Sur' },
  'colegio_naval_santafé_de_bogot': { nombre: 'Colegio Naval Santafé de Bogotá', direccion: 'Colegio Naval, Cl. 66c #66 15' },
  'centro_integral_josé_maria_cór': { nombre: 'Centro Integral José Maria Córdoba I.E.D', direccion: 'Dg 48b Sur #24a73' },
  'gimnasio_del_corazón_de_maría': { nombre: 'Gimnasio Del Corazón De María', direccion: 'Cl. 73 Sur #24' },
  'jardín_infantil_mis_primeros_p': { nombre: 'Jardín Infantil Mis Primeros Pasos', direccion: 'Cl. 70 Sur #14A - 82' },
  'colegio_diego_montaña_cuellar': { nombre: 'Colegio diego montaña cuellar', direccion: 'Cra 1 #97 Sur-77' },
  'liceo_santa_ana_del_sur': { nombre: 'Liceo Santa Ana del Sur', direccion: 'Cl 75 Sur #10-42' },
  'ied_juan_evangelista_gómez': { nombre: 'IED Juan Evangelista Gómez', direccion: 'Dg. 39 Sur #2 Este' },
  'escuela_palermo_sur': { nombre: 'Escuela Palermo Sur', direccion: 'Tv. 2d' },
  'colegio_el_nogal_ied': { nombre: 'Colegio El Nogal IED', direccion: 'Tv. 54 #71 Sur' },
  'liceo_alameda': { nombre: 'Liceo Alameda', direccion: 'Cl. 89C Sur #09' },
  'jardin_infantil_nueva_roma': { nombre: 'Jardin Infantil Nueva Roma', direccion: 'Cra. 4 Este #50' },
  'centro_educativo_proeducar_san': { nombre: 'CENTRO EDUCATIVO PROEDUCAR SANTA LIBRADA', direccion: 'Av Caracas #76 Sur-22' }
};

// ==================== HELPERS DE CIFRADO (igual al otro servidor) ====================
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
          const colegioId = decryptedBody.data.colegio_id;

          if (colegioId === 'otro') {
            responseData = {
              screen: 'COLEGIO_OTRO',
              data: { nombre_domicilio: nombreDomicilio }
            };
          } else {
            const colegio = COLEGIOS[colegioId];

            if (!colegio) {
              // Por si acaso llega un id que no existe en nuestra base
              responseData = {
                screen: 'COLEGIO_OTRO',
                data: { nombre_domicilio: nombreDomicilio }
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

// ==================== HEALTH CHECK ====================
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-flow-domicilios' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
