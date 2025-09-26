const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const User = require("./models/User");
const Order = require("./models/Order");
const faker = require("faker");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const MONGO_URL = process.env.MONGO_URL || "mongodb://mongo:27017/shopdb";
const SEED_SIZE = parseInt(process.env.SEED_SIZE || "20000", 10);
const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// --- Swagger setup ---
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Node Mongo Service",
      version: "1.0.0",
      description: "Microservicio de ejemplo: Users & Orders (CRUD)"
    }
  },
  apis: ["./app.js"]
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Estado del servicio
 *     responses:
 *       200:
 *         description: OK
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() });
});

// --- Helpers: DB connect with retries + seeding ---
async function connectWithRetry(retries = 30, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
      console.log("✅ MongoDB conectado");
      return;
    } catch (err) {
      console.log(`⏳ Intento ${i + 1}/${retries} - Mongo no listo: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("No se pudo conectar a MongoDB después de múltiples intentos.");
}

async function seedIfNeeded() {
  const count = await User.countDocuments();
  if (count > 0) {
    console.log("Seed detectado: no se insertan datos nuevos.");
    return;
  }

  console.log(`🚀 Insertando ${SEED_SIZE} usuarios (batch)...`);
  const batchSize = 2000;
  for (let i = 0; i < SEED_SIZE; i += batchSize) {
    const batch = [];
    const limit = Math.min(batchSize, SEED_SIZE - i);
    for (let j = 0; j < limit; j++) {
      batch.push({
        name: faker.name.findName(),
        email: faker.internet.email(),
        age: faker.datatype.number({ min: 18, max: 80 })
      });
    }
    await User.insertMany(batch);
    console.log(`Inserted ${Math.min(i + batchSize, SEED_SIZE)}/${SEED_SIZE}`);
  }
  console.log("✅ Usuarios insertados.");

  // Crear algunas órdenes (hasta 5000)
  const sampleUsers = await User.find().limit(5000).select("_id");
  const orders = [];
  for (const u of sampleUsers) {
    orders.push({
      product: faker.commerce.productName(),
      price: parseFloat(faker.commerce.price()),
      userId: u._id
    });
  }
  if (orders.length) {
    await Order.insertMany(orders);
    console.log(`✅ Insertadas ${orders.length} órdenes de ejemplo.`);
  }
}

// --- Routes: Users ---
/**
 * @openapi
 * /users:
 *   get:
 *     summary: Obtener lista de usuarios (paginado)
 */
app.get("/users", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const per_page = Math.min(1000, Math.max(1, parseInt(req.query.per_page || "100", 10)));
    const skip = (page - 1) * per_page;
    const items = await User.find().skip(skip).limit(per_page);
    const total = await User.countDocuments();
    res.json({ total, page, per_page, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * @openapi
 * /users/count:
 *   get:
 *     summary: Obtener conteo de usuarios
 */
app.get("/users/count", async (req, res) => {
  const total = await User.countDocuments();
  res.json({ total });
});

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Crear nuevo usuario
 */
app.post("/users", async (req, res) => {
  try {
    const u = await User.create(req.body);
    res.status(201).json(u);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Obtener usuario por id
 */
app.get("/users/:id", async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: "User not found" });
    res.json(u);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put("/users/:id", async (req, res) => {
  try {
    const u = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!u) return res.status(404).json({ message: "User not found" });
    res.json(u);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- Routes: Orders ---
app.get("/orders", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const per_page = Math.min(1000, Math.max(1, parseInt(req.query.per_page || "100", 10)));
    const skip = (page - 1) * per_page;
    const items = await Order.find().skip(skip).limit(per_page).populate("userId", "name email");
    const total = await Order.countDocuments();
    res.json({ total, page, per_page, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/orders/count", async (req, res) => {
  const total = await Order.countDocuments();
  res.json({ total });
});

app.post("/orders", async (req, res) => {
  try {
    // check user exists
    const userExists = await User.exists({ _id: req.body.userId });
    if (!userExists) return res.status(400).json({ message: "Referenced user not found" });
    const o = await Order.create(req.body);
    res.status(201).json(o);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const o = await Order.findById(req.params.id).populate("userId", "name email");
    if (!o) return res.status(404).json({ message: "Order not found" });
    res.json(o);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put("/orders/:id", async (req, res) => {
  try {
    if (req.body.userId) {
      const ok = await User.exists({ _id: req.body.userId });
      if (!ok) return res.status(400).json({ message: "Referenced user not found" });
    }
    const o = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!o) return res.status(404).json({ message: "Order not found" });
    res.json(o);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/orders/:id", async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: "Order deleted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

// --- Start ---
(async () => {
  try {
    await connectWithRetry(30, 2000);
    await seedIfNeeded();
    app.listen(PORT, () => console.log(`🚀 Node service en puerto ${PORT}`));
  } catch (err) {
    console.error("Fallo al iniciar:", err);
    process.exit(1);
  }
})();
