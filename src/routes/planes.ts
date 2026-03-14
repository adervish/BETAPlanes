import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const result = await c.env.DB.prepare("SELECT tail_number, display_name, color FROM planes").all();
  return c.json(result.results);
});

app.get("/:tail", async (c) => {
  const tail = c.req.param("tail");
  const result = await c.env.DB.prepare("SELECT tail_number, display_name, color FROM planes WHERE tail_number = ?").bind(tail).first();
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

export default app;
