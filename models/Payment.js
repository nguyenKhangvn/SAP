const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  amount: Number,
  type: { type: String, enum: ["payment", "new_debt", "debt_collected"] }, // loại giao dịch
  note: String
});

module.exports = mongoose.model("Payment", PaymentSchema);
