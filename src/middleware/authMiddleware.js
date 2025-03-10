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