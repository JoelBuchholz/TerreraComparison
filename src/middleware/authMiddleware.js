export const authenticateAdmin = (req, res, next) => {
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
  
    next();
  };
  
  export const verifyBearerToken = (tokenService) => (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  
    const token = authHeader.split(' ')[1];
    const tokenName = 'tdsynnex';
  
    if (token !== tokenService.getAccessToken(tokenName)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  
    next();
  };