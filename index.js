import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const tokens = {
  tdsynnex: {
    accessToken: "",
    refreshToken: process.env.TDS_INITIAL_TOKEN,
    lastTokenRotationTime: 0,
    url: process.env.TDS_URL,
  },
};

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.status(401).json({ error: "Keine Zugangsdaten übermittelt" });
  }
  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString(
    "ascii"
  );
  const [username, password] = credentials.split(":");
  if (
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(403).json({ error: "Ungültige Zugangsdaten" });
  }
  next();
}

async function rotateToken(tokenName) {
  try {
    const tokenData = tokens[tokenName];
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", tokenData.refreshToken);

    const response = await fetch(tokenData.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await response.json();
    tokenData.accessToken = data.access_token;
    tokenData.refreshToken = data.refresh_token;
    tokenData.lastTokenRotationTime = Date.now();
    console.log(
      `Token ${tokenName} erfolgreich rotiert: ${new Date().toLocaleString(
        "de-DE",
        {
          timeZone: "Europe/Berlin",
        }
      )}`
    );
  } catch (error) {
    console.error(`Fehler beim Rotieren des Tokens ${tokenName}: ${error}`);
  }
}

app.get("/token/:tokenName", authenticateAdmin, async (req, res) => {
  const tokenName = req.params.tokenName.toLowerCase();
  if (!tokens[tokenName]) {
    return res.status(400).json({ error: "Ungültiger Token-Name" });
  }
  try {
    await rotateToken(tokenName);
    res.json({ access_token: tokens[tokenName].accessToken });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Tokenrotation fehlgeschlagen für ${tokenName}` });
  }
});

app.post("/getFilteredOrders", async (req, res) => {
  const { accountid, params, filterField, filterValue, filterFunction } =
    req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  const tokenName = "tdsynnex";

  if (token !== tokens[tokenName].accessToken) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const response = await fetch("http://192.168.10.65:8080/getAllOrdersTDS", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens[tokenName].accessToken}`,
        accountid: accountid,
        params: params,
      },
    });

    const data = await response.json();

    const filteredOrders = data.orders.filter((order) =>
      order.orderItems.every((item) => {
        const fieldValue = item[filterField];
        if (filterValue.startsWith("!")) {
          const value = filterValue.substring(1);
          return fieldValue && !fieldValue[filterFunction](value);
        } else {
          return fieldValue && fieldValue[filterFunction](filterValue);
        }
      })
    );

    res.json({ orders: filteredOrders });
  } catch (error) {
    res.status(500).json({ error: `error: ${error}` });
  }
});

app.post("/updateFilteredOrders", async (req, res) => {
  const { accountid, params, filterField, filterValue, filterFunction } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  const tokenName = "tdsynnex";

  if (token !== tokens[tokenName].accessToken) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const ordersResponse = await fetch("http://192.168.10.65:8080/getAllOrdersTDS", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens[tokenName].accessToken}`,
        accountid: accountid,
        params: params,
      },
    });
    
    const ordersData = await ordersResponse.json();

    const filteredOrders = ordersData.orders.filter(order =>
      order.orderItems.every(item => {
        const fieldValue = item[filterField];
        if (filterValue.startsWith("!")) {
          const value = filterValue.substring(1);
          return fieldValue && !fieldValue[filterFunction](value);
        } else {
          return fieldValue && fieldValue[filterFunction](filterValue);
        }
      })
    );

    const uniqueProductNames = [...new Set(
      filteredOrders.flatMap(order => 
        order.orderItems.map(item => item.productName)
    ))].filter(Boolean);

    const productsResponses = await Promise.all(
      uniqueProductNames.map(productName => 
        fetch("http://192.168.10.65:8080/getProductsTDS", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokens[tokenName].accessToken}`,
            accountid: accountid,
            params: `?pageSize=1&language=DE&filter.name=${productName}`
          }
        }).then(res => res.json())
      )
    );

    const allProducts = productsResponses.flatMap(r => r.products || []);

    const result = filteredOrders.map(order => {
      const processedItems = order.orderItems.map(item => {
        const { skuId, resourceId, quantity, name: itemName, productName } = item;
        
        let foundProduct = null;
        let foundSku = null;
        
        for (const product of allProducts) {
          foundSku = product.definition?.skus?.find(sku => sku.id === skuId);
          if (foundSku) {
            foundProduct = product;
            break;
          }
        }

        if (!foundProduct) {
          return {
            error: "SKU_NOT_FOUND",
            itemName,
            productName,
            message: `SKU ${skuId} in keinem Produkt gefunden`
          };
        }

        const targetPlan = foundSku.plans.find(p => p.mpnId?.endsWith('P1Y:Y'));
        if (!targetPlan) {
          return {
            error: "PLAN_NOT_FOUND",
            itemName,
            productName,
            message: `Kein passender Plan für SKU ${skuId}`
          };
        }

        return {
          productId: foundProduct.name.split('/').pop(),
          skuId,
          planId: targetPlan.id,
          action: "UPDATE",
          quantity,
          resourceId,
          attributes: [{
            name: "operations",
            value: "changeSubscription"
          }]
        };
      });


      const finalItems = processedItems.filter(item => {
        if (!item.error) return true;
        return !processedItems.some(i => 
          i.skuId === item.skuId && !i.error
        );
      });

      return {
        orderId: order.name,
        orderItems: finalItems
      };
    });

    res.json({
      orderItems: result.filter(order => order.orderItems.length > 0)
    });

  } catch (error) {
    res.status(500).json({ 
      error: "Server error",
      details: error.message 
    });
  }
});

setInterval(async () => {
  for (const tokenName in tokens) {
    if (Date.now() - tokens[tokenName].lastTokenRotationTime >= 300000) {
      await rotateToken(tokenName);
    }
  }
}, 60000);

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
