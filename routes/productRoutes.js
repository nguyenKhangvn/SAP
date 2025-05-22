const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Lấy danh sách tất cả sản phẩm
router.get("/", async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm sản phẩm mới
router.post("/", async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.status(201).json({ message: "Đã tạo sản phẩm thành công" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cập nhật sản phẩm
router.put("/:id", async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, req.body);
    res.json({ message: "Đã cập nhật sản phẩm" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Xóa sản phẩm
router.delete("/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Đã xóa sản phẩm" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
