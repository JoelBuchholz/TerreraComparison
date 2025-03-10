export const verifyUserRefreshToken = (tokenService) => (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token missing' });
  }
  const providedToken = authHeader.split(' ')[1];
  const tokenName = req.params.tokenName.toLowerCase();
  const tokenData = tokenService.tokens[tokenName];

  if (!tokenData || !tokenData.userRefreshToken || providedToken !== tokenData.userRefreshToken) {
    return res.status(401).json({ error: 'Invalid user refresh token' });
  }
  if (!tokenData.userRefreshTokenExpiry || Date.now() > tokenData.userRefreshTokenExpiry) {
    return res.status(401).json({ error: 'User refresh token expired' });
  }
  next();
};