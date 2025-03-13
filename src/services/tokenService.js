import crypto from "crypto";

export class TokenRotationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "TokenRotationError";
  }
}

export class TokenService {
  constructor() {
    // Globales Intervall für die externe Token-Rotation (z. B. 300000 ms = 5 Minuten)
    this.externalTokenRotationInterval = process.env.EXTERNAL_TOKEN_ROTATION_INTERVAL
      ? parseInt(process.env.EXTERNAL_TOKEN_ROTATION_INTERVAL, 10)
      : 300000;

    // Lese die Anbieter-Konfiguration aus der ENV (z. B. {"tdsynnex": "TDS", "msgraph": "MS_GRAPH"})
    const providersConfig = process.env.TOKEN_PROVIDERS
      ? JSON.parse(process.env.TOKEN_PROVIDERS)
      : { tdsynnex: "TDS", msgraph: "MS_GRAPH" };

    this.tokens = {};
    for (const provider in providersConfig) {
      const prefix = providersConfig[provider];
      this.tokens[provider] = {
        accessToken: "",
        externalRefreshToken: process.env[`${prefix}_INITIAL_TOKEN`] || "",
        lastTokenRotationTime: 0,
        config: {
          url: process.env[`${prefix}_URL`],
          method: process.env[`${prefix}_METHOD`] || "POST",
          contentType:
            process.env[`${prefix}_CONTENT_TYPE`] ||
            "application/x-www-form-urlencoded",
          requestBodyTemplate:
            process.env[`${prefix}_REQUEST_BODY_TEMPLATE`] || "",
          responseKeys: {
            accessToken:
              process.env[`${prefix}_RESPONSE_ACCESS_KEY`] || "access_token",
            refreshToken: process.env[`${prefix}_RESPONSE_REFRESH_KEY`] || "",
          },
          rotationEnabled: process.env[`${prefix}_ROTATION_ENABLED`] === "true",
          extraHeaders: process.env[`${prefix}_EXTRA_HEADERS`]
            ? JSON.parse(process.env[`${prefix}_EXTRA_HEADERS`])
            : {},
          // Einstellungen für die Client-Secret-Rotation (optional und generisch)
          secretRotation: {
            enabled:
              process.env[`${prefix}_CLIENT_SECRET_ROTATION_ENABLED`] === "true",
            rotationInterval: process.env[`${prefix}_CLIENT_SECRET_ROTATION_INTERVAL`]
              ? parseInt(process.env[`${prefix}_CLIENT_SECRET_ROTATION_INTERVAL`], 10)
              : null,
            validity: process.env[`${prefix}_CLIENT_SECRET_VALIDITY`]
              ? parseInt(process.env[`${prefix}_CLIENT_SECRET_VALIDITY`], 10)
              : null,
            url: process.env[`${prefix}_CLIENT_SECRET_ROTATION_URL`],
            requestBodyTemplate:
              process.env[`${prefix}_CLIENT_SECRET_ROTATION_BODY_TEMPLATE`] || "",
            responseKeys: process.env[`${prefix}_CLIENT_SECRET_RESPONSE_KEYS`]
              ? JSON.parse(process.env[`${prefix}_CLIENT_SECRET_RESPONSE_KEYS`])
              : { newSecret: "secretText" },
          },
          // Für die Client-Secret-Rotation: Client-ID, Client-Secret und AppId (welche im Header gesendet wird)
          clientId: process.env[`${prefix}_CLIENT_ID`],
          clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
          appId: process.env[`${prefix}_APP_ID`],
        },
        // Intern verwaltete User‑Refresh‑Token (für die Authentifizierung der Rotations-Calls)
        userRefreshToken: null,
        userRefreshTokenExpiry: null, // Gültigkeitsdauer in ms (z. B. 3600000)
        userRefreshTokenCreatedAt: null, // Zeitpunkt der Erzeugung (Timestamp in ms)
        clientSecretRotationIntervalId: null,
      };
    }
    this.rotationInterval = null;
  }

