const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true }, // mã hàng
  name: { type: String, required: true },
  
  costPrice: Number, // giá vốn
  salePrice: Number, // giá bán
  
  oldStock: { type: Number, default: 0 }, // tồn cũ
  newStock: { type: Number, default: 0 }, // tồn mới
  imported: { type: Number, default: 0 }, // nhập
  exported: { type: Number, default: 0 }  // xuất
}, { timestamps: true });

module.exports = mongoose.model("Product", ProductSchema);
