const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

//import routes
const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payments", paymentRoutes);

const productRoutes = require("./routes/productRoutes");
app.use("/api/products", productRoutes);

const customerRoutes = require("./routes/customerRoutes");
app.use("/api/customers", customerRoutes);

const orderRoutes = require("./routes/orderRoutes");
app.use("/api/orders", orderRoutes);

const stockRoutes = require("./routes/stockRoutes");
app.use("/api/stocks", stockRoutes);

const dashboardRoutes = require("./routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

const debtRoutes = require("./routes/debtRoutes");
app.use("/api/debts", debtRoutes);

const userRoutes = require("./routes/userRoutes");
app.use("/api/users", userRoutes);

app.get('/healthcheck', (req, res) => {
  res.status(200).send('OK');
});
// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB connect error:", err));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