  /**
   * Erzeugt einen neuen internen User‑Refresh‑Token.
   * Speichert dabei den aktuellen Zeitpunkt (userRefreshTokenCreatedAt) und die Gültigkeitsdauer (userRefreshTokenExpiry).
   */
  generateUserRefreshToken(tokenName) {
    const newUserToken = crypto.randomBytes(32).toString("hex");
    const validity = process.env.USER_REFRESH_TOKEN_VALIDITY
      ? parseInt(process.env.USER_REFRESH_TOKEN_VALIDITY, 10)
      : 3600000; // Standard: 1 Stunde
    const createdAt = Date.now();
    this.tokens[tokenName].userRefreshToken = newUserToken;
    this.tokens[tokenName].userRefreshTokenExpiry = validity;
    this.tokens[tokenName].userRefreshTokenCreatedAt = createdAt;
    return newUserToken;
  }

  /**
   * Baut den Request-Body anhand eines Templates.
   * Das Template kann Platzhalter wie {{refresh_token}}, {{client_secret}}, {{displayName}}, {{endDateTime}} etc. enthalten.
   * tokensObj enthält die zu ersetzenden Werte.
   */
  buildRequestBody(template, tokensObj) {
    let body = template;
    for (const key in tokensObj) {
      body = body.replace(new RegExp(`{{${key}}}`, "g"), tokensObj[key]);
    }
    return body;
  }

  /**
   * Führt einen generischen HTTP-Call durch (für Token- und Secret-Rotation).
   */
  async fetchGeneric(url, method, contentType, body, headers) {
    const requestOptions = {
      method,
      headers: { "Content-Type": contentType, ...headers },
    };
    if (method.toUpperCase() !== "GET") {
      requestOptions.body = body;
    } else {
      url += (url.includes("?") ? "&" : "?") + body;
    }
    const response = await fetch(url, requestOptions);
    if (!response.ok) {
      const errorData = await response.json();
      throw new TokenRotationError(
        errorData.error_description || "Request failed",
        errorData.error || "REQUEST_FAILED"
      );
    }
    return await response.json();
  }

  /**
   * Rotiert das externe Token anhand der konfigurierten Parameter.
   */
  async rotateToken(tokenName) {
    try {
      const tokenData = this.tokens[tokenName];
      const { config } = tokenData;
      if (!config.rotationEnabled) {
        console.log(`Rotation for ${tokenName} is disabled.`);
        return true;
      }
      // Erstelle ein Objekt, das alle relevanten Werte enthält:
      const tokensObj = {
        refresh_token: tokenData.externalRefreshToken, // für Flows, die refresh_token benötigen
        client_id: config.clientId || "",
        client_secret: config.clientSecret || "",
      };
      const body = this.buildRequestBody(config.requestBodyTemplate, tokensObj);
      const data = await this.fetchGeneric(
        config.url,
        config.method,
        config.contentType,
        body,
        config.extraHeaders
      );
      if (!data[config.responseKeys.accessToken]) {
        throw new TokenRotationError(
          "Invalid response: access token missing",
          "INVALID_RESPONSE"
        );
      }
      tokenData.accessToken = data[config.responseKeys.accessToken];
      if (
        config.responseKeys.refreshToken &&
        data[config.responseKeys.refreshToken]
      ) {
        tokenData.externalRefreshToken = data[config.responseKeys.refreshToken];
      }
      tokenData.lastTokenRotationTime = Date.now();
      console.log(`Token ${tokenName} rotated successfully.`);
      return true;
    } catch (error) {
      console.error(`Token rotation error (${error.code}): ${error.message}`);
      throw error;
    }
  }

