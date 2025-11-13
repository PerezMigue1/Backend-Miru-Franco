const crypto = require('crypto');

function generarTokenVerificacion() {
  return crypto.randomBytes(32).toString('hex');
}

function generarLinkVerificacion(token, email) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${baseUrl}/verificar-email?token=${token}&email=${encodeURIComponent(email)}`;
}

module.exports = {
  generarTokenVerificacion,
  generarLinkVerificacion
};

