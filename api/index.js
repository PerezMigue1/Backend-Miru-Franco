const app = require('../server');

// Handler para Vercel Serverless Functions
module.exports = (req, res) => {
  return app(req, res);
};
