// db.js

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     process.env.DB_PORT     || 3300,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '1234',
  database: process.env.DB_NAME     || 'Cards',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;