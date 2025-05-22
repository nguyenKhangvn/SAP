const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const auth = require('../middleware/auth');

// Bảo vệ tất cả các route khách hàng bằng JWT
router.use(auth);

// GET: Danh sách tất cả khách hàng
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const search = req.query.search || '';
    
    // Calculate pagination values
    const skip = (page - 1) * pageSize;
    
    // Create search filter
    const searchFilter = search 
      ? { 
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { address: { $regex: search, $options: 'i' } }
          ] 
        } 
      : {};
    
    // Query with pagination and filtering
    const customers = await Customer.find(searchFilter)
      .skip(skip)
      .limit(pageSize);
    
    // Get total count for pagination
    const totalCount = await Customer.countDocuments(searchFilter);
    
    // Return paginated response
    res.json({
      items: customers,
      totalCount: totalCount,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(totalCount / pageSize)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//get all customers for order
router.get("/all", async (req, res) => {
  try {
    const customers = await Customer.find();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message});
  }
});

// POST: Thêm khách hàng mới
router.post("/", async (req, res) => {
  try {
    const newCustomer = new Customer(req.body);
    await newCustomer.save();
    res.status(201).json({ message: "Thêm khách hàng thành công" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT: Cập nhật khách hàng
router.put("/:id", async (req, res) => {
  try {
    await Customer.findByIdAndUpdate(req.params.id, req.body);
    res.json({ message: "Cập nhật khách hàng thành công" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE: Xoá khách hàng
router.delete("/:id", async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ message: "Đã xoá khách hàng" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Không tìm thấy khách hàng" });
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Không tìm thấy khách hàng" });
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
