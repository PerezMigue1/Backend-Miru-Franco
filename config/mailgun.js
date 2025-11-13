const formData = require('form-data');
const Mailgun = require('mailgun.js');

let mg = null;
let DOMAIN = null;

// Inicializar Mailgun solo si las variables de entorno están disponibles
if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
  try {
    const mailgun = new Mailgun(formData);
    // Configurar cliente con URL base de Mailgun (región EE.UU.)
    mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
      url: 'https://api.mailgun.net' // Base URL de Mailgun
    });
    DOMAIN = process.env.MAILGUN_DOMAIN;
    console.log('✅ Mailgun configurado correctamente');
  } catch (error) {
    console.error('Error inicializando Mailgun:', error);
  }
} else {
  console.warn('⚠️ Mailgun no configurado: faltan variables de entorno MAILGUN_API_KEY o MAILGUN_DOMAIN');
}

module.exports = { mg, DOMAIN };

