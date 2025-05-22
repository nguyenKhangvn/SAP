const mongoose = require("mongoose");

// const OrderSchema = new mongoose.Schema({
//   orderCode: { type: String, required: true, unique: true },
//   date: { type: Date, default: Date.now, required: true },
//   customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
//   total: Number,
//   status: { type: String, enum: ["paid", "debt"], default: "paid" } // trạng thái
// });
const OrderSchema = new mongoose.Schema({
  orderCode: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  total: { type: Number, required: true },
  totalIsPaid: { type: Number, default: 0 },
  remainingDebt: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false },
  status: { type: String, enum: ["paid", "debt"], default: "paid" }
});


module.exports = mongoose.model("Order", OrderSchema);
