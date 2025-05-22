const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: String,
  note: String
});

module.exports = mongoose.model("Customer", CustomerSchema);
