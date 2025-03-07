import { TokenRotationError } from '../services/tokenService.js';

export class TokenController {
  constructor(tokenService) {
    this.tokenService = tokenService;
  }

  formatRotationTime = (timestamp) => {
    return new Date(timestamp).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'full',
      timeStyle: 'long'
    });
  };

  handleTokenRotation = async (req, res) => {
    const tokenName = req.params.tokenName.toLowerCase();
    
    if (!this.tokenService.tokens[tokenName]) {
      return res.status(400).json({
        error: 'Invalid token name',
        code: 'INVALID_TOKEN_NAME',
        validTokens: Object.keys(this.tokenService.tokens)
      });
    }

    try {
      const result = await this.tokenService.rotateToken(tokenName);
      
      if (!result) {
        throw new TokenRotationError(
          'Token rotation failed without error',
          'UNKNOWN_FAILURE'
        );
      }

      res.json({
        success: true,
        access_token: this.tokenService.getAccessToken(tokenName),
        expires_in: 300,
        next_rotation: this.formatRotationTime(Date.now() + 300000),
      });

    } catch (error) {
      const response = {
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
      };

      switch (error.code) {
        case 'INITIAL_TOKEN_EXPIRED':
          res.status(401).json({
            ...response,
            solution: 'Renew initial token in environment variables'
          });
          break;

        case 'TOKEN_ROTATION_FAILED':
          res.status(502).json({
            ...response,
            solution: 'Check external token service availability'
          });
          break;

        default:
          res.status(500).json(response);
      }
    }
  };
}