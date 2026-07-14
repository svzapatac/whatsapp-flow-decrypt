const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Lee la llave desde Base64
const PRIVATE_KEY = Buffer.from(process.env.PRIVATE_KEY_B64, 'base64').toString('utf-8');

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

    // APLANA decryptedBody en la raíz del JSON con ...decryptedBody
    res.json({
      ...decryptedBody,
      _aesKey: decryptedAesKey.toString('base64'),
      _iv: initialVector.toString('base64'),
    });
  } catch (error) {
    console.error('Full error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