  /**
   * Rotiert das Client-Secret (falls konfiguriert) mit derselben generischen Logik.
   * Der Request-Body wird anhand eines Templates zusammengesetzt, z. B. mit Platzhaltern {{displayName}} und {{endDateTime}}.
   * Im Header wird der "id"-Wert aus config.appId gesendet.
   */ 
  async rotateClientSecret(tokenName) {
    try {
      const tokenData = this.tokens[tokenName];
      const { config } = tokenData;
      if (!config.secretRotation.enabled) {
        console.log(`Client secret rotation for ${tokenName} is disabled.`);
        return;
      }
      if (!config.secretRotation.url || !config.appId) {
        throw new Error(`Missing client secret rotation URL or AppId for ${tokenName}`);
      }
      let accessToken = this.getAccessToken(tokenName);
      if (!accessToken) {
        console.log(`No access token for ${tokenName} available. Rotating token first.`);
        await this.rotateToken(tokenName);
        accessToken = this.getAccessToken(tokenName);
        if (!accessToken) {
          throw new Error(`Unable to obtain access token for ${tokenName} for secret rotation.`);
        }
      }
      const displayName = "ClientSecretRotation";
      // Berechne endDateTime anhand der VALIDITY, formatiert ohne Millisekunden (z. B. "2025-12-31T23:59:59Z")
      if (!config.secretRotation.validity) {
        throw new Error(`No client secret validity set for ${tokenName}`);
      }
      const computedDate = new Date(Date.now() + config.secretRotation.validity);
      const endDateTime = computedDate.toISOString().split(".")[0] + "Z";
      const tokensObj = {
        displayName,
        endDateTime,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      };
      const body = this.buildRequestBody(
        config.secretRotation.requestBodyTemplate,
        tokensObj
      );
      const headers = {
        "Content-Type": "application/json",
        id: config.appId,
        Authorization: `Bearer ${accessToken}`,
      };
      const data = await this.fetchGeneric(
        config.secretRotation.url,
        "POST",
        "application/json",
        body,
        headers
      );
      if (!data[config.secretRotation.responseKeys.newSecret]) {
        throw new Error(`Client secret rotation for ${tokenName} failed: no new secret returned.`);
      }
      config.clientSecret = data[config.secretRotation.responseKeys.newSecret];
      console.log(`Client secret for ${tokenName} rotated successfully.`);
      return data;
    } catch (error) {
      console.error(`Client secret rotation error for ${tokenName}: ${error.message}`);
      throw error;
    }
  }

  getAccessToken(tokenName) {
    return this.tokens[tokenName]?.accessToken;
  }

  /**
   * Startet die automatische Rotation aller externen Tokens, basierend auf dem globalen Intervall.
   */
  startTokenRotation() {
    this.rotationInterval = setInterval(async () => {
      for (const tokenName in this.tokens) {
        const tokenData = this.tokens[tokenName];
        if (
          tokenData.config.rotationEnabled &&
          Date.now() - tokenData.lastTokenRotationTime >= this.externalTokenRotationInterval
        ) {
          try {
            await this.rotateToken(tokenName);
          } catch (error) {
            console.error(`Automatic token rotation for ${tokenName} failed: ${error.message}`);
          }
        }
      }
    }, this.externalTokenRotationInterval);
  }

  stopTokenRotation() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
  }

  /**
   * Startet für alle Anbieter, bei denen die Client-Secret-Rotation aktiviert ist, einen Timer.
   */
  startClientSecretRotation() {
    for (const tokenName in this.tokens) {
      const tokenData = this.tokens[tokenName];
      const { secretRotation } = tokenData.config;
      if (secretRotation.enabled && secretRotation.rotationInterval) {
        tokenData.clientSecretRotationIntervalId = setInterval(async () => {
          try {
            await this.rotateClientSecret(tokenName);
          } catch (err) {
            console.error(`Automatic client secret rotation for ${tokenName} failed: ${err.message}`);
          }
        }, secretRotation.rotationInterval);
      }
    }
  }

  stopClientSecretRotation() {
    for (const tokenName in this.tokens) {
      const tokenData = this.tokens[tokenName];
      if (tokenData.clientSecretRotationIntervalId) {
        clearInterval(tokenData.clientSecretRotationIntervalId);
      }
    }
  }
}
