// [EXPOSICIÓN] Aquí vive la conexión a MySQL, no en index.html ni en el navegador.
'use strict';'use strict';

const mysql = require('mysql2/promise');

if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) {
  console.error('Error: Configura DB_USER y DB_PASSWORD en el archivo .env.');
  process.exit(1);
}

// Pool de conexiones a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'BodegaArmando',
  decimalNumbers: true,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'local',
  charset: 'utf8mb4'
});

// Funciones de ayuda para consultas SQL limpias
async function uno(sql, params = []) {
  const [filas] = await pool.execute(sql, params);
  return filas[0] || null;
}

async function todos(sql, params = []) {
  const [filas] = await pool.execute(sql, params);
  return filas;
}

module.exports = {
  pool,
  uno,
  todos
};
