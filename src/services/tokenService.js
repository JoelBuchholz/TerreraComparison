export class TokenRotationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'TokenRotationError';
  }
}

export class TokenService {
  constructor() {
    this.tokens = {
      tdsynnex: {
        accessToken: '',
        refreshToken: process.env.TDS_INITIAL_TOKEN,
        lastTokenRotationTime: 0,
        url: process.env.TDS_URL,
      },
    };
    this.rotationInterval = null;
  }

  async rotateToken(tokenName) {
    try {
      const tokenData = this.tokens[tokenName];
      
      if (!tokenData.refreshToken || tokenData.refreshToken === 'expired') {
        throw new TokenRotationError(
          'Initial token has expired or is invalid',
          'INITIAL_TOKEN_EXPIRED'
        );
      }

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken
      });

      const response = await fetch(tokenData.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new TokenRotationError(
          errorData.error_description || 'Token rotation failed',
          errorData.error || 'TOKEN_ROTATION_FAILED'
        );
      }

      const data = await response.json();
      
      if (!data.access_token || !data.refresh_token) {
        throw new TokenRotationError(
          'Invalid token response from server',
          'INVALID_TOKEN_RESPONSE'
        );
      }

      this.tokens[tokenName] = {
        ...tokenData,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        lastTokenRotationTime: Date.now()
      };

      console.log(`Token ${tokenName} rotated successfully`);
      return true;
    } catch (error) {
      console.error(`Token rotation error (${error.code}): ${error.message}`);
      
      if (error.code === 'INITIAL_TOKEN_EXPIRED') {
        this.tokens[tokenName].refreshToken = 'expired';
      }
      
      throw error;
    }
  }

  getAccessToken(tokenName) {
    return this.tokens[tokenName]?.accessToken;
  }

  startTokenRotation() {
    this.rotationInterval = setInterval(async () => {
      for (const tokenName in this.tokens) {
        if (Date.now() - this.tokens[tokenName].lastTokenRotationTime >= 300000) {
          try {
            await this.rotateToken(tokenName);
          } catch (error) {
            console.error(`Automatic rotation failed: ${error.message}`);
          }
        }
      }
    }, 60000);
  }

  stopTokenRotation() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
  }
}