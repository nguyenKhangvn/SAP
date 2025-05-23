const mongoose = require("mongoose");

const OrderDetailSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  productCode: { type: String, required: true },
  quantity: Number,
  price: Number,
  amount: Number,
  profit: Number,
});

module.exports = mongoose.model("OrderDetail", OrderDetailSchema);
