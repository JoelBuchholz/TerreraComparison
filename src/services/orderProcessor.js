import async from "async";
import { v4 as uuidv4 } from "uuid";
import { OrderService } from "./orderService.js";

export class OrderProcessor {
  constructor(orderService) {
    if (!(orderService instanceof OrderService)) {
      throw new Error("Invalid OrderService instance");
    }

    this.orderService = orderService;
    this.jobs = new Map();
    this.CONCURRENCY = process.env.CONCURRENCY || 5;
  }

  async createJob(processedOrders) {
    const jobId = uuidv4();
    const { valid, invalid } = this.validateOrders(processedOrders);

    this.jobs.set(jobId, {
      status: "processing",
      created: new Date(),
      stats: {
        total: valid.length,
        succeeded: 0,
        failed: 0,
      },
      results: [],
      errors: [],
      invalid,
    });

    this.processQueue(jobId, valid);
    return jobId;
  }

  validateOrders(orders) {
    return orders.reduce(
      (acc, order) => {
        const isValid =
          order.orderItems?.length > 0 &&
          !order.orderItems.some((item) => item.error);

        isValid ? acc.valid.push(order) : acc.invalid.push(order);
        return acc;
      },
      { valid: [], invalid: [] }
    );
  }

  async processQueue(jobId, orders) {
    const queue = async.queue(async (order) => {
      if (order.orderItems.length === 0) {
        this.updateJob(jobId, {
          type: "error",
          orderId: order.orderId,
          error: "No valid items to process",
        });
        return;
      }
      try {
        const idParts = order.orderId.split("/");
        if (idParts.length < 5) throw new Error("Invalid orderId format");

        const accountId = idParts[1];
        const customerId = idParts[3];

        const result = await this.orderService.updateOrder(
          accountId,
          customerId,
          order.orderItems
        );

        this.updateJob(jobId, {
          type: "success",
          orderId: order.orderId,
          result,
        });
      } catch (error) {
        this.updateJob(jobId, {
          type: "error",
          orderId: order.orderId,
          error: error.message,
        });
      }
    }, this.CONCURRENCY);

    queue.push(orders);
    queue.drain(() => this.finalizeJob(jobId));
  }

  updateJob(jobId, { type, ...data }) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    type === "success"
      ? (job.results.push(data), job.stats.succeeded++)
      : (job.errors.push(data), job.stats.failed++);
  }

  finalizeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "completed";
      job.completed = new Date();
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }
}
