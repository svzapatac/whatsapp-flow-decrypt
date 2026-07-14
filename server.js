const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Función para formatear la llave correctamente
function formatPrivateKey(key) {
  // Si la llave tiene espacios en lugar de saltos de línea, los reemplazamos
  // Pero primero verificamos si ya tiene el formato correcto
  if (key.includes('-----BEGIN PRIVATE KEY-----')) {
    // Reemplazar espacios que no sean saltos de línea entre las partes de la llave
    // La llave PEM debe tener saltos de línea cada 64 caracteres aprox
    
    // Si no tiene saltos de línea después del header, los agregamos
    let formatted = key
      .replace(/-----BEGIN PRIVATE KEY----- /, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/ -----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----');
    
    // Si la llave está en una sola línea (sin saltos), intentamos formatearla
    if (!formatted.includes('\n')) {
      const header = '-----BEGIN PRIVATE KEY-----';
      const footer = '-----END PRIVATE KEY-----';
      const body = formatted
        .replace(header, '')
        .replace(footer, '')
        .trim()
        .replace(/\s+/g, ''); // quitar todos los espacios del body
      
      // Insertar saltos de línea cada 64 caracteres
      const formattedBody = body.match(/.{1,64}/g).join('\n');
      formatted = `${header}\n${formattedBody}\n${footer}`;
    }
    
    return formatted;
  }
  return key;
}

const PRIVATE_KEY = formatPrivateKey(process.env.PRIVATE_KEY);

app.post('/decrypt', (req, res) => {
  try {
    const body = req.body;

    const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64');
    const initialVector = Buffer.from(body.initial_vector, 'base64');

    // 1. Descifra la AES key con RSA-OAEP
    const decryptedAesKey = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedAesKey
    );

    // 2. Extrae auth tag (últimos 16 bytes)
    const TAG_LENGTH = 16;
    const encryptedBody = encryptedFlowData.subarray(0, encryptedFlowData.length - TAG_LENGTH);
    const authTag = encryptedFlowData.subarray(encryptedFlowData.length - TAG_LENGTH);

    // 3. Descifra con AES-128-GCM
    const decipher = crypto.createDecipheriv('aes-128-gcm', decryptedAesKey, initialVector);
    decipher.setAuthTag(authTag);

    const decryptedJSON = Buffer.concat([
      decipher.update(encryptedBody),
      decipher.final(),
    ]).toString('utf-8');

    const decryptedBody = JSON.parse(decryptedJSON);

    res.json({
      decryptedBody,
      _aesKey: decryptedAesKey.toString('base64'),
      _iv: initialVector.toString('base64'),
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
