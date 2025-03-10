import speakeasy from 'speakeasy';

export const initialTokenAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Keine Zugangsdaten übermittelt' });
  }
  
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  
  if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Ungültige Zugangsdaten' });
  }
  
  const { twoFactorCode } = req.body;
  if (!twoFactorCode) {
    return res.status(400).json({ error: 'Zwei-Faktor-Code fehlt' });
  }
  
  const verified = speakeasy.totp.verify({
    secret: process.env.TWO_FACTOR_SECRET,
    encoding: 'base32',
    token: twoFactorCode,
    window: 1
  });
  
  if (!verified) {
    return res.status(401).json({ error: 'Ungültiger Zwei-Faktor-Code' });
  }
  
  next();
};
