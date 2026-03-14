import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const tail = c.req.query("tail");
  let result;
  if (tail) {
    result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes WHERE tail_number = ?").bind(tail).all();
  } else {
    const showAll = c.req.query("all");
    if (showAll) {
      result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes").all();
    } else {
      result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes WHERE show_default = 1").all();
    }
  }
  return c.json(result.results);
});

app.get("/:tail", async (c) => {
  const tail = c.req.param("tail");
  const result = await c.env.DB.prepare("SELECT tail_number, display_name, color FROM planes WHERE tail_number = ?").bind(tail).first();
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

export default app;
