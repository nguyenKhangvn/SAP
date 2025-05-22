const mongoose = require("mongoose");

const StockMovementSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  productCode: { type: String, required: true },
  type: { type: String, enum: ["import", "export"], required: true }, // loại: nhập/xuất
  quantity: { type: Number, required: true },
  note: String
});

module.exports = mongoose.model("StockMovement", StockMovementSchema);
