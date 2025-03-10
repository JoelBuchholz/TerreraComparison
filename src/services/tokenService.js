import crypto from 'crypto';

export class TokenRotationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'TokenRotationError';
  }
}

export class TokenService {
  constructor() {
    this.globalRotationInterval = process.env.GLOBAL_ROTATION_INTERVAL
      ? parseInt(process.env.GLOBAL_ROTATION_INTERVAL, 10)
      : 60000;

    const providersConfig = process.env.TOKEN_PROVIDERS 
      ? JSON.parse(process.env.TOKEN_PROVIDERS) 
      : { "tdsynnex": "TDS", "msgraph": "MS_GRAPH" };

    this.tokens = {};
    for (const provider in providersConfig) {
      const prefix = providersConfig[provider];
      this.tokens[provider] = {
        accessToken: '',
        externalRefreshToken: process.env[`${prefix}_INITIAL_TOKEN`] || '',
        lastTokenRotationTime: 0,
        config: {
          url: process.env[`${prefix}_URL`],
          method: process.env[`${prefix}_METHOD`] || 'POST',
          contentType: process.env[`${prefix}_CONTENT_TYPE`] || 'application/x-www-form-urlencoded',
          requestBodyTemplate: process.env[`${prefix}_REQUEST_BODY_TEMPLATE`] || '',
          responseAccessKey: process.env[`${prefix}_RESPONSE_ACCESS_KEY`] || 'access_token',
          responseRefreshKey: process.env[`${prefix}_RESPONSE_REFRESH_KEY`] || '',
          rotationEnabled: process.env[`${prefix}_ROTATION_ENABLED`] === 'true',
          extraHeaders: process.env[`${prefix}_EXTRA_HEADERS`] 
            ? JSON.parse(process.env[`${prefix}_EXTRA_HEADERS`])
            : {}
        },
        userRefreshToken: null,
        userRefreshTokenExpiry: null
      };
    }

    this.rotationInterval = null;
  }

  generateUserRefreshToken(tokenName) {
    const newUserToken = crypto.randomBytes(32).toString('hex');
    const validity = process.env.USER_REFRESH_TOKEN_VALIDITY
      ? parseInt(process.env.USER_REFRESH_TOKEN_VALIDITY, 10)
      : 3600000;
    const expiry = Date.now() + validity;
    this.tokens[tokenName].userRefreshToken = newUserToken;
    this.tokens[tokenName].userRefreshTokenExpiry = expiry;
    return newUserToken;
  }

  buildRequestBody(tokenData) {
    const { config, externalRefreshToken } = tokenData;
    let body = config.requestBodyTemplate || '';
    if (body.includes('{{refresh_token}}')) {
      return body.replace('{{refresh_token}}', externalRefreshToken);
    }
    return body;
  }

  async rotateToken(tokenName) {
    try {
      const tokenData = this.tokens[tokenName];
      const { config } = tokenData;

      if (config.requestBodyTemplate.includes('{{refresh_token}}')) {
        if (!tokenData.externalRefreshToken || tokenData.externalRefreshToken === 'expired') {
          throw new TokenRotationError(
            'Initial token has expired or is invalid',
            'INITIAL_TOKEN_EXPIRED'
          );
        }
      }

      if (!config.rotationEnabled) {
        console.log(`Rotation for ${tokenName} is disabled via environment settings.`);
        return true;
      }

      const requestOptions = {
        method: config.method,
        headers: { 'Content-Type': config.contentType },
      };

      if (config.extraHeaders && typeof config.extraHeaders === 'object') {
        Object.assign(requestOptions.headers, config.extraHeaders);
      }

      let url = config.url;

      if (config.method.toUpperCase() !== 'GET') {
        requestOptions.body = this.buildRequestBody(tokenData);
      } else {
        const query = this.buildRequestBody(tokenData);
        url += (url.includes('?') ? '&' : '?') + query;
      }

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorData = await response.json();
        throw new TokenRotationError(
          errorData.error_description || 'Token rotation failed',
          errorData.error || 'TOKEN_ROTATION_FAILED'
        );
      }

      const data = await response.json();
      const accessKey = config.responseAccessKey || 'access_token';
      const refreshKey = config.responseRefreshKey || '';

      if (!data[accessKey]) {
        throw new TokenRotationError(
          'Invalid token response from server: access token missing',
          'INVALID_TOKEN_RESPONSE'
        );
      }

      const newExternalRefreshToken = refreshKey && data[refreshKey]
        ? data[refreshKey]
        : tokenData.externalRefreshToken;

      this.tokens[tokenName] = {
        ...tokenData,
        accessToken: data[accessKey],
        externalRefreshToken: newExternalRefreshToken,
        lastTokenRotationTime: Date.now()
      };

      console.log(`Token ${tokenName} rotated successfully`);
      return true;
    } catch (error) {
      console.error(`Token rotation error (${error.code}): ${error.message}`);
      if (error.code === 'INITIAL_TOKEN_EXPIRED') {
        this.tokens[tokenName].externalRefreshToken = 'expired';
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
        const tokenData = this.tokens[tokenName];
        if (tokenData.config.rotationEnabled &&
            Date.now() - tokenData.lastTokenRotationTime >= 300000) {
          try {
            await this.rotateToken(tokenName);
          } catch (error) {
            console.error(`Automatic rotation for ${tokenName} failed: ${error.message}`);
          }
        }
      }
    }, this.globalRotationInterval);
  }

  stopTokenRotation() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
  }
}
