// db.js

require('dotenv').config();
const mysql = require('mysql2/promise');

if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
}

const pool = mysql.createPool({
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     process.env.DB_PORT || 3300,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'Cards',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;