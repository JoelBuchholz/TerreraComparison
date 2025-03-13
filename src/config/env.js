import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

export const {
  EXTERNAL_TOKEN_ROTATION_INTERVAL,
  USER_REFRESH_TOKEN_VALIDITY,
  TOKEN_PROVIDERS,
  TWO_FACTOR_SECRET,
  ADMIN_USER,
  ADMIN_PASSWORD,
  PORT = 3000,
} = process.env;
