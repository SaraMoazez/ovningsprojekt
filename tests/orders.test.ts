import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/db";
import { createOrder } from "../src/services/orderService";
import { closeDb, resetDb } from "./helpers/db";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

const COUNT_SQL = {
  orders: "SELECT COUNT(*)::int AS n FROM orders",
  order_lines: "SELECT COUNT(*)::int AS n FROM order_lines",
} as const;

async function countRows(table: keyof typeof COUNT_SQL): Promise<number> {
  const res = await db.query<{ n: number }>(COUNT_SQL[table]);
  return res.rows[0].n;
}

const validBody = { lines: [{ product: "Musmatta", quantity: 2, unitPrice: 200 }] };

describe("POST /orders", () => {
  it("lägger en beställning med rader", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Customer-Id", "3")
      .set("Idempotency-Key", "existing-create-order-1")
      .send({ lines: [{ product: "Musmatta", quantity: 2, unitPrice: 200 }] });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(3);
    expect(res.body.status).toBe("new");
    expect(res.body.lines).toEqual([{ product: "Musmatta", quantity: 2, unitPrice: "200.00" }]);
  });

  it("returnerar 400 utan rader", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Customer-Id", "3")
      .set("Idempotency-Key", "existing-empty-lines-1")
      .send({ lines: [] });
    expect(res.status).toBe(400);
  });

  it("returnerar 400 när antalet inte är positivt", async () => {
    const res = await request(app)
      .post("/orders")
      .set("X-Customer-Id", "3")
      .set("Idempotency-Key", "existing-quantity-zero-1")
      .send({ lines: [{ product: "Musmatta", quantity: 0, unitPrice: 200 }] });
    expect(res.status).toBe(400);
  });

  it("returnerar 401 utan inloggning", async () => {
    const res = await request(app).post("/orders").send({ lines: [] });
    expect(res.status).toBe(401);
  });

  describe("Idempotency-Key", () => {
    // Over HTTP, "" and "   " both arrive as "" (Node trims header values), so the
    // whitespace case covers the same path as the empty case. The trim() branch is
    // proven by the direct service test below.
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace-only", "   "],
      ["256 characters long", "a".repeat(256)],
    ])("returns 400 invalid_input for a %s key", async (_name, key) => {
      const ordersBefore = await countRows("orders");
      const linesBefore = await countRows("order_lines");
      const req = request(app).post("/orders").set("X-Customer-Id", "3");
      if (key !== undefined) req.set("Idempotency-Key", key);
      const res = await req.send(validBody);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
      expect(res.body.error.message).toMatch(/idempotency-key/i);
      expect(await countRows("orders")).toBe(ordersBefore);
      expect(await countRows("order_lines")).toBe(linesBefore);
    });

    it("stores the Idempotency-Key on the created order (AC1)", async () => {
      const key = "key with spaces 1";
      const res = await request(app)
        .post("/orders")
        .set("X-Customer-Id", "3")
        .set("Idempotency-Key", key)
        .send(validBody);
      expect(res.status).toBe(201);
      const stored = await db.query("SELECT idempotency_key FROM orders WHERE id = $1", [
        res.body.id,
      ]);
      expect(stored.rows[0].idempotency_key).toBe(key);
    });

    it("accepts a 255-character key and stores it in full", async () => {
      const key = "a".repeat(255);
      const res = await request(app)
        .post("/orders")
        .set("X-Customer-Id", "3")
        .set("Idempotency-Key", key)
        .send(validBody);
      expect(res.status).toBe(201);
      const stored = await db.query("SELECT idempotency_key FROM orders WHERE id = $1", [
        res.body.id,
      ]);
      expect(stored.rows[0].idempotency_key).toHaveLength(255);
    });

    it("does not read the key from the request body", async () => {
      const res = await request(app)
        .post("/orders")
        .set("X-Customer-Id", "3")
        .send({ idempotencyKey: "x", ...validBody });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
    });

    it("checks the key before the lines", async () => {
      const res = await request(app).post("/orders").set("X-Customer-Id", "3").send({ lines: [] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
      expect(res.body.error.message).toMatch(/idempotency-key/i);
    });

    it("returns 401 without X-Customer-Id even when the key is missing (AC8)", async () => {
      const res = await request(app).post("/orders").send(validBody);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    });

    it("lets the key be reused after a rejected request (AC7)", async () => {
      const key = "retry-after-400-1";
      const ordersBefore = await countRows("orders");
      const linesBefore = await countRows("order_lines");
      const bad = await request(app)
        .post("/orders")
        .set("X-Customer-Id", "3")
        .set("Idempotency-Key", key)
        .send({ lines: [] });
      expect(bad.status).toBe(400);
      expect(await countRows("orders")).toBe(ordersBefore);
      expect(await countRows("order_lines")).toBe(linesBefore);

      const res = await request(app)
        .post("/orders")
        .set("X-Customer-Id", "3")
        .set("Idempotency-Key", key)
        .send(validBody);
      expect(res.status).toBe(201);
      const stored = await db.query("SELECT idempotency_key FROM orders WHERE id = $1", [
        res.body.id,
      ]);
      expect(stored.rows[0].idempotency_key).toBe(key);
    });
  });
});

describe("createOrder service", () => {
  it("rejects a whitespace-only Idempotency-Key and writes nothing", async () => {
    const ordersBefore = await countRows("orders");
    const result = await createOrder(3, "   ", validBody);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
    expect(await countRows("orders")).toBe(ordersBefore);
  });
});

describe("GET /orders/:id", () => {
  it("returnerar en egen beställning med rader", async () => {
    const res = await request(app).get("/orders/1042").set("X-Customer-Id", "1");
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(2);
  });

  it("returnerar 403 för en annan kunds beställning", async () => {
    const res = await request(app).get("/orders/1042").set("X-Customer-Id", "2");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("returnerar 404 för en beställning som inte finns", async () => {
    const res = await request(app).get("/orders/9999").set("X-Customer-Id", "1");
    expect(res.status).toBe(404);
  });

  it("returnerar 400 för ett ogiltigt id", async () => {
    const res = await request(app).get("/orders/abc").set("X-Customer-Id", "1");
    expect(res.status).toBe(400);
  });
});

describe("GET /orders/:id/price", () => {
  it("räknar pris med moms via den äldre modulen", async () => {
    const res = await request(app).get("/orders/1042/price").set("X-Customer-Id", "1");
    expect(res.status).toBe(200);
    expect(Number(res.body.total)).toBe(1187.5);
  });
});
