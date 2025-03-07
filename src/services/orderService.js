import fetch from 'node-fetch';

export class OrderService {
  constructor(tokenService) {
    this.tokenService = tokenService;
  }

  async fetchOrders(accountid, params) {
    const response = await fetch('http://192.168.10.65:8080/getAllOrdersTDS', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.tokenService.getAccessToken('tdsynnex')}`,
        accountid,
        params
      }
    });
    return response.json();
  }

  async fetchProducts(accountid, productNames) {
    const requests = productNames.map(productName => 
      fetch('http://192.168.10.65:8080/getProductsTDS', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenService.getAccessToken('tdsynnex')}`,
          accountid,
          params: `?pageSize=1&language=DE&filter.name=${productName}`
        }
      }).then(res => res.json())
    );
    return Promise.all(requests);
  }

  async updateOrder(accountid, customerid, orderItems) {
    const response = await fetch('http://192.168.10.65:8080/addOrderTDS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.tokenService.getAccessToken('tdsynnex')}`,
        'accountid': accountid,
        'customerid': customerid
      },
      body: JSON.stringify({ orderItems })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Order update failed: ${error.message || response.statusText}`);
    }

    return response.json();
  }
}