import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: path.resolve(process.cwd(), '.env')
});

export const {
  TDS_INITIAL_TOKEN,
  TDS_URL,
  ADMIN_USER,
  ADMIN_PASSWORD,
  PORT = 3000
} = process.env;