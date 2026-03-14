import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const tail = c.req.query("tail");
  const limit = parseInt(c.req.query("limit") || "100");
  const offset = parseInt(c.req.query("offset") || "0");

  let query: string;
  let params: unknown[];

  if (tail) {
    query = "SELECT * FROM flights WHERE tail_number = ? ORDER BY departure_time DESC LIMIT ? OFFSET ?";
    params = [tail, limit, offset];
  } else {
    query = "SELECT * FROM flights ORDER BY departure_time DESC LIMIT ? OFFSET ?";
    params = [limit, offset];
  }

  const stmt = c.env.DB.prepare(query);
  const result = await stmt.bind(...params).all();
  return c.json(result.results);
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("SELECT * FROM flights WHERE id = ?").bind(id).first();
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

export default app;
