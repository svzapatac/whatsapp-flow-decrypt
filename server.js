const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PRIVATE_KEY = Buffer.from(process.env.PRIVATE_KEY_B64, 'base64').toString('utf-8');

// ========== ENDPOINT: DESCIFRAR ==========
app.post('/decrypt', (req, res) => {
  try {
    const body = req.body;

    const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64');
    let initialVector = Buffer.from(body.initial_vector, 'base64');

    // WhatsApp envía IV de 16 bytes pero AES-GCM necesita 12
    if (initialVector.length === 16) {
      initialVector = initialVector.subarray(0, 12);
    }

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
      ...decryptedBody,
      _aesKey: decryptedAesKey.toString('base64'),
      _iv: initialVector.toString('base64'), // Guardamos el IV de 12 bytes
    });
  } catch (error) {
    console.error('Decrypt error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ENDPOINT: CIFRAR RESPUESTA ==========
app.post('/encrypt', (req, res) => {
  try {
    const body = req.body;

    const aesKey = Buffer.from(body.aesKey, 'base64');
    const iv = Buffer.from(body.iv, 'base64');
    const responseData = body.data;

    // IV de respuesta: invertir último byte
    const responseIv = Buffer.from(iv);
    responseIv[responseIv.length - 1] ^= 1;

    // Preparar respuesta para el Flow
    const responseObject = {
      version: "3.0",
      screen: responseData.screen || "DATOS",
      data: responseData.data || {}
    };

    // Cifrar con AES-128-GCM
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, responseIv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(responseObject), 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Concatenar y convertir a base64
    const finalResponse = Buffer.concat([encrypted, authTag]).toString('base64');

    res.json({ response: finalResponse });
  } catch (error) {
    console.error('Encrypt error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
