import { OrderService } from "../services/orderService.js";
import { OrderProcessor } from "../services/orderProcessor.js";

export class OrderController {
  constructor(tokenService) {
    this.orderService = new OrderService(tokenService);
    this.orderProcessor = new OrderProcessor(this.orderService);
  }

  getFilteredOrders = async (req, res) => {
    try {
      const { accountid, params, filterField, filterValue, filterFunction } =
        req.body;
      const data = await this.orderService.fetchOrders(accountid, params);

      const filteredOrders = data.orders.filter((order) =>
        order.orderItems.every((item) =>
          this.applyFilter(item, filterField, filterValue, filterFunction)
        )
      );

      res.json({ orders: filteredOrders });
    } catch (error) {
      this.handleError(res, error, "Fehler beim Abrufen der Bestellungen");
    }
  };

  updateFilteredOrders = async (req, res) => {
    try {
      const { accountid, params, filterField, filterValue, filterFunction } =
        req.body;

      const ordersData = await this.orderService.fetchOrders(accountid, params);
      const filteredOrders = ordersData.orders.filter((order) =>
        order.orderItems.every((item) =>
          this.applyFilter(item, filterField, filterValue, filterFunction)
        )
      );

      const uniqueProductNames = this.getUniqueProductNames(filteredOrders);
      const productsResponses = await this.orderService.fetchProducts(
        accountid,
        uniqueProductNames
      );
      const allProducts = productsResponses.flatMap((r) => r.products || []);

      const processedOrders = filteredOrders.map((order) =>
        this.processOrder(order, allProducts)
      );

      const jobId = await this.orderProcessor.createJob(processedOrders);
      const job = this.orderProcessor.getJob(jobId);

      res.json({
        jobId,
        accepted: job.stats.total,
        rejected: job.invalid.length,
        monitor: `/api/jobs/${jobId}`,
      });
    } catch (error) {
      this.handleError(
        res,
        error,
        "Fehler beim Starten der Bestellaktualisierung"
      );
    }
  };

  getJobStatus = async (req, res) => {
    try {
      const job = this.orderProcessor.getJob(req.params.jobId);

      if (!job) {
        return res.status(404).json({
          error: "Job nicht gefunden",
          code: "JOB_NOT_FOUND",
        });
      }

      res.json({
        status: job.status,
        stats: job.stats,
        invalid: job.invalid,
        ...(job.status === "completed" && {
          results: job.results,
          errors: job.errors,
        }),
      });
    } catch (error) {
      this.handleError(res, error, "Fehler beim Abrufen des Job-Status");
    }
  };

  applyFilter = (item, field, value, func) => {
    const fieldValue = item[field];
    if (!fieldValue) return false;

    const compareValue = value.startsWith("!") ? value.substring(1) : value;

    const result = fieldValue[func](compareValue);
    return value.startsWith("!") ? !result : result;
  };

  getUniqueProductNames = (orders) => {
    const names = new Set();
    orders.forEach((order) => {
      order.orderItems.forEach((item) => {
        if (item.productName) names.add(item.productName);
      });
    });
    return Array.from(names);
  };

  processOrder = (order, allProducts) => {
    const processedItems = order.orderItems.map((item) =>
      this.processOrderItem(item, allProducts)
    );

    const validItems = processedItems.filter((item) => !item.error);

    return {
      orderId: order.name,
      orderItems: validItems,
      hasValidItems: validItems.length > 0,
    };
  };

  processOrderItem = (item, allProducts) => {
    try {
      const { skuId, resourceId, quantity, name: itemName, productName } = item;

      const { product, sku } = this.findProductAndSku(allProducts, skuId);

      if (!product || !sku) {
        return this.createErrorItem(
          itemName,
          productName,
          "SKU_NOT_FOUND",
          `SKU ${skuId} in keinem Produkt gefunden`
        );
      }

      const targetPlan = sku.plans.find((p) => p.mpnId?.endsWith("P1Y:Y"));
      if (!targetPlan) {
        return this.createErrorItem(
          itemName,
          productName,
          "PLAN_NOT_FOUND",
          `Kein passender Plan für SKU ${skuId}`
        );
      }

      return {
        productId: product.name.split("/").pop(),
        skuId,
        planId: targetPlan.id,
        action: "UPDATE",
        quantity,
        resourceId,
        attributes: [
          {
            name: "operations",
            value: "changeSubscription",
          },
        ],
      };
    } catch (error) {
      return this.createErrorItem(
        item.name,
        item.productName,
        "PROCESSING_ERROR",
        error.message
      );
    }
  };

  findProductAndSku = (products, skuId) => {
    for (const product of products) {
      const sku = product.definition?.skus?.find((s) => s.id === skuId);
      if (sku) return { product, sku };
    }
    return { product: null, sku: null };
  };

  createErrorItem = (itemName, productName, errorCode, message) => ({
    error: errorCode,
    itemName,
    productName,
    message,
  });

  handleError = (res, error, defaultMessage) => {
    console.error(`${defaultMessage}:`, error);
    res.status(500).json({
      error: defaultMessage,
      ...(process.env.NODE_ENV === "development" && { details: error.message }),
    });
  };
}
